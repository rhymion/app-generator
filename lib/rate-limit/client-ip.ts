/**
 * Client address used as the rate-limit key for unauthenticated auth paths.
 *
 * `X-Forwarded-For` is a list: every proxy hop appends the address it received
 * the connection from, so the LEFT-most entries are whatever the client itself
 * sent and can be set to any value. Only entries appended by infrastructure we
 * control are trustworthy, and those are at the RIGHT end of the list.
 *
 * `TRUSTED_PROXY_HOPS` is the number of trusted proxies in front of the app
 * (default 1: the platform's edge, which appends the peer address it saw).
 * The key is the entry that many positions from the right. A platform that
 * overwrites the header instead of appending yields a single entry, which is
 * the same answer. A shorter list than the configured hop count falls back to
 * the left-most entry. `X-Real-IP` is only consulted when no
 * `X-Forwarded-For` header is present at all.
 */
const DEFAULT_TRUSTED_PROXY_HOPS = 1;

function trustedProxyHops(): number {
  const raw = process.env.TRUSTED_PROXY_HOPS;
  if (raw === undefined || raw.trim() === '') return DEFAULT_TRUSTED_PROXY_HOPS;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 ? n : DEFAULT_TRUSTED_PROXY_HOPS;
}

export function clientIp(headers: Headers): string {
  const fwd = headers.get('x-forwarded-for');
  if (fwd) {
    const entries = fwd.split(',').map((e) => e.trim()).filter(Boolean);
    if (entries.length > 0) {
      return entries[Math.max(0, entries.length - trustedProxyHops())]!;
    }
  }
  return headers.get('x-real-ip') ?? 'unknown';
}
