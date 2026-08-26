import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requirePermission, getSessionUserId, type RichPermissions, type Operation, type ItemContext } from '@/lib/authz';
import { TtlLruCache } from '@/lib/_ttl_lru';
import { AppError, type ErrorCode } from '@/lib/_errors';
import { SCHEDULED_TASK_ROLE_NAME } from '@/lib/scheduled-tasks/system-actor';

export class ApiError extends Error {
  constructor(
    public statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

// Per-process cache of api_key → userId | null (Phase 2 #4 from
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
const apiKeyCache = new TtlLruCache<string, string | null>(API_KEY_MAX_ENTRIES, API_KEY_TTL_MS);

export function invalidateApiKeyCache(apiKey: string | null | undefined): void {
  if (apiKey) apiKeyCache.delete(apiKey);
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

export async function authenticateApiKey(request: NextRequest): Promise<{ userId: string }> {
  const apiKey =
    request.headers.get('X-API-Key') ||
    request.headers.get('Authorization')?.replace('Bearer ', '');

  if (!apiKey) {
    throw new ApiError(401, 'Missing API key. Provide X-API-Key header or Authorization: Bearer <key>.');
  }

  if (apiKeyCacheEnabled) {
    const cached = apiKeyCache.get(apiKey);
    if (cached !== undefined) {
      if (cached === null) throw new ApiError(401, 'Invalid API key.');
      return { userId: cached };
    }
  }

  const user = await prisma.user.findFirst({
    where: { api_key: apiKey },
    select: { id: true },
  });

  if (apiKeyCacheEnabled) {
    apiKeyCache.set(apiKey, user?.id ?? null);
  }

  if (!user) {
    throw new ApiError(401, 'Invalid API key.');
  }

  return { userId: user.id };
}

export async function requireSession(): Promise<{ userId: string }> {
  const userId = await getSessionUserId();
  if (!userId) throw new ApiError(401, 'Login required.');
  return { userId };
}

/**
 * Resolve the caller's user id via X-API-Key/Authorization header when
 * present, falling back to the NextAuth session cookie otherwise. Mirrors
 * the dual-auth pattern in app/api/search/route.ts. Returns null when
 * neither credential is present; throws ApiError(401) when an API key
 * header is present but the key itself is invalid.
 */
export async function resolveActorId(request: NextRequest): Promise<string | null> {
  const apiKey =
    request.headers.get('X-API-Key') ||
    request.headers.get('Authorization')?.replace('Bearer ', '');
  if (apiKey) {
    const { userId } = await authenticateApiKey(request);
    return userId;
  }
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

export async function requireApiPermission(
  userId: string,
  model: string,
  operation: Operation,
  item?: ItemContext,
): Promise<RichPermissions> {
  try {
    return await requirePermission(model, operation, item, userId);
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
  CAPACITY: 409,
  UNKNOWN: 500,
};

export function handleApiError(error: unknown): NextResponse {
  if (error instanceof ApiError) {
    return NextResponse.json({ error: error.message }, { status: error.statusCode });
  }
  if (error instanceof AppError) {
    return NextResponse.json(
      {
        error: error.message,
        code: error.code,
        ...(error.field ? { field: error.field } : {}),
        ...(error.reason ? { reason: error.reason } : {}),
      },
      { status: APP_ERROR_STATUS_MAP[error.code] ?? 500 },
    );
  }
  console.error('API error:', error);
  // Plain `throw new Error(...)` sites (e.g. hand-written custom validation
  // in service_validation_custom.ts, and the generated REQUIRED_FIELDS
  // checks) are not converted to AppError — their message is the intended
  // caller-facing text (cmd_613/cmd_646's convention, exercised by
  // cypress/e2e/approval_flow_same_entity_autocomplete_filter.cy.ts's
  // (API) specs). The AppError message-hiding rationale from cmd_695
  // (React stripping error.message at the Server Components render
  // boundary) does not apply here — this handler produces a plain JSON
  // HTTP response, not a React render, so forwarding the message is safe
  // and was the pre-cmd_695 behavior this restores.
  const message = error instanceof Error ? error.message : 'Internal server error';
  return NextResponse.json({ error: message }, { status: 500 });
}
