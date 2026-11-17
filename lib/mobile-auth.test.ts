// @vitest-environment node
import { SignJWT } from 'jose';
import { describe, it, expect, beforeEach, vi } from 'vitest';

const { userFindUnique } = vi.hoisted(() => ({ userFindUnique: vi.fn() }));

vi.mock('@/lib/prisma', () => ({ default: { user: { findUnique: userFindUnique } } }));

import {
  MOBILE_ACCESS_TOKEN_TYPE,
  MOBILE_TOKEN_AUDIENCE,
  MOBILE_TOKEN_ISSUER,
  MobileAuthError,
  signMobileAccessToken, verifyMobileAccessToken,
} from './mobile-auth';

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

  // Same key and `type` claim as a real token, so only the iss / aud check can reject these.
  async function forge(claims: { iss?: string; aud?: string }): Promise<string> {
    let jwt = new SignJWT({ session_id: 'session-1', type: MOBILE_ACCESS_TOKEN_TYPE })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject('user-1')
      .setIssuedAt()
      .setExpirationTime('5m');
    if (claims.iss) jwt = jwt.setIssuer(claims.iss);
    if (claims.aud) jwt = jwt.setAudience(claims.aud);
    return jwt.sign(new TextEncoder().encode(process.env.AUTH_SECRET));
  }

  it('rejects a correctly signed token with the wrong audience', async () => {
    const token = await forge({ iss: MOBILE_TOKEN_ISSUER, aud: 'another-service' });
    await expect(verifyMobileAccessToken(token)).rejects.toBeInstanceOf(MobileAuthError);
  });

  it('rejects a correctly signed token with the wrong issuer', async () => {
    const token = await forge({ iss: 'another-issuer', aud: MOBILE_TOKEN_AUDIENCE });
    await expect(verifyMobileAccessToken(token)).rejects.toBeInstanceOf(MobileAuthError);
  });

  it('rejects a correctly signed token with no iss and aud claims', async () => {
    const token = await forge({});
    await expect(verifyMobileAccessToken(token)).rejects.toBeInstanceOf(MobileAuthError);
  });

  it('accepts the forged shape when iss and aud are right (control for the three negatives)', async () => {
    const token = await forge({ iss: MOBILE_TOKEN_ISSUER, aud: MOBILE_TOKEN_AUDIENCE });
    await expect(verifyMobileAccessToken(token)).resolves.toEqual({ userId: 'user-1', sessionId: 'session-1' });
  });
});
