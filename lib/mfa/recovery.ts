/**
 * Recovery codes — the "I lost my phone" escape hatch.
 *
 * Eight 10-character base32 codes per enrolment, displayed once to the
 * user and stored bcrypt-hashed. Single-use: a successful verification
 * marks the row's `used_at`, after which the same code can never sign
 * the user in again. When all codes are consumed, the user has to
 * disable MFA from a verified device and re-enrol.
 *
 * The display format inserts a dash midway (`abcde-fghij`) for
 * readability; verification strips it back out so users who copy the
 * code from a manager that strips punctuation still get through.
 */
import { randomBytes, timingSafeEqual } from 'node:crypto';
import bcrypt from 'bcryptjs';

const CODE_COUNT = 8;
const CODE_BYTES = 8; // ~10 base32 chars after encoding
const BCRYPT_COST = 10;

/** Base32 alphabet without I/L/O/0/1 to avoid look-alikes. */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function encodeBase32(buf: Buffer): string {
  let out = '';
  for (let i = 0; i < buf.length; i++) {
    out += ALPHABET[buf[i] % ALPHABET.length];
  }
  return out;
}

function formatForDisplay(raw: string): string {
  const half = Math.floor(raw.length / 2);
  return `${raw.slice(0, half)}-${raw.slice(half)}`.toLowerCase();
}

function normalize(code: string): string {
  return code.replace(/[\s-]/g, '').toUpperCase();
}

export type RecoveryCodePair = {
  /** Plaintext code for one-time display to the user. */
  plaintext: string;
  /** bcrypt hash, what actually lands in the DB. */
  hash: string;
};

export async function generateRecoveryCodes(): Promise<RecoveryCodePair[]> {
  const pairs: RecoveryCodePair[] = [];
  for (let i = 0; i < CODE_COUNT; i++) {
    const raw = encodeBase32(randomBytes(CODE_BYTES)).slice(0, 10);
    const plaintext = formatForDisplay(raw);
    // bcrypt operates on the *normalized* form so verification doesn't have
    // to guess at the user's punctuation/case habits.
    const hash = await bcrypt.hash(raw, BCRYPT_COST);
    pairs.push({ plaintext, hash });
  }
  return pairs;
}

/** Returns true iff `candidate` matches `hash`. Constant-time at the
 *  bcrypt layer. */
export async function verifyRecoveryCode(candidate: string, hash: string): Promise<boolean> {
  const normalized = normalize(candidate);
  if (normalized.length === 0) return false;
  try {
    return await bcrypt.compare(normalized, hash);
  } catch {
    return false;
  }
}

/** Constant-time match used by tests / helpers that already have plaintext. */
export function plaintextEqual(a: string, b: string): boolean {
  const ab = Buffer.from(normalize(a), 'utf8');
  const bb = Buffer.from(normalize(b), 'utf8');
  if (ab.length !== bb.length) {
    timingSafeEqual(ab, ab);
    return false;
  }
  return timingSafeEqual(ab, bb);
}
