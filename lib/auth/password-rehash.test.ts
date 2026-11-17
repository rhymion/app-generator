import bcrypt from 'bcryptjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/prisma', () => ({ default: {} }));
vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import { rehashPasswordIfNeeded } from './password-rehash';

const updateMany = vi.fn();
const db = { user: { updateMany } };

beforeEach(() => {
  updateMany.mockReset();
  updateMany.mockResolvedValue({ count: 1 });
});

afterEach(() => {
  delete process.env.BCRYPT_COST;
});

describe('rehashPasswordIfNeeded (Issue #1291)', () => {
  it('replaces a hash at another cost, conditional on the stored hash', async () => {
    const stored = await bcrypt.hash('pw-123456', 10);
    process.env.BCRYPT_COST = '11';
    await expect(rehashPasswordIfNeeded('user-1', 'pw-123456', stored, db)).resolves.toBe(true);
    const args = updateMany.mock.calls[0][0];
    expect(args.where).toEqual({ id: 'user-1', password: stored });
    expect(bcrypt.getRounds(args.data.password)).toBe(11);
    expect(await bcrypt.compare('pw-123456', args.data.password)).toBe(true);
  });

  it('writes nothing when the hash already has the configured cost', async () => {
    const stored = await bcrypt.hash('pw-123456', 10);
    await expect(rehashPasswordIfNeeded('user-1', 'pw-123456', stored, db)).resolves.toBe(false);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('reports no change when the password changed in the meantime', async () => {
    const stored = await bcrypt.hash('pw-123456', 10);
    process.env.BCRYPT_COST = '11';
    updateMany.mockResolvedValue({ count: 0 });
    await expect(rehashPasswordIfNeeded('user-1', 'pw-123456', stored, db)).resolves.toBe(false);
  });

  it('does not fail the sign-in when the write fails or the setting is invalid', async () => {
    const stored = await bcrypt.hash('pw-123456', 10);
    process.env.BCRYPT_COST = '11';
    updateMany.mockRejectedValue(new Error('db down'));
    await expect(rehashPasswordIfNeeded('user-1', 'pw-123456', stored, db)).resolves.toBe(false);
    process.env.BCRYPT_COST = '99';
    await expect(rehashPasswordIfNeeded('user-1', 'pw-123456', stored, db)).resolves.toBe(false);
  });
});
