// Fail-fast checks that the database and Redis connection strings are protected in transit.
//
// The checks apply only to a hosted production deployment: the platform sets K_SERVICE (Cloud Run)
// or VERCEL, and NODE_ENV is "production". Local development, `next start` against a Docker
// database (the e2e gates) and CI never set those variables, so plain connections stay allowed there.

export type TransportEnv = Record<string, string | undefined>;

export function isHostedProduction(env: TransportEnv = process.env): boolean {
  return env.NODE_ENV === 'production' && Boolean(env.K_SERVICE || env.VERCEL);
}

const TLS_SSLMODES = new Set(['require', 'verify-ca', 'verify-full', 'prefer']);

/** True when the URL asks for TLS (sslmode or the `ssl` flag) or reaches the server over a Unix socket. */
function databaseUrlIsProtected(rawUrl: string): boolean {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }
  const hostParam = url.searchParams.get('host');
  if ((hostParam && hostParam.startsWith('/')) || (!url.hostname && !hostParam)) {
    // Unix socket (for example Cloud SQL's /cloudsql/<instance>): no network hop to protect.
    return true;
  }
  const sslmode = url.searchParams.get('sslmode');
  if (sslmode) return TLS_SSLMODES.has(sslmode);
  const ssl = url.searchParams.get('ssl');
  return ssl === 'true' || ssl === '1';
}

export function assertSecureDatabaseUrl(rawUrl: string | undefined, env: TransportEnv = process.env): void {
  if (!isHostedProduction(env) || !rawUrl) return;
  if (!databaseUrlIsProtected(rawUrl)) {
    throw new Error(
      'DATABASE_URL must use TLS in production: add sslmode=require (or verify-full) to the connection string.',
    );
  }
}

export function assertSecureRedisUrl(rawUrl: string | undefined, env: TransportEnv = process.env): void {
  if (!isHostedProduction(env) || !rawUrl) return;
  let protocol = '';
  try {
    protocol = new URL(rawUrl).protocol;
  } catch {
    // An unparsable URL is rejected below with the same message.
  }
  if (protocol !== 'rediss:') {
    throw new Error('REDIS_URL must use TLS in production: use a rediss:// URL.');
  }
}
