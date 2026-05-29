import { describe, it, expect, beforeEach, vi } from 'vitest';

// vi.mock is hoisted before any imports; shared mocks must be declared via vi.hoisted.
const {
  userFindUnique,
  recoveryDeleteMany,
  recoveryCreateMany,
  verifyMfaCode,
} = vi.hoisted(() => ({
  userFindUnique: vi.fn(),
  recoveryDeleteMany: vi.fn(),
  recoveryCreateMany: vi.fn(),
  verifyMfaCode: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  default: {
    user: { findUnique: userFindUnique },
    mfa_recovery_code: {
      deleteMany: recoveryDeleteMany,
      createMany: recoveryCreateMany,
    },
  },
}));

vi.mock('./verify', () => ({ verifyMfaCode }));

import { regenerateRecoveryCodes } from './enrollment';

const ENABLED_USER = {
  id: 'user-1',
  email: 'alice@example.com',
  mfa_secret: 'v1:aabbcc:ddeeff:001122',
  mfa_enabled: true,
};

const DISABLED_USER = {
  id: 'user-2',
  email: 'bob@example.com',
  mfa_secret: null,
  mfa_enabled: false,
};

beforeEach(() => {
  userFindUnique.mockReset();
  recoveryDeleteMany.mockReset();
  recoveryCreateMany.mockReset();
  verifyMfaCode.mockReset();

  recoveryDeleteMany.mockResolvedValue({ count: 8 });
  recoveryCreateMany.mockResolvedValue({ count: 8 });
});

describe('regenerateRecoveryCodes', () => {
  it('returns 8 fresh codes and purges old ones when a valid TOTP is supplied', async () => {
    userFindUnique.mockResolvedValue(ENABLED_USER);
    verifyMfaCode.mockResolvedValue(true);

    const { recoveryCodes } = await regenerateRecoveryCodes('user-1', '123456');

    expect(recoveryCodes).toHaveLength(8);
    for (const code of recoveryCodes) {
      expect(typeof code).toBe('string');
      const dashes = (code.match(/-/g) ?? []).length;
      expect(dashes).toBe(1);
    }
    expect(recoveryDeleteMany).toHaveBeenCalledWith({ where: { user_id: 'user-1' } });
    expect(recoveryCreateMany).toHaveBeenCalledTimes(1);
    const { data } = recoveryCreateMany.mock.calls[0][0];
    expect(data).toHaveLength(8);
    for (const row of data) {
      expect(row.user_id).toBe('user-1');
      expect(typeof row.code_hash).toBe('string');
    }
  });

  it('returns 8 fresh codes when a valid recovery code is supplied', async () => {
    userFindUnique.mockResolvedValue(ENABLED_USER);
    verifyMfaCode.mockResolvedValue(true);

    const { recoveryCodes } = await regenerateRecoveryCodes('user-1', 'abcde-fghij');

    expect(recoveryCodes).toHaveLength(8);
    expect(verifyMfaCode).toHaveBeenCalledWith('user-1', 'abcde-fghij');
  });

  it('throws MFA_NOT_ENABLED and skips verification when mfa_enabled is false', async () => {
    userFindUnique.mockResolvedValue(DISABLED_USER);

    await expect(regenerateRecoveryCodes('user-2', '123456')).rejects.toThrow('MFA_NOT_ENABLED');

    expect(verifyMfaCode).not.toHaveBeenCalled();
    expect(recoveryDeleteMany).not.toHaveBeenCalled();
  });

  it('throws INVALID_CODE and leaves old codes intact when verification fails', async () => {
    userFindUnique.mockResolvedValue(ENABLED_USER);
    verifyMfaCode.mockResolvedValue(false);

    await expect(regenerateRecoveryCodes('user-1', 'wrong')).rejects.toThrow('INVALID_CODE');

    expect(recoveryDeleteMany).not.toHaveBeenCalled();
    expect(recoveryCreateMany).not.toHaveBeenCalled();
  });
});
