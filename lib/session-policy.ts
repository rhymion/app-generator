// Lifetime of the web session cookie (an Auth.js JWT). Read once when auth.ts is loaded.
//   SESSION_MAX_AGE_SECONDS     inactivity lifetime: the cookie expires this long after its last refresh
//                               (default 30 days, the Auth.js default).
//   SESSION_UPDATE_AGE_SECONDS  how often an active session refreshes the cookie (default 1 day).
//   SESSION_ABSOLUTE_MAX_AGE_SECONDS  optional upper bound on a session, counted from sign-in however active the
//                               user is. Unset (the default) means no absolute limit.
// An unset, empty, non-numeric or non-positive value falls back to the default, so a typo can never
// switch the expiry off. The update age is capped at the max age: a refresh interval longer than the
// lifetime would let an active session expire between refreshes. The absolute lifetime is the one setting
// where an unset, empty or invalid value means "disabled" (not a default), so existing deployments are unchanged.
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
  absoluteMaxAge: number | null;
} {
  const maxAge = positiveInteger(env.SESSION_MAX_AGE_SECONDS, DEFAULT_SESSION_MAX_AGE_SECONDS);
  const updateAge = Math.min(positiveInteger(env.SESSION_UPDATE_AGE_SECONDS, DEFAULT_SESSION_UPDATE_AGE_SECONDS), maxAge);
  const absoluteMaxAge = positiveInteger(env.SESSION_ABSOLUTE_MAX_AGE_SECONDS, 0) || null;
  return { maxAge, updateAge, absoluteMaxAge };
}

// True when a session that started at `startedAt` (Unix seconds, stamped into the token at sign-in) has outlived
// the absolute lifetime. With a limit configured, a token that carries no valid start time is treated as expired:
// it was issued before the limit existed, and trusting it would let such a session bypass the limit for good.
export function isPastAbsoluteLifetime(
  startedAt: unknown,
  absoluteMaxAge: number | null,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): boolean {
  if (absoluteMaxAge === null) return false;
  if (typeof startedAt !== "number" || !Number.isFinite(startedAt)) return true;
  return nowSeconds - startedAt >= absoluteMaxAge;
}
