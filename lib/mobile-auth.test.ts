// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from 'vitest';

const { userFindUnique } = vi.hoisted(() => ({ userFindUnique: vi.fn() }));

vi.mock('@/lib/prisma', () => ({ default: { user: { findUnique: userFindUnique } } }));

import { MobileAuthError, signMobileAccessToken, verifyMobileAccessToken } from './mobile-auth';

beforeEach(() => {
  vi.clearAllMocks();
  process.env.AUTH_SECRET = 'test-secret-for-mobile-auth-unit-tests';
  userFindUnique.mockResolvedValue({ anonymized_at: null });
});

describe('verifyMobileAccessToken', () => {
  it('accepts a token of a live user', async () => {
    const token = await signMobileAccessToken('user-1', 'session-1');
    await expect(verifyMobileAccessToken(token)).resolves.toEqual({ userId: 'user-1', sessionId: 'session-1' });
    expect(userFindUnique).toHaveBeenCalledWith({ where: { id: 'user-1' }, select: { anonymized_at: true } });
  });

  it('rejects a token issued before the user was anonymized', async () => {
    const token = await signMobileAccessToken('user-1', 'session-1');
    userFindUnique.mockResolvedValue({ anonymized_at: new Date() });
    await expect(verifyMobileAccessToken(token)).rejects.toBeInstanceOf(MobileAuthError);
  });

  it('rejects a token whose user no longer exists', async () => {
    const token = await signMobileAccessToken('user-1', 'session-1');
    userFindUnique.mockResolvedValue(null);
    await expect(verifyMobileAccessToken(token)).rejects.toBeInstanceOf(MobileAuthError);
  });
});
