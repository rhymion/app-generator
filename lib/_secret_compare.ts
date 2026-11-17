import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * Compares two secrets in constant time.
 *
 * Both values are hashed to a fixed length first, so inputs of different
 * lengths are compared without throwing and without an early return that
 * depends on where they differ. Use it for every bearer or shared secret
 * (for example `CRON_SECRET`); never compare a secret with `===` or `==`.
 *
 * An empty or missing value on either side never matches, so an unset
 * environment secret cannot be satisfied by an empty header.
 */
export function secretsEqual(
  provided: string | null | undefined,
  expected: string | null | undefined,
): boolean {
  if (!provided || !expected) return false;
  const a = createHash('sha256').update(provided, 'utf8').digest();
  const b = createHash('sha256').update(expected, 'utf8').digest();
  return timingSafeEqual(a, b);
}
