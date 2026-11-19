import { secretsEqual } from '@/lib/_secret_compare';

/**
 * The secret(s) Auth.js signs and reads the session cookie with. While AUTH_SECRET is being
 * rotated, AUTH_SECRET_PREVIOUS holds the old value: sessions issued under it stay valid and are
 * re-issued under the new one (Auth.js tries each secret in turn and signs with the first). See
 * docs/knowledge/authentication.md "Rotating AUTH_SECRET" (#1291).
 */
export function sessionSecrets(env: Record<string, string | undefined> = process.env): string | string[] | undefined {
  const current = env.AUTH_SECRET;
  const previous = (env.AUTH_SECRET_PREVIOUS ?? '').trim();
  return current && previous && !secretsEqual(previous, current) ? [current, previous] : current;
}
