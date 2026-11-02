import { logger } from '@/lib/logger';
import { NextRequest, NextResponse } from 'next/server';
import { hashApiKey } from '@/lib/api-key';
import prisma from '@/lib/prisma';
import { getRateLimiter } from '@/lib/rate-limit';
import { requireEntityPermission, requireRecordPermission, getSessionUserId, type RichPermissions, type Operation, type RecordContext } from '@/lib/authz';
import { TtlLruCache } from '@/lib/_ttl_lru';
import { cacheOnGlobal } from '@/lib/global-singleton';
import { AppError, type ErrorCode } from '@/lib/_errors';
import { SCHEDULED_TASK_ROLE_NAME } from '@/lib/scheduled-tasks/system-actor';
import { enterRequestScope, runAsActor } from '@/lib/_request_scope';
import { isAllowedHost } from '@/lib/auth/external-url';
import { logSecurityEvent, securityEventForStatus } from '@/lib/security-event';
import { isMobileJwt, verifyMobileAccessToken, MobileAuthError } from '@/lib/mobile-auth';

export class ApiError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

// Per-process cache of SHA-256(api key) → userId | null (Phase 2 #4 from
// performance-plan-session.md). The negative-result cache (`null`) lets
// repeated bad-key probes short-circuit without hammering the DB; the
// LRU cap keeps unknown-key probing bounded. Rotations invalidate via
// `invalidateApiKeyCache()` from settings/account mutations.
//
// Gated on NODE_ENV === 'production' — which is always true here: `next build`
// bakes NODE_ENV=production into the bundle regardless of the runtime env
// (.env.test's NODE_ENV=test is not honored by a built server), so the cache
// is effectively always on for `cy:test:api` runs too. `cy.task('db:reset')`
// wipes user_account rows but cannot reach into the server's process to
// clear this cache; without an explicit clear the cached userId would
// survive the reset and the next write would fail with an
// `<entity>_updater_id_fkey` violation — see `clearApiKeyCache()` below,
// invoked via the `/api/test-utils/reset-caches` endpoint.
const API_KEY_TTL_MS = 5 * 60 * 1000;
const API_KEY_MAX_ENTRIES = 1000;
const apiKeyCacheEnabled = process.env.NODE_ENV === 'production';

// Caching the expiry alongside the userId (rather than just the userId)
// means a key that expires mid-TTL is still caught: expiry is compared
// against the current time on every lookup, not just when the entry was
// cached.
type ApiKeyCacheEntry = { userId: string; expiresAt: Date | null } | null;
// Held on globalThis so the route handlers and the Server Actions that
// invalidate it share one instance even when the build bundles this module
// separately for each of them; otherwise a reissued key's old hash would stay
// accepted by the route bundle's copy until the TTL ran out.
const apiKeyCache = cacheOnGlobal(
  globalThis as unknown as Record<string, unknown>,
  '__apiKeyAuthCache',
  () => new TtlLruCache<string, ApiKeyCacheEntry>(API_KEY_MAX_ENTRIES, API_KEY_TTL_MS),
);

// The cache is keyed by the key's hash, never by the key itself, so a memory
// dump or a heap snapshot holds no usable credential.
export function invalidateApiKeyCache(apiKeyHash: string | null | undefined): void {
  if (apiKeyHash) apiKeyCache.delete(apiKeyHash);
}

/**
 * Drop every entry in the api-key cache. Used by the cypress
 * `/api/test-utils/reset-caches` endpoint so production-build runs of
 * `cy.task('db:reset')` don't leave the cache pointing at deleted
 * user_account rows.
 */
export function clearApiKeyCache(): void {
  apiKeyCache.clear();
}

/**
 * Rejects a presented key that matches no user. Each rejection spends one
 * attempt from the `auth:apikey` bucket, keyed by a hash of the presented key
 * (never the raw secret), so a key that keeps failing is answered with 429
 * instead of 401. Only failures are counted: a valid key is never throttled
 * here, and `api:read` / `api:write` still bound authenticated traffic.
 */
async function rejectUnknownApiKey(apiKeyHash: string): Promise<never> {
  const decision = await getRateLimiter().check('auth:apikey', apiKeyHash);
  if (!decision.allowed) {
    throw new ApiError(429, 'Too many API key attempts.', decision.retryAfterSeconds);
  }
  throw new ApiError(401, 'Invalid API key.');
}

/**
 * Per-user ceiling for a REST route that is not covered by the API-key
 * handlers' own check (dual-auth, session-only and mobile routes). Spends the
 * same `api:read` / `api:write` bucket as the generated entity routes and the
 * Server Actions (`lib/rate-limit/action.ts`), keyed by the caller's user id,
 * and answers 429 with `Retry-After` when it is spent.
 */
export async function enforceApiRateLimit(userId: string, bucket: 'api:read' | 'api:write' = 'api:write'): Promise<void> {
  const decision = await getRateLimiter().check(bucket, userId);
  if (!decision.allowed) {
    throw new ApiError(429, 'Rate limit reached. Retry later.', decision.retryAfterSeconds);
  }
}

export async function authenticateApiKey(request: NextRequest): Promise<{ userId: string }> {
  enterRequestScope();
  const apiKey =
    request.headers.get('X-API-Key') ||
    request.headers.get('Authorization')?.replace('Bearer ', '');

  if (!apiKey) {
    throw new ApiError(401, 'Missing API key. Provide X-API-Key header or Authorization: Bearer <key>.');
  }

  const apiKeyHash = hashApiKey(apiKey);

  if (apiKeyCacheEnabled) {
    const cached = apiKeyCache.get(apiKeyHash);
    if (cached !== undefined) {
      if (cached === null) return rejectUnknownApiKey(apiKeyHash);
      if (cached.expiresAt && cached.expiresAt <= new Date()) {
        throw new ApiError(401, 'API key expired.');
      }
      return { userId: cached.userId };
    }
  }

  const user = await prisma.user.findFirst({
    where: { api_key_hash: apiKeyHash },
    select: { id: true, api_key_expires_at: true },
  });

  if (apiKeyCacheEnabled) {
    apiKeyCache.set(apiKeyHash, user ? { userId: user.id, expiresAt: user.api_key_expires_at } : null);
  }

  if (!user) {
    return rejectUnknownApiKey(apiKeyHash);
  }

  if (user.api_key_expires_at && user.api_key_expires_at <= new Date()) {
    throw new ApiError(401, 'API key expired.');
  }

  return { userId: user.id };
}

/**
 * Unified entry point for the two Bearer/X-API-Key based auth methods on API
 * routes (the browser session cookie is handled separately by
 * `requireSession()`).
 *
 * Resolution order, shared by every helper in this file: an `X-API-Key`
 * header always wins and is treated as an API key, even when an
 * `Authorization` header is also present. Only without `X-API-Key` is
 * `Authorization: Bearer <token>` considered; it is ambiguous between a mobile
 * access JWT and a service API key, so the token shape decides: a JWT is
 * always three dot-separated segments (header.payload.signature), an API key
 * never is. `authenticateApiKey()` itself is untouched, so existing service
 * callers keep working exactly as before.
 */
export async function authenticate(request: NextRequest): Promise<{ userId: string }> {
  if (request.headers.get('X-API-Key')) return authenticateApiKey(request);
  const bearer = request.headers.get('Authorization')?.replace('Bearer ', '');
  if (bearer && isMobileJwt(bearer)) {
    enterRequestScope();
    try {
      const { userId } = await verifyMobileAccessToken(bearer);
      return { userId };
    } catch (e) {
      const message = e instanceof MobileAuthError ? e.message : 'Invalid mobile access token.';
      throw new ApiError(401, message);
    }
  }
  return authenticateApiKey(request);
}

/**
 * Mobile-session-only auth for `app/api/mobile/auth/*` (logout, refresh,
 * device list/revoke). Deliberately narrower than `authenticate()`: these
 * endpoints manage mobile_session rows directly and must reject a plain
 * service API key even though it could otherwise reach here via the same
 * `Authorization: Bearer` header.
 */
export async function requireMobileAuth(
  request: NextRequest,
): Promise<{ userId: string; sessionId: string }> {
  enterRequestScope();
  const bearer = request.headers.get('Authorization')?.replace('Bearer ', '');
  if (!bearer) {
    throw new ApiError(401, 'Missing Authorization: Bearer <access_token> header.');
  }
  try {
    return await verifyMobileAccessToken(bearer);
  } catch (e) {
    const message = e instanceof MobileAuthError ? e.message : 'Invalid access token.';
    throw new ApiError(401, message);
  }
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Refuses a state-changing request that a browser sent from another site while
 * the caller is identified only by the session cookie (ASVS V3.5.1, V3.5.2).
 * `Sec-Fetch-Site` is decisive when present: only `same-origin` and `none`
 * (a user-initiated navigation) pass. Without it, `Origin` must name a host
 * this deployment serves. A request carrying neither header does not come from
 * a browser that can be driven cross-site, so it passes. Requests that
 * authenticate with an API key or a mobile access token never reach this check:
 * those credentials are not attached by the browser on its own.
 */
export function assertSameSiteCookieWrite(request: NextRequest): void {
  if (SAFE_METHODS.has(request.method)) return;
  const fetchSite = request.headers.get('sec-fetch-site');
  if (fetchSite) {
    if (fetchSite === 'same-origin' || fetchSite === 'none') return;
    throw new ApiError(403, 'Cross-site request refused.');
  }
  const origin = request.headers.get('origin');
  if (!origin) return;
  try {
    if (isAllowedHost(new URL(origin).host)) return;
    const own = request.headers.get('host');
    if (own && hostnameOnly(own) === hostnameOnly(new URL(origin).host)) return;
  } catch {
    // An unparseable Origin is refused below.
  }
  throw new ApiError(403, 'Cross-site request refused.');
}

function hostnameOnly(host: string): string {
  return host.replace(/:\d+$/, '').toLowerCase();
}

export async function requireSession(): Promise<{ userId: string }> {
  const userId = await getSessionUserId();
  if (!userId) throw new ApiError(401, 'Login required.');
  return { userId };
}

/**
 * Resolve the caller's user id from a credential header when present, falling
 * back to the NextAuth session cookie otherwise. Mirrors the dual-auth pattern
 * in app/api/search/route.ts.
 *
 * A bearer token is dispatched by shape, the same way {@link authenticate}
 * does: a mobile access JWT is verified as such, anything else is looked up as
 * an API key. `X-API-Key` is always an API key. Returns null when no
 * credential is present; throws ApiError(401) when a credential header is
 * present but invalid. Authorization is unchanged: the caller still passes
 * through the route's own permission and organization checks.
 */
export async function resolveActorId(request: NextRequest): Promise<string | null> {
  if (request.headers.get('X-API-Key') || request.headers.get('Authorization')?.replace('Bearer ', '')) {
    const { userId } = await authenticate(request);
    return userId;
  }
  assertSameSiteCookieWrite(request);
  return getSessionUserId();
}

/** Same as {@link resolveActorId}, but throws ApiError(401) instead of
 * returning null when neither an API key nor a session is present. */
export async function requireDualAuth(request: NextRequest): Promise<{ userId: string }> {
  const userId = await resolveActorId(request);
  if (!userId) throw new ApiError(401, 'Authentication required. Provide X-API-Key header or sign in.');
  return { userId };
}

/** Same dual-auth resolution as {@link requireDualAuth}, plus a check that
 * the resolved caller holds {@link SCHEDULED_TASK_ROLE_NAME}. Throws
 * ApiError(401) for no/invalid credential (same as requireDualAuth) or
 * ApiError(403) when authenticated but not a member of the dedicated role. */
export async function requireScheduledTaskRole(request: NextRequest): Promise<{ userId: string }> {
  const { userId } = await requireDualAuth(request);
  const roleCount = await prisma.role.count({
    where: { name: SCHEDULED_TASK_ROLE_NAME, users: { some: { id: userId } } },
  });
  if (roleCount === 0) {
    throw new ApiError(403, `Scheduled task access requires the '${SCHEDULED_TASK_ROLE_NAME}' role.`);
  }
  return { userId };
}

/**
 * Caller of a route that serves both the web session and token callers: a
 * mobile access token or API key when the request carries a credential header
 * (see {@link authenticate}), otherwise the NextAuth session cookie. Throws
 * ApiError(401) when neither is present or valid.
 */
export async function requireCaller(request: NextRequest): Promise<{ userId: string }> {
  if (request.headers.get('Authorization') || request.headers.get('X-API-Key')) {
    return authenticate(request);
  }
  assertSameSiteCookieWrite(request);
  const userId = await getSessionUserId();
  if (!userId) throw new ApiError(401, 'Authentication required. Sign in, or send a mobile access token or API key.');
  return { userId };
}

/**
 * Runs `fn` with the authenticated caller as the acting user, so a function that
 * reads its identity from the session (a Server Action) can be reused by a REST
 * route without a second implementation. See `runAsActor`.
 */
export function withActor<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  return runAsActor(userId, fn);
}

/**
 * Entity-only permission check: may the caller ever perform `operation` on this
 * entity? It takes no record, so it never resolves Creator/Assignee-scoped
 * flags -- once a record is loaded, authorize with
 * {@link requireApiRecordPermission}.
 */
export async function requireApiPermission(
  userId: string,
  model: string,
  operation: Operation,
): Promise<RichPermissions> {
  try {
    return await requireEntityPermission(model, operation, userId);
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError(403, (e as Error).message);
  }
}

/** Record-scoped permission check: the record is required, see {@link requireRecordPermission}. */
export async function requireApiRecordPermission(
  userId: string,
  model: string,
  operation: Operation,
  item: RecordContext,
): Promise<RichPermissions> {
  try {
    return await requireRecordPermission(model, operation, item, userId);
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError(403, (e as Error).message);
  }
}

const APP_ERROR_STATUS_MAP: Record<ErrorCode, number> = {
  SESSION_EXPIRED: 401,
  PERMISSION_DENIED: 403,
  NOT_FOUND: 404,
  VALIDATION: 422,
  CONFLICT: 409,
  RESERVATION_LOCKED: 409,
  RELATED_RECORD_INVALID: 422,
  CAPACITY: 409,
  RATE_LIMITED: 429,
  UNKNOWN: 500,
};

export function handleApiError(error: unknown): NextResponse {
  if (error instanceof ApiError) {
    const event = securityEventForStatus(error.statusCode);
    if (event) logSecurityEvent({ event, status: error.statusCode });
    return NextResponse.json(
      { error: error.message },
      {
        status: error.statusCode,
        ...(error.retryAfterSeconds !== undefined
          ? { headers: { 'Retry-After': String(error.retryAfterSeconds) } }
          : {}),
      },
    );
  }
  if (error instanceof AppError) {
    const status = APP_ERROR_STATUS_MAP[error.code] ?? 500;
    const event = securityEventForStatus(status);
    if (event) logSecurityEvent({ event, status, code: error.code });
    return NextResponse.json(
      {
        error: error.message,
        code: error.code,
        ...(error.field ? { field: error.field } : {}),
        ...(error.reason ? { reason: error.reason } : {}),
        ...(error.messageKey ? { messageKey: error.messageKey } : {}),
        ...(error.messageKey && error.messageArgs ? { messageArgs: error.messageArgs } : {}),
      },
      { status: APP_ERROR_STATUS_MAP[error.code] ?? 500 },
    );
  }
  // Anything else is unexpected: library and database errors can carry SQL
  // fragments, column names or file paths, so the client gets a generic body
  // and the original goes to the server log only. A message meant for the
  // user is raised as an AppError (or ApiError) instead, which is handled
  // above.
  logger.error('API error:', error);
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
}
