import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const { userFindFirst, roleCount, getSessionUserId } = vi.hoisted(() => ({
  userFindFirst: vi.fn(),
  roleCount: vi.fn(),
  getSessionUserId: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  default: { user: { findFirst: userFindFirst }, role: { count: roleCount } },
}));

vi.mock('@/lib/authz', () => ({
  requirePermission: vi.fn(),
  getSessionUserId,
}));

import { ApiError, authenticateApiKey, handleApiError, requireScheduledTaskRole } from './api-auth';
import { SCHEDULED_TASK_ROLE_NAME } from './scheduled-tasks/system-actor';
import { AppError, p2002Field } from './_errors';

function makeRequest(headers: Record<string, string> = {}) {
  return { headers: { get: (name: string) => headers[name] ?? null } } as unknown as Parameters<typeof requireScheduledTaskRole>[0];
}

beforeEach(() => {
  userFindFirst.mockReset();
  roleCount.mockReset();
  getSessionUserId.mockReset();
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

  it('throws 401 when no key header is present', async () => {
    await expect(authenticateApiKey(makeRequest())).rejects.toMatchObject({
      statusCode: 401,
    } satisfies Partial<ApiError>);
    expect(userFindFirst).not.toHaveBeenCalled();
  });
});

describe('handleApiError CONFLICT diagnostics (cmd_1193)', () => {
  const ORIGINAL_ENV = process.env.LOAD_TEST_LOG_CONFLICTS;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    if (ORIGINAL_ENV === undefined) delete process.env.LOAD_TEST_LOG_CONFLICTS;
    else process.env.LOAD_TEST_LOG_CONFLICTS = ORIGINAL_ENV;
  });

  it('does not log when LOAD_TEST_LOG_CONFLICTS is unset (default/normal operation)', async () => {
    delete process.env.LOAD_TEST_LOG_CONFLICTS;

    const err = new AppError('CONFLICT', 'Unique constraint violation', 'provider_code');
    const res = handleApiError(err);

    expect(consoleErrorSpy).not.toHaveBeenCalled();
    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toEqual({
      error: 'Unique constraint violation',
      code: 'CONFLICT',
      field: 'provider_code',
    });
  });

  it('logs only the column/index label, never the colliding value, when explicitly enabled', async () => {
    process.env.LOAD_TEST_LOG_CONFLICTS = 'true';

    const err = new AppError('CONFLICT', 'Unique constraint violation', 'provider_code');
    const res = handleApiError(err);

    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    expect(consoleErrorSpy).toHaveBeenCalledWith('CONFLICT (load-test diagnostics):', { field: 'provider_code' });
    // The logged payload is exactly { field }, with no room for a value key.
    const loggedPayload = consoleErrorSpy.mock.calls[0][1] as Record<string, unknown>;
    expect(Object.keys(loggedPayload)).toEqual(['field']);
    expect(res.status).toBe(409);
  });

  it('does not log a fieldless CONFLICT (e.g. assertNotStale) even when enabled', async () => {
    process.env.LOAD_TEST_LOG_CONFLICTS = 'true';

    const err = new AppError('CONFLICT', 'Invalid snapshot data. Please reload and try again.');
    handleApiError(err);

    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    expect(consoleErrorSpy).toHaveBeenCalledWith('CONFLICT (load-test diagnostics):', { field: undefined });
  });

  it('end-to-end with a real P2002 error meta shape: colliding value never reaches the log', async () => {
    process.env.LOAD_TEST_LOG_CONFLICTS = 'true';

    // Mirrors the exact meta shape service.ts's P2002 catch sites receive
    // from Prisma (see p2002Field()'s doc comment in _errors.ts) for a
    // real duplicate-provider_code collision. Prisma's own P2002 meta never
    // carries the colliding row's data (Postgres SQLSTATE 23505 only ever
    // reports a constraint identifier on the wire, per that same comment) --
    // this fixture stands in for the real driver response, not a stub that
    // conveniently omits the value.
    const realisticP2002Meta = {
      modelName: 'provider',
      driverAdapterError: {
        cause: { constraint: { index: 'provider_provider_code_key' } },
      },
    };
    const derivedField = p2002Field(realisticP2002Meta);
    expect(derivedField).toBe('provider_code');

    const err = new AppError('CONFLICT', 'Unique constraint violation', derivedField);
    handleApiError(err);

    expect(consoleErrorSpy).toHaveBeenCalledWith('CONFLICT (load-test diagnostics):', { field: 'provider_code' });
    const [, loggedPayload] = consoleErrorSpy.mock.calls[consoleErrorSpy.mock.calls.length - 1];
    // No key on the logged object could ever hold a data value -- 'field'
    // is the only key, and its value is a column/index label, not row data.
    expect(Object.keys(loggedPayload as object)).toEqual(['field']);
  });
});
