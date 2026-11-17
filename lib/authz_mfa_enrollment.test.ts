// Issue #1281: a session restricted by required MFA enrolment acts for nobody,
// except on the MFA settings page (getSessionUserIdForMfaSetup / requireMfaSetupUserId).
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { auth } = vi.hoisted(() => ({ auth: vi.fn() }));

vi.mock('@/lib/prisma', () => ({ default: {} }));
vi.mock('@/auth', () => ({ auth }));

import { getSessionUserId, getSessionUserIdForMfaSetup, requireMfaSetupUserId } from './authz';

beforeEach(() => auth.mockReset());

describe('session user while MFA enrolment is required', () => {
  it('getSessionUserId answers null for a restricted session', async () => {
    auth.mockResolvedValue({ user: { id: 'u1' }, mfa_enrollment_required: true });
    expect(await getSessionUserId()).toBeNull();
  });

  it('the MFA setup accessors still answer for it', async () => {
    auth.mockResolvedValue({ user: { id: 'u1' }, mfa_enrollment_required: true });
    expect(await getSessionUserIdForMfaSetup()).toBe('u1');
    expect(await requireMfaSetupUserId()).toBe('u1');
  });

  it('an unrestricted session is unchanged', async () => {
    auth.mockResolvedValue({ user: { id: 'u1' }, mfa_enrollment_required: false });
    expect(await getSessionUserId()).toBe('u1');
  });

  it('requireMfaSetupUserId refuses when nobody is signed in', async () => {
    auth.mockResolvedValue(null);
    await expect(requireMfaSetupUserId()).rejects.toMatchObject({ code: 'SESSION_EXPIRED' });
  });
});
