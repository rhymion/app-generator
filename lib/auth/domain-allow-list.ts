/**
 * Decides whether an OAuth sign-in passes `siteConfig.auth.allowedDomains`.
 *
 * Google documents the `hd` (hosted domain) claim as the reliable way to
 * confirm Workspace-domain membership. The domain half of the email address
 * is not: a personal Google account can carry a corporate-looking address,
 * and a recycled mailbox keeps its domain. So for Google the list is matched
 * against `hd`, and a sign-in without an `hd` claim (a personal account) is
 * rejected whenever the list is non-empty. Other providers fall back to the
 * email domain. An empty list allows everyone.
 */
export function isDomainAllowed(
  provider: string,
  email: string,
  profile: { hd?: unknown } | undefined,
  allowedDomains: readonly string[],
): boolean {
  if (allowedDomains.length === 0) return true;
  const allowed = allowedDomains.map((d) => d.toLowerCase());
  if (provider === "google") {
    const hd = typeof profile?.hd === "string" ? profile.hd.toLowerCase() : null;
    return hd !== null && allowed.includes(hd);
  }
  const domain = email.split("@")[1]?.toLowerCase();
  return !!domain && allowed.includes(domain);
}

/**
 * Self-registration domain allow-list (Issue #1093): `siteConfig.auth.registrationAllowedDomains`.
 *
 * Separate from `allowedDomains` (OAuth only, matched on Google's `hd`), so a deployment that
 * restricts Google sign-in is not affected. The address's domain must equal one listed domain,
 * case-insensitively; subdomains do not match. An empty or absent list allows every address.
 */
export function isRegistrationEmailAllowed(email: string, allowedDomains: readonly string[]): boolean {
  if (allowedDomains.length === 0) return true;
  const at = email.lastIndexOf("@");
  if (at < 1) return false;
  const domain = email.slice(at + 1).trim().toLowerCase();
  return domain !== "" && allowedDomains.some((d) => d.trim().toLowerCase() === domain);
}

/** The configured list, or empty when the site config predates the setting. */
export function registrationAllowedDomains(auth: object): readonly string[] {
  const list = (auth as { registrationAllowedDomains?: unknown }).registrationAllowedDomains;
  return Array.isArray(list) ? list.filter((d): d is string => typeof d === "string") : [];
}

/** The answer when an address is outside the allow-list; it does not reveal the list. */
export const REGISTRATION_NOT_ALLOWED = {
  error: "Registration is not available for this email address.",
  code: "REGISTRATION_NOT_ALLOWED",
} as const;
