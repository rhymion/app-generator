import { describe, it, expect, beforeEach, vi } from 'vitest';

const { userFindFirst, roleCount, getSessionUserId, verifyMobileAccessToken } = vi.hoisted(() => ({
  userFindFirst: vi.fn(),
  roleCount: vi.fn(),
  getSessionUserId: vi.fn(),
  verifyMobileAccessToken: vi.fn(),
}));

vi.mock('@/lib/mobile-auth', () => ({
  isMobileJwt: (token: string) => token.split('.').length === 3,
  verifyMobileAccessToken,
  MobileAuthError: class MobileAuthError extends Error {},
}));

vi.mock('@/lib/prisma', () => ({
  default: { user: { findFirst: userFindFirst }, role: { count: roleCount } },
}));

vi.mock('@/lib/authz', () => ({
  requireEntityPermission: vi.fn(), requireRecordPermission: vi.fn(),
  getSessionUserId,
}));

vi.mock('@/lib/rate-limit', async () => (await import('@/test/helpers/real-rate-limiter')).realRateLimiterModule());
import { _resetForTests as resetRateLimiter } from './rate-limit';
import { ApiError, authenticate, authenticateApiKey, handleApiError, requireCaller, requireDualAuth, requireScheduledTaskRole, resolveActorId } from './api-auth';
import { SCHEDULED_TASK_ROLE_NAME } from './scheduled-tasks/system-actor';
import { hashApiKey } from './api-key';

function makeRequest(headers: Record<string, string> = {}) {
  return { headers: { get: (name: string) => headers[name] ?? null } } as unknown as Parameters<typeof requireScheduledTaskRole>[0];
}

beforeEach(() => {
  resetRateLimiter();
  userFindFirst.mockReset();
  roleCount.mockReset();
  getSessionUserId.mockReset();
  verifyMobileAccessToken.mockReset();
});

describe('requireScheduledTaskRole', () => {
  it('throws 401 when no session and no API key are present', async () => {
    getSessionUserId.mockResolvedValueOnce(null);

    await expect(requireScheduledTaskRole(makeRequest())).rejects.toMatchObject({
      statusCode: 401,
    } satisfies Partial<ApiError>);
    expect(roleCount).not.toHaveBeenCalled();
  });

  it('throws 403 when authenticated but not a member of the dedicated role', async () => {
    getSessionUserId.mockResolvedValueOnce('user-1');
    roleCount.mockResolvedValueOnce(0);

    await expect(requireScheduledTaskRole(makeRequest())).rejects.toMatchObject({
      statusCode: 403,
    } satisfies Partial<ApiError>);
    expect(roleCount).toHaveBeenCalledWith({
      where: { name: SCHEDULED_TASK_ROLE_NAME, users: { some: { id: 'user-1' } } },
    });
  });

  it('resolves when authenticated and a member of the dedicated role', async () => {
    getSessionUserId.mockResolvedValueOnce('user-2');
    roleCount.mockResolvedValueOnce(1);

    const result = await requireScheduledTaskRole(makeRequest());

    expect(result).toEqual({ userId: 'user-2' });
  });

  it('resolves an API-key caller who holds the dedicated role', async () => {
    userFindFirst.mockResolvedValueOnce({ id: 'user-3' });
    roleCount.mockResolvedValueOnce(1);

    const result = await requireScheduledTaskRole(makeRequest({ 'X-API-Key': 'mk_test' }));

    expect(result).toEqual({ userId: 'user-3' });
    expect(roleCount).toHaveBeenCalledWith({
      where: { name: SCHEDULED_TASK_ROLE_NAME, users: { some: { id: 'user-3' } } },
    });
  });
});

describe('authenticateApiKey', () => {
  it('looks the user up by the SHA-256 of the presented key, never by the key', async () => {
    userFindFirst.mockResolvedValueOnce({ id: 'user-h', api_key_expires_at: null });

    await authenticateApiKey(makeRequest({ 'X-API-Key': 'mk_lookup_probe' }));

    const query = userFindFirst.mock.calls[0][0];
    expect(query.where).toEqual({ api_key_hash: hashApiKey('mk_lookup_probe') });
    expect(JSON.stringify(query)).not.toContain('mk_lookup_probe');
  });

  it('resolves a key with no expiry (null = never expires)', async () => {
    userFindFirst.mockResolvedValueOnce({ id: 'user-4', api_key_expires_at: null });

    const result = await authenticateApiKey(makeRequest({ 'X-API-Key': 'mk_test' }));

    expect(result).toEqual({ userId: 'user-4' });
  });

  it('resolves a key whose expiry is in the future', async () => {
    const future = new Date(Date.now() + 60_000);
    userFindFirst.mockResolvedValueOnce({ id: 'user-5', api_key_expires_at: future });

    const result = await authenticateApiKey(makeRequest({ 'X-API-Key': 'mk_test' }));

    expect(result).toEqual({ userId: 'user-5' });
  });

  it('throws 401 for a key whose expiry is in the past', async () => {
    const past = new Date(Date.now() - 60_000);
    userFindFirst.mockResolvedValueOnce({ id: 'user-6', api_key_expires_at: past });

    await expect(authenticateApiKey(makeRequest({ 'X-API-Key': 'mk_test' }))).rejects.toMatchObject({
      statusCode: 401,
      message: 'API key expired.',
    } satisfies Partial<ApiError>);
  });

  it('throws 401 for a key whose expiry is exactly now (boundary is exclusive)', async () => {
    const now = new Date();
    userFindFirst.mockResolvedValueOnce({ id: 'user-7', api_key_expires_at: now });

    await expect(authenticateApiKey(makeRequest({ 'X-API-Key': 'mk_test' }))).rejects.toMatchObject({
      statusCode: 401,
      message: 'API key expired.',
    } satisfies Partial<ApiError>);
  });

  it('throws 401 for an unknown key', async () => {
    userFindFirst.mockResolvedValueOnce(null);

    await expect(authenticateApiKey(makeRequest({ 'X-API-Key': 'mk_unknown' }))).rejects.toMatchObject({
      statusCode: 401,
      message: 'Invalid API key.',
    } satisfies Partial<ApiError>);
  });

  it('answers 429 with Retry-After once one unknown key has failed 10 times in a minute', async () => {
    userFindFirst.mockResolvedValue(null);
    const request = makeRequest({ 'X-API-Key': 'mk_probe' });
    for (let i = 0; i < 10; i++) {
      await expect(authenticateApiKey(request)).rejects.toMatchObject({ statusCode: 401 });
    }

    const blocked = await authenticateApiKey(request).catch((e: unknown) => e);

    expect(blocked).toMatchObject({ statusCode: 429 });
    expect(handleApiError(blocked).headers.get('Retry-After')).toMatch(/^[1-9]\d*$/);
  });

  it('never throttles a valid key, however often it is used', async () => {
    userFindFirst.mockResolvedValue({ id: 'user-9', api_key_expires_at: null });
    for (let i = 0; i < 30; i++) {
      await expect(authenticateApiKey(makeRequest({ 'X-API-Key': 'mk_valid' }))).resolves.toEqual({ userId: 'user-9' });
    }
  });

  it('keys the limiter by a hash of the presented key, never the raw key', async () => {
    const { getRateLimiter } = await import('./rate-limit');
    const check = vi.spyOn(getRateLimiter(), 'check');
    userFindFirst.mockResolvedValue(null);

    await authenticateApiKey(makeRequest({ 'X-API-Key': 'mk_secret_value' })).catch(() => undefined);

    expect(check).toHaveBeenCalledWith('auth:apikey', expect.stringMatching(/^[0-9a-f]{64}$/));
    expect(JSON.stringify(check.mock.calls)).not.toContain('mk_secret_value');
  });

  it('throws 401 when no key header is present', async () => {
    await expect(authenticateApiKey(makeRequest())).rejects.toMatchObject({
      statusCode: 401,
    } satisfies Partial<ApiError>);
    expect(userFindFirst).not.toHaveBeenCalled();
  });
});

describe('requireCaller', () => {
  it('uses the session cookie when the request carries no credential header', async () => {
    getSessionUserId.mockResolvedValue('cookie-user');
    await expect(requireCaller(makeRequest())).resolves.toEqual({ userId: 'cookie-user' });
  });

  it('rejects with 401 when there is neither a credential header nor a session', async () => {
    getSessionUserId.mockResolvedValue(null);
    await expect(requireCaller(makeRequest())).rejects.toMatchObject({ statusCode: 401 });
  });

  it('does not fall back to the session when a credential header is present but invalid', async () => {
    getSessionUserId.mockResolvedValue('cookie-user');
    userFindFirst.mockResolvedValue(null);
    await expect(requireCaller(makeRequest({ 'X-API-Key': 'not-a-real-key' }))).rejects.toBeInstanceOf(ApiError);
    expect(getSessionUserId).not.toHaveBeenCalled();
  });
});

const MOBILE_JWT = 'header.payload.signature';

describe('authenticate', () => {
  it('resolves X-API-Key first when a mobile access token is also sent', async () => {
    userFindFirst.mockResolvedValue({ id: 'key-user', api_key_expires_at: null });
    await expect(
      authenticate(makeRequest({ 'X-API-Key': 'mk_test', Authorization: `Bearer ${MOBILE_JWT}` })),
    ).resolves.toEqual({ userId: 'key-user' });
    expect(verifyMobileAccessToken).not.toHaveBeenCalled();
  });

  it('resolves identically to resolveActorId and requireCaller when both credentials are sent', async () => {
    userFindFirst.mockResolvedValue({ id: 'key-user', api_key_expires_at: null });
    const headers = { 'X-API-Key': 'mk_test', Authorization: `Bearer ${MOBILE_JWT}` };
    const viaAuthenticate = await authenticate(makeRequest(headers));
    const viaActor = await resolveActorId(makeRequest(headers));
    const viaCaller = await requireCaller(makeRequest(headers));
    expect(viaActor).toBe(viaAuthenticate.userId);
    expect(viaCaller).toEqual(viaAuthenticate);
  });

  it('still resolves a mobile access token when no X-API-Key is sent', async () => {
    verifyMobileAccessToken.mockResolvedValue({ userId: 'mobile-user', sessionId: 's1' });
    await expect(authenticate(makeRequest({ Authorization: `Bearer ${MOBILE_JWT}` }))).resolves.toEqual({
      userId: 'mobile-user',
    });
  });
});

describe('resolveActorId', () => {
  it('resolves a mobile access token sent as a bearer credential', async () => {
    verifyMobileAccessToken.mockResolvedValue({ userId: 'mobile-user', sessionId: 's1' });
    await expect(resolveActorId(makeRequest({ Authorization: `Bearer ${MOBILE_JWT}` }))).resolves.toBe('mobile-user');
    expect(verifyMobileAccessToken).toHaveBeenCalledWith(MOBILE_JWT);
    expect(userFindFirst).not.toHaveBeenCalled();
    expect(getSessionUserId).not.toHaveBeenCalled();
  });

  it('rejects an invalid mobile access token with 401 and does not fall back to the session', async () => {
    verifyMobileAccessToken.mockRejectedValue(new Error('bad signature'));
    getSessionUserId.mockResolvedValue('cookie-user');
    await expect(resolveActorId(makeRequest({ Authorization: `Bearer ${MOBILE_JWT}` }))).rejects.toMatchObject({
      statusCode: 401,
    });
    expect(getSessionUserId).not.toHaveBeenCalled();
  });

  it('still resolves an API key sent as a bearer credential', async () => {
    userFindFirst.mockResolvedValue({ id: 'key-user', api_key_expires_at: null });
    await expect(resolveActorId(makeRequest({ Authorization: 'Bearer mk_test' }))).resolves.toBe('key-user');
    expect(verifyMobileAccessToken).not.toHaveBeenCalled();
  });

  it('still resolves X-API-Key as an API key, even next to a bearer token', async () => {
    userFindFirst.mockResolvedValue({ id: 'key-user', api_key_expires_at: null });
    await expect(
      resolveActorId(makeRequest({ 'X-API-Key': 'mk_test', Authorization: `Bearer ${MOBILE_JWT}` })),
    ).resolves.toBe('key-user');
    expect(verifyMobileAccessToken).not.toHaveBeenCalled();
  });

  it('rejects an unknown API key with 401', async () => {
    userFindFirst.mockResolvedValue(null);
    await expect(resolveActorId(makeRequest({ 'X-API-Key': 'nope' }))).rejects.toMatchObject({ statusCode: 401 });
  });

  it('falls back to the session cookie without a credential header, and returns null without one', async () => {
    getSessionUserId.mockResolvedValueOnce('cookie-user');
    await expect(resolveActorId(makeRequest())).resolves.toBe('cookie-user');
    getSessionUserId.mockResolvedValueOnce(null);
    await expect(resolveActorId(makeRequest())).resolves.toBeNull();
  });
});

describe('requireDualAuth and requireScheduledTaskRole with a mobile access token', () => {
  it('requireDualAuth accepts a mobile access token', async () => {
    verifyMobileAccessToken.mockResolvedValue({ userId: 'mobile-user', sessionId: 's1' });
    await expect(requireDualAuth(makeRequest({ Authorization: `Bearer ${MOBILE_JWT}` }))).resolves.toEqual({
      userId: 'mobile-user',
    });
  });

  it('requireDualAuth throws 401 with no credential and no session', async () => {
    getSessionUserId.mockResolvedValue(null);
    await expect(requireDualAuth(makeRequest())).rejects.toMatchObject({ statusCode: 401 });
  });

  it('requireScheduledTaskRole accepts a mobile token holding the role', async () => {
    verifyMobileAccessToken.mockResolvedValue({ userId: 'mobile-user', sessionId: 's1' });
    roleCount.mockResolvedValue(1);
    await expect(requireScheduledTaskRole(makeRequest({ Authorization: `Bearer ${MOBILE_JWT}` }))).resolves.toEqual({
      userId: 'mobile-user',
    });
  });

  it('requireScheduledTaskRole answers 403 for a mobile token without the role', async () => {
    verifyMobileAccessToken.mockResolvedValue({ userId: 'mobile-user', sessionId: 's1' });
    roleCount.mockResolvedValue(0);
    await expect(
      requireScheduledTaskRole(makeRequest({ Authorization: `Bearer ${MOBILE_JWT}` })),
    ).rejects.toMatchObject({ statusCode: 403 });
  });
});

describe('handleApiError with an unexpected error', () => {
  it('returns a generic 500 body and keeps the original text out of the response', async () => {
    const leaky = new Error(
      'Invalid `prisma.user.findMany()` invocation: code P2022 column "users.secret_col" does not exist; ' +
        'SELECT "public"."user"."secret_col" FROM "public"."user" at /srv/app/lib/prisma.ts:42:7',
    );
    leaky.stack = 'Error: boom\n    at /srv/app/lib/prisma.ts:42:7';
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = handleApiError(leaky);
    const text = JSON.stringify(await res.json());
    expect(res.status).toBe(500);
    expect(text).toBe(JSON.stringify({ error: 'Internal server error' }));
    for (const fragment of ['P2022', 'SELECT', 'secret_col', '/srv/app', 'prisma.ts']) {
      expect(text).not.toContain(fragment);
    }
    expect(logged).toHaveBeenCalledWith('API error:', leaky);
    logged.mockRestore();
  });

  it('still returns an intentional AppError message to the client', async () => {
    const { AppError } = await import('./_errors');
    const res = handleApiError(new AppError('VALIDATION', 'Start date must be before end date'));
    expect(res.status).toBe(422);
    expect((await res.json()).error).toBe('Start date must be before end date');
  });
});
