/**
 * Password strength (Issues #1125, #1280; ASVS V6.2.1, V6.2.4, V6.2.9, V6.2.11, V6.2.12). One
 * rule shared by registration, the settings password form, the REST/bulk credential change and
 * the password reset, so no path can set a weaker password than another. No composition rule
 * (ASVS V6.2.5). See docs/knowledge/authentication.md "Password strength".
 *
 * - at least MIN_PASSWORD_LENGTH characters;
 * - at most MAX_PASSWORD_BYTES bytes of UTF-8: bcrypt reads only the first 72 bytes, so a longer
 *   password would be cut silently (72 ASCII characters, fewer for other scripts);
 * - not a common password (lib/auth/common-passwords.ts, plus `PASSWORD_DENYLIST_FILE`);
 * - not containing a context word: the application name, the user's name or email address
 *   (local part and domain name), and `PASSWORD_CONTEXT_WORDS`;
 * - with `PASSWORD_BREACH_CHECK=hibp`, not found in the Have I Been Pwned password corpus
 *   ({@link checkPassword}; k-anonymity range query, only 5 hex characters of the SHA-1 leave).
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { logger } from '@/lib/logger';
import { siteConfig } from '@/lib/site-config';
import { COMMON_PASSWORDS } from './common-passwords';

export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_BYTES = 72;
/** Shortest context word that is checked: shorter fragments would refuse too many passwords. */
export const MIN_CONTEXT_WORD_LENGTH = 4;

/** Who the password is for, so that it can be refused for containing their name or address. */
export type PasswordContext = { email?: string | null; name?: string | null };

type Env = Record<string, string | undefined>;

let denylistCache: { file: string; entries: ReadonlySet<string> } | undefined;

/** The operator's own list (`PASSWORD_DENYLIST_FILE`, one password per line, `#` comments). */
function operatorDenylist(env: Env): ReadonlySet<string> {
  const file = (env.PASSWORD_DENYLIST_FILE ?? '').trim();
  if (!file) return new Set();
  if (denylistCache?.file !== file) {
    // An unreadable file throws: a configured list that silently did nothing would be worse.
    const entries = readFileSync(file, 'utf8')
      .split(/\r?\n/)
      .map((l) => l.trim().toLowerCase())
      .filter((l) => l !== '' && !l.startsWith('#'));
    denylistCache = { file, entries: new Set(entries) };
  }
  return denylistCache.entries;
}

function words(text: string | null | undefined): string[] {
  return (text ?? '')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => [...w].length >= MIN_CONTEXT_WORD_LENGTH);
}

/** The words a password must not contain for this user (lower case, at least 4 characters). */
export function contextWords(context: PasswordContext = {}, env: Env = process.env): string[] {
  const email = (context.email ?? '').trim().toLowerCase();
  const at = email.lastIndexOf('@');
  const local = at > 0 ? email.slice(0, at) : email;
  const domain = at > 0 ? email.slice(at + 1) : '';
  const out = new Set<string>([
    ...words(siteConfig.title),
    ...words(context.name),
    ...(local && [...local].length >= MIN_CONTEXT_WORD_LENGTH ? [local] : []),
    ...words(local),
    // The domain's labels without the public suffix-like tail (example in example.co.jp).
    ...words(domain.split('.').slice(0, -1).join(' ')).filter((w) => !['mail', 'gmail', 'outlook', 'yahoo', 'hotmail', 'icloud'].includes(w)),
    ...(env.PASSWORD_CONTEXT_WORDS ?? '').split(',').map((w) => w.trim().toLowerCase()).filter((w) => w !== ''),
  ]);
  return [...out];
}

/** Returns an error message when `password` breaks the policy, otherwise null. Synchronous: no breach check. */
export function passwordPolicyError(password: unknown, context: PasswordContext = {}, env: Env = process.env): string | null {
  if (typeof password !== 'string' || [...password].length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters long`;
  }
  if (Buffer.byteLength(password, 'utf8') > MAX_PASSWORD_BYTES) {
    return `Password must be at most ${MAX_PASSWORD_BYTES} bytes long (${MAX_PASSWORD_BYTES} plain ASCII characters)`;
  }
  const lower = password.toLowerCase();
  if (COMMON_PASSWORDS.has(lower) || operatorDenylist(env).has(lower)) {
    return 'This password is too common; choose another one';
  }
  if (contextWords(context, env).some((w) => lower.includes(w))) {
    return 'Password must not contain your name, your email address or the name of the application';
  }
  return null;
}

const HIBP_RANGE_URL = 'https://api.pwnedpasswords.com/range/';
const BREACH_CHECK_TIMEOUT_MS = 3000;

/**
 * With `PASSWORD_BREACH_CHECK=hibp`, asks the Have I Been Pwned range API whether the password
 * appears in a known breach. Only the first 5 hex characters of its SHA-1 are sent (k-anonymity),
 * with response padding. When the service cannot be reached or answers an error within 3 seconds,
 * the check is skipped and logged (fail open): an outage of a third party must not stop every
 * password change. `PASSWORD_BREACH_CHECK_URL` points it at a mirror with the same API.
 */
export async function passwordBreachError(
  password: string,
  env: Env = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  if ((env.PASSWORD_BREACH_CHECK ?? '').trim().toLowerCase() !== 'hibp') return null;
  const sha1 = createHash('sha1').update(password, 'utf8').digest('hex').toUpperCase();
  const prefix = sha1.slice(0, 5);
  const suffix = sha1.slice(5);
  const base = (env.PASSWORD_BREACH_CHECK_URL ?? '').trim() || HIBP_RANGE_URL;
  try {
    const res = await fetchImpl(`${base}${prefix}`, {
      headers: { 'Add-Padding': 'true' },
      signal: AbortSignal.timeout(BREACH_CHECK_TIMEOUT_MS),
      cache: 'no-store',
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = await res.text();
    for (const line of body.split(/\r?\n/)) {
      const [hashSuffix, count] = line.trim().split(':');
      if (hashSuffix?.toUpperCase() === suffix && Number(count) > 0) {
        return 'This password appears in a known data breach; choose another one';
      }
    }
    return null;
  } catch (err) {
    logger.warn('[password-policy] breach check skipped', { name: err instanceof Error ? err.name : typeof err });
    return null;
  }
}

/** The full check: {@link passwordPolicyError}, then the optional breach check. */
export async function checkPassword(password: unknown, context: PasswordContext = {}, env: Env = process.env): Promise<string | null> {
  const local = passwordPolicyError(password, context, env);
  if (local) return local;
  return passwordBreachError(password as string, env);
}
