import createIntlMiddleware from 'next-intl/middleware';
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { routing } from './i18n/routing';

const intlMiddleware = createIntlMiddleware(routing);

// Paths that do not require authentication (matched after stripping locale prefix)
const PUBLIC_PATHS = ['/login', '/register', '/docs'];

// Auth.js v5 proxy. `auth()` wraps the handler and exposes `req.auth` (the
// resolved Session, or null). With `session.strategy = "database"` for
// OAuth users, this resolution involves a DB lookup against the Session
// table — `runtime: "nodejs"` below ensures Prisma works here. Credentials
// users still arrive with a JWT cookie and resolve without a DB hit.
export const proxy = auth(async (req) => {
  const { pathname } = req.nextUrl;

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
    return intlResponse;
  }

  // Protected paths — require a valid session (DB-backed for OAuth, JWT
  // for credentials, both resolved by the auth() wrapper).
  if (!req.auth) {
    const locale = localePrefix ?? routing.defaultLocale;
    const url = req.nextUrl.clone();
    url.pathname = `/${locale}/login`;
    return NextResponse.redirect(url);
  }

  return intlResponse;
});

export const config = {
  // Match all pathnames except API routes, Next.js internals, and static files
  matcher: ['/((?!api|_next|_vercel|.*\\..*).*)'],
};
// Next.js 16 proxies always run on the Node.js runtime, so Prisma (needed
// for database-strategy session resolution via auth()) works here without
// extra config.
