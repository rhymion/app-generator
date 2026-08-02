// A base origin used purely as the resolution anchor for `new URL()` below —
// never sent anywhere. If `value` carries its own scheme/host (absolute URL,
// or a protocol-relative "//host" URL), resolving it against this base
// yields a *different* origin, which is how we detect and reject it.
const SAFE_REDIRECT_BASE = 'http://safe-redirect.invalid';

/**
 * Validates a post-login redirect target so it can only ever send the user
 * back into this same site — never off-site (open redirect).
 *
 * Accepts only path-absolute, same-origin values (e.g. "/en/dashboard",
 * "/en/setting?tab=2"). Rejects protocol-relative ("//evil.com"), absolute
 * ("https://evil.com"), and anything that fails to parse. Returns the
 * normalized "pathname + search + hash" on success, or `null` on rejection.
 */
export function safeRedirectPath(value: string | null | undefined): string | null {
  if (!value || !value.startsWith('/')) return null;

  let resolved: URL;
  try {
    resolved = new URL(value, SAFE_REDIRECT_BASE);
  } catch {
    return null;
  }

  if (resolved.origin !== SAFE_REDIRECT_BASE) return null;

  return resolved.pathname + resolved.search + resolved.hash;
}
