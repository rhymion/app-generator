// Pins sslmode to `verify-full` when the URL requests SSL via the aliased
// modes (`prefer`, `require`, `verify-ca`). Today, node-postgres's
// pg-connection-string treats all four of prefer/require/verify-ca/verify-full
// identically (full certificate verification) and only emits a one-time
// deprecation warning for the first three. In pg-connection-string v3.0.0 /
// pg v9.0.0, those three will switch to standard libpq semantics (weaker
// verification) — `verify-full` is the one spelling guaranteed to keep
// today's strict behavior across that version bump. No-op when sslmode is
// absent (local/CI Postgres, which has no such param) or is anything else.
// See node_modules/pg-connection-string/index.js (deprecatedSslModeWarning)
// and docs/knowledge/pg-connection-string-sslmode-deprecation.md.
export function pinSslModeVerifyFull(rawUrl: string): string {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return rawUrl;
  }
  const sslmode = url.searchParams.get('sslmode');
  if (sslmode === 'prefer' || sslmode === 'require' || sslmode === 'verify-ca') {
    url.searchParams.set('sslmode', 'verify-full');
  }
  return url.toString();
}
