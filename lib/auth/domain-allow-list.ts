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
