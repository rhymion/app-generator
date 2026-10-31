import { createHash, randomBytes } from 'node:crypto';

/** Prefix of every issued API key. */
export const API_KEY_PREFIX = 'mk_';

/**
 * SHA-256 of an API key, as lowercase hex. This is the only form in which a key
 * is stored or looked up (`user.api_key_hash`).
 *
 * The hash is deterministic (no salt, no work factor) on purpose: a key is 256
 * random bits, so it cannot be guessed or brute-forced offline, and a
 * deterministic digest lets the database find the row with an index instead of
 * comparing every row. A slow or salted password hash would add cost and break
 * that lookup without adding protection for a high-entropy secret.
 *
 * The migration `prisma/sql/api_key_hash_migration.sql` computes the same value
 * with PostgreSQL's `sha256()`, so a key stored in plaintext before the change
 * keeps authenticating after it.
 */
export function hashApiKey(apiKey: string): string {
  return createHash('sha256').update(apiKey, 'utf8').digest('hex');
}

/** A new random API key. Shown to its owner once; only `hashApiKey()` of it is stored. */
export function generateApiKey(): string {
  return `${API_KEY_PREFIX}${randomBytes(32).toString('hex')}`;
}
