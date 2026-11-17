/**
 * The bcrypt cost for stored password hashes (Issue #1291, ASVS V11.4.2).
 *
 * `BCRYPT_COST` sets it, from 10 (the default) to 15. A value outside that range or not an
 * integer stops every password write with an error instead of silently using a weaker cost.
 * A hash with a different cost still verifies; sign-in replaces it with one at the configured
 * cost (lib/auth/password-rehash.ts), so raising the setting upgrades accounts as they sign in.
 *
 * Recovery codes (lib/mfa/recovery.ts) keep cost 10: they are random, single-use, and up to
 * eight are compared per attempt.
 */
import bcrypt from 'bcryptjs';

export const DEFAULT_BCRYPT_COST = 10;
export const MIN_BCRYPT_COST = 10;
export const MAX_BCRYPT_COST = 15;

/** The configured cost; throws when `BCRYPT_COST` is set to something other than an integer from 10 to 15. */
export function bcryptCost(env: Record<string, string | undefined> = process.env): number {
  const raw = (env.BCRYPT_COST ?? '').trim();
  if (raw === '') return DEFAULT_BCRYPT_COST;
  const cost = /^\d+$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isInteger(cost) || cost < MIN_BCRYPT_COST || cost > MAX_BCRYPT_COST) {
    throw new Error(`BCRYPT_COST must be an integer from ${MIN_BCRYPT_COST} to ${MAX_BCRYPT_COST}`);
  }
  return cost;
}

/** A bcrypt hash of `password` at the configured cost. */
export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, bcryptCost());
}

/** True when `storedHash` is a bcrypt hash whose cost differs from the configured one. */
export function passwordNeedsRehash(storedHash: string): boolean {
  const match = /^\$2[abxy]?\$(\d{2})\$[./A-Za-z0-9]{53}$/.exec(storedHash);
  return match !== null && Number(match[1]) !== bcryptCost();
}
