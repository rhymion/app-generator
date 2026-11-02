// Lifetime of the web session cookie (an Auth.js JWT). Read once when auth.ts is loaded.
//   SESSION_MAX_AGE_SECONDS     inactivity lifetime: the cookie expires this long after its last refresh
//                               (default 30 days, the Auth.js default).
//   SESSION_UPDATE_AGE_SECONDS  how often an active session refreshes the cookie (default 1 day).
// An unset, empty, non-numeric or non-positive value falls back to the default, so a typo can never
// switch the expiry off. The update age is capped at the max age: a refresh interval longer than the
// lifetime would let an active session expire between refreshes.
export const DEFAULT_SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
export const DEFAULT_SESSION_UPDATE_AGE_SECONDS = 24 * 60 * 60;

function positiveInteger(raw: string | undefined, fallback: number): number {
  if (raw === undefined || !/^\d+$/.test(raw.trim())) return fallback;
  const n = Number(raw.trim());
  return Number.isSafeInteger(n) && n > 0 ? n : fallback;
}

export function resolveSessionPolicy(env: Record<string, string | undefined> = process.env): {
  maxAge: number;
  updateAge: number;
} {
  const maxAge = positiveInteger(env.SESSION_MAX_AGE_SECONDS, DEFAULT_SESSION_MAX_AGE_SECONDS);
  const updateAge = Math.min(positiveInteger(env.SESSION_UPDATE_AGE_SECONDS, DEFAULT_SESSION_UPDATE_AGE_SECONDS), maxAge);
  return { maxAge, updateAge };
}
