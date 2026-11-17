/**
 * Rehash on sign-in (Issue #1291): after a password has been verified, a stored hash whose bcrypt
 * cost differs from `BCRYPT_COST` is replaced with one at the configured cost.
 *
 * The write is conditional on the stored hash being unchanged, so a password change that lands
 * between the read and this write is never overwritten. A failure is logged and the sign-in goes
 * on: the old hash still verifies, and the next sign-in tries again.
 */
import { logger } from '@/lib/logger';
import prisma from '@/lib/prisma';
import { hashPassword, passwordNeedsRehash } from './bcrypt-cost';

type UserPasswordStore = {
  user: {
    updateMany: (args: { where: { id: string; password: string }; data: { password: string } }) => Promise<{ count: number }>;
  };
};

/** Returns true when the stored hash was replaced. Call only after `password` matched `storedHash`. */
export async function rehashPasswordIfNeeded(
  userId: string,
  password: string,
  storedHash: string,
  db: UserPasswordStore = prisma as unknown as UserPasswordStore,
): Promise<boolean> {
  try {
    if (!passwordNeedsRehash(storedHash)) return false;
    const updated = await db.user.updateMany({
      where: { id: userId, password: storedHash },
      data: { password: await hashPassword(password) },
    });
    return updated.count === 1;
  } catch (err) {
    logger.warn('[auth] password rehash failed', { name: err instanceof Error ? err.name : typeof err });
    return false;
  }
}
