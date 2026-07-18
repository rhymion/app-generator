import createIntlMiddleware from 'next-intl/middleware';
import { NextResponse, NextRequest } from 'next/server';
import { auth } from '@/auth';
import { routing } from './i18n/routing';
import { getRateLimiter } from '@/lib/rate-limit';

const intlMiddleware = createIntlMiddleware(routing);

// Paths that do not require authentication (matched after stripping locale prefix)
const PUBLIC_PATHS = ['/login', '/register', '/docs'];

// CORS for mobile clients calling entity REST routes cross-origin, including
// /api/mobile/auth/* (cmd_369, generalized from a route-local mechanism in
// cmd_374). Bearer-only auth (no cookies) makes a wildcard origin safe here.
// Configurable via MOBILE_CORS_ORIGIN for prod lockdown.
const CORS_ORIGIN = process.env.MOBILE_CORS_ORIGIN ?? '*';
const CORS_METHODS = 'GET, POST, PUT, DELETE, OPTIONS';
const CORS_HEADERS = 'Content-Type, Authorization, X-API-Key';

function addCorsHeaders(res: NextResponse): NextResponse {
  res.headers.set('Access-Control-Allow-Origin', CORS_ORIGIN);
  res.headers.set('Access-Control-Allow-Methods', CORS_METHODS);
  res.headers.set('Access-Control-Allow-Headers', CORS_HEADERS);
  return res;
}

// Map a request to the rate-limit bucket name. Returns null when the request
// shouldn't be rate-limited (e.g. `/api/auth/session` is hit on every page
// load and rate-limiting it would only hurt legitimate users).
function bucketForAuthRequest(pathname: string, method: string): string | null {
  if (!pathname.startsWith('/api/auth/')) return null;
  // Credentials submit goes through `/api/auth/callback/credentials` as a POST
  // (Auth.js v5 routes the form post through the callback endpoint), so we
  // catch it under the credentials bucket too.
  if (pathname === '/api/auth/callback/credentials' && method === 'POST') {
    return 'auth:signin:credentials';
  }
  if (pathname.startsWith('/api/auth/callback/')) return 'auth:callback';
  if (pathname.startsWith('/api/auth/signin/credentials')) return 'auth:signin:credentials';
  if (pathname.startsWith('/api/auth/signin/')) return 'auth:signin:provider';
  // Anything else under /api/auth — session reads, csrf, providers list — is
  // not abuse-prone, so it's not rate-limited.
  return null;
}

function clientIp(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0]!.trim();
  return req.headers.get('x-real-ip') ?? 'unknown';
}

/**
 * Reconstruct an external URL using X-Forwarded-* headers when running behind
 * a reverse proxy (e.g. Cloud Run). Without this, req.nextUrl reflects the
 * internal :8080 address, leaking it into Location headers on redirect.
 *
 * Next.js sets x-forwarded-host on every request (mirroring the real Host
 * header), not just when a reverse proxy is actually present, so its mere
 * presence can't be used to decide whether to strip the port. The forwarded
 * host string already carries whatever port is correct for the connection
 * that was actually made (none for Cloud Run's public hostname, :3000 for a
 * direct local connection) — trust it via the URL host setter instead of
 * blanking the port unconditionally.
 */
function buildExternalUrl(req: NextRequest, targetPath: string): URL {
  const proto = req.headers.get('x-forwarded-proto') ?? req.nextUrl.protocol.replace(':', '');
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? req.nextUrl.host;
  const url = new URL(req.nextUrl.href);
  url.protocol = proto + ':';
  url.host = host;
  url.pathname = targetPath;
  return url;
}

/**
 * Normalize Location header in redirect responses from intlMiddleware when
 * the internal port (:8080) has leaked into the URL.
 *
 * As in buildExternalUrl above, x-forwarded-host is set by Next.js on every
 * request and already carries whatever port is correct for the connection
 * actually made — it must not be blanked unconditionally.
 */
function normalizeIntlRedirect(req: NextRequest, response: NextResponse): NextResponse {
  const forwardedHost = req.headers.get('x-forwarded-host');
  if (!forwardedHost) return response;
  const { status } = response;
  if (status < 300 || status >= 400) return response;
  const location = response.headers.get('location');
  if (!location) return response;
  try {
    const proto = req.headers.get('x-forwarded-proto') ?? req.nextUrl.protocol.replace(':', '');
    const loc = new URL(location);
    loc.protocol = proto + ':';
    loc.host = forwardedHost;
    return NextResponse.redirect(loc.toString(), { status });
  } catch {
    return response;
  }
}

// Auth.js v5 proxy. `auth()` wraps the handler and exposes `req.auth` (the
// resolved Session, or null). With `session.strategy = "database"` for
// OAuth users, this resolution involves a DB lookup against the Session
// table — `runtime: "nodejs"` below ensures Prisma works here. Credentials
// users still arrive with a JWT cookie and resolve without a DB hit.
export const proxy = auth(async (req) => {
  const { pathname } = req.nextUrl;

  // Entity REST routes (/api/role, /api/user, etc.) get CORS headers and
  // never touch the session/i18n logic below — that logic assumes a page
  // request and would wrongly redirect an unauthenticated API call to
  // /login. /api/auth/* keeps its existing handling further down (NextAuth
  // owns that surface); this only covers the rest of /api/*.
  if (pathname.startsWith('/api/') && !pathname.startsWith('/api/auth/')) {
    if (req.method === 'OPTIONS') {
      return addCorsHeaders(new NextResponse(null, { status: 204 }));
    }
    return addCorsHeaders(NextResponse.next());
  }

  // Rate-limit auth endpoints before doing anything else. `bucketForAuthRequest`
  // returns null for paths we don't care about (session reads, csrf, providers
  // list) — those fall through with no overhead.
  const bucket = bucketForAuthRequest(pathname, req.method);
  if (bucket) {
    const decision = await getRateLimiter().check(bucket, clientIp(req));
    if (!decision.allowed) {
      return new NextResponse(
        JSON.stringify({ error: 'rate_limited', retryAfter: decision.retryAfterSeconds }),
        {
          status: 429,
          headers: {
            'Content-Type': 'application/json',
            'Retry-After': String(decision.retryAfterSeconds),
            'X-RateLimit-Bucket': bucket,
          },
        },
      );
    }
    // Allowed — let the request continue to the Auth.js handler. No further
    // middleware logic applies to /api/auth paths.
    return NextResponse.next();
  }

  // Non-rate-limited Auth.js endpoints (csrf, session, providers, signout)
  // still flow through this proxy because of the `/api/auth/:path*` matcher,
  // but they must NOT be touched by the i18n middleware below — that path
  // rewrites /api/auth/session to /en/api/auth/session, which 404s, and the
  // next-auth/react client (useSession, signIn) then can't read the session
  // or fetch a CSRF token. Auth.js owns the entire /api/auth/* surface, so
  // hand the request straight to the underlying handler.
  if (pathname.startsWith('/api/auth/')) {
    return NextResponse.next();
  }

  // Strip any locale prefix to normalise the path for public-path checks
  const localePrefix = routing.locales.find(
    (l) => pathname === `/${l}` || pathname.startsWith(`/${l}/`)
  );
  const pathnameWithoutLocale = localePrefix
    ? pathname.slice(`/${localePrefix}`.length) || '/'
    : pathname;

  const isPublicPath = PUBLIC_PATHS.some(
    (p) => pathnameWithoutLocale === p || pathnameWithoutLocale.startsWith(`${p}/`)
  );

  // Always run the next-intl middleware (handles locale prefix redirects/rewrites)
  const intlResponse = intlMiddleware(req);

  // Public paths — no auth check needed
  if (isPublicPath) {
    return normalizeIntlRedirect(req, intlResponse);
  }

  // Protected paths — require a valid session (DB-backed for OAuth, JWT
  // for credentials, both resolved by the auth() wrapper).
  if (!req.auth) {
    const locale = localePrefix ?? routing.defaultLocale;
    return NextResponse.redirect(buildExternalUrl(req, `/${locale}/login`));
  }

  return normalizeIntlRedirect(req, intlResponse);
});

export const config = {
  // Match all pathnames except Next.js internals and static files, plus all
  // of /api/* (cmd_369: entity REST routes need CORS headers too, not just
  // /api/auth/*). Two matchers are used: the first covers app routes, the
  // second pulls every API route through the proxy.
  matcher: [
    '/((?!api|_next|_vercel|.*\\..*).*)',
    '/api/:path*',
  ],
};
// Next.js 16 proxies always run on the Node.js runtime, so Prisma (needed
// for database-strategy session resolution via auth()) works here without
// extra config.
