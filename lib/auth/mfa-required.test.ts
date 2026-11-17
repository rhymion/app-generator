import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/prisma', () => ({ default: {} }));

import {
  isMfaEnrollmentRequired,
  isPathAllowedWhileEnrollmentRequired,
  isPolicyActive,
  parseMfaRequiredRoles,
} from './mfa-required';

function clientWithRoles(names: string[] | null) {
  const findUnique = vi.fn().mockResolvedValue(names === null ? null : { roles: names.map((name) => ({ name })) });
  return { client: { user: { findUnique } }, findUnique };
}

describe('parseMfaRequiredRoles', () => {
  it('is off when unset or blank', () => {
    expect(isPolicyActive(parseMfaRequiredRoles(undefined))).toBe(false);
    expect(isPolicyActive(parseMfaRequiredRoles(''))).toBe(false);
    expect(isPolicyActive(parseMfaRequiredRoles(' , '))).toBe(false);
  });

  it('reads `*` as every user', () => {
    const p = parseMfaRequiredRoles('*');
    expect(p.all).toBe(true);
    expect(p.roles.size).toBe(0);
  });

  it('reads a comma-separated list of role names, trimmed', () => {
    const p = parseMfaRequiredRoles(' Admin , Approver ');
    expect(p.all).toBe(false);
    expect([...p.roles]).toEqual(['Admin', 'Approver']);
  });
});

describe('isMfaEnrollmentRequired', () => {
  it('requires a not-enrolled user holding a listed role', async () => {
    const { client } = clientWithRoles(['Staff', 'Admin']);
    expect(await isMfaEnrollmentRequired('u1', false, parseMfaRequiredRoles('Admin'), client)).toBe(true);
  });

  it('does not require a user without a listed role', async () => {
    const { client } = clientWithRoles(['Staff']);
    expect(await isMfaEnrollmentRequired('u1', false, parseMfaRequiredRoles('Admin'), client)).toBe(false);
  });

  it('matches role names exactly', async () => {
    const { client } = clientWithRoles(['admin']);
    expect(await isMfaEnrollmentRequired('u1', false, parseMfaRequiredRoles('Admin'), client)).toBe(false);
  });

  it('requires every not-enrolled user with `*`, without reading roles', async () => {
    const { client, findUnique } = clientWithRoles([]);
    expect(await isMfaEnrollmentRequired('u1', false, parseMfaRequiredRoles('*'), client)).toBe(true);
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('never requires an enrolled user, and does not query', async () => {
    const { client, findUnique } = clientWithRoles(['Admin']);
    expect(await isMfaEnrollmentRequired('u1', true, parseMfaRequiredRoles('Admin'), client)).toBe(false);
    expect(await isMfaEnrollmentRequired('u1', true, parseMfaRequiredRoles('*'), client)).toBe(false);
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('does nothing while the policy is off', async () => {
    const { client, findUnique } = clientWithRoles(['Admin']);
    expect(await isMfaEnrollmentRequired('u1', false, parseMfaRequiredRoles(''), client)).toBe(false);
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('does not require a user that no longer exists', async () => {
    const { client } = clientWithRoles(null);
    expect(await isMfaEnrollmentRequired('gone', false, parseMfaRequiredRoles('Admin'), client)).toBe(false);
  });
});

describe('isPathAllowedWhileEnrollmentRequired', () => {
  it('allows the MFA settings page and the MFA challenge only', () => {
    expect(isPathAllowedWhileEnrollmentRequired('/setting/mfa')).toBe(true);
    expect(isPathAllowedWhileEnrollmentRequired('/mfa-challenge')).toBe(true);
    expect(isPathAllowedWhileEnrollmentRequired('/')).toBe(false);
    expect(isPathAllowedWhileEnrollmentRequired('/setting')).toBe(false);
    expect(isPathAllowedWhileEnrollmentRequired('/setting/mfa-other')).toBe(false);
    expect(isPathAllowedWhileEnrollmentRequired('/role')).toBe(false);
  });
});
