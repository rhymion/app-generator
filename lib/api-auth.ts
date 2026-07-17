import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requirePermission, getSessionUserId, type RichPermissions, type Operation, type ItemContext } from '@/lib/authz';
import { TtlLruCache } from '@/lib/_ttl_lru';
import { isMobileJwt, verifyMobileAccessToken, MobileAuthError } from '@/lib/mobile-auth';

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

/**
 * Unified entry point for the three co-existing auth methods on API routes
 * (cmd_357 DP-1, Option A): browser session cookie is handled separately by
 * `requireSession()`; this covers the two Bearer/X-API-Key based methods.
 *
 * `Authorization: Bearer <token>` is ambiguous between a mobile access JWT
 * and a service API key, so the token shape decides: a JWT is always 3
 * dot-separated segments (header.payload.signature), an API key never is.
 * `authenticateApiKey()` itself is untouched — existing service/API-key
 * callers keep working exactly as before.
 */
export async function authenticate(request: NextRequest): Promise<{ userId: string }> {
  const bearer = request.headers.get('Authorization')?.replace('Bearer ', '');
  if (bearer && isMobileJwt(bearer)) {
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

export async function requireSession(): Promise<{ userId: string }> {
  const userId = await getSessionUserId();
  if (!userId) throw new ApiError(401, 'Login required.');
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

export function handleApiError(error: unknown): NextResponse {
  if (error instanceof ApiError) {
    return NextResponse.json({ error: error.message }, { status: error.statusCode });
  }
  console.error('API error:', error);
  const message = error instanceof Error ? error.message : 'Internal server error';
  return NextResponse.json({ error: message }, { status: 500 });
}
