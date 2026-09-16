import { describe, it, expect, beforeEach, vi } from 'vitest';

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

import { ApiError, requireScheduledTaskRole } from './api-auth';
import { SCHEDULED_TASK_ROLE_NAME } from './scheduled-tasks/system-actor';

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
