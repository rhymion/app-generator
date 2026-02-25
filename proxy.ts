import createIntlMiddleware from 'next-intl/middleware';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { routing } from './i18n/routing';

const intlMiddleware = createIntlMiddleware(routing);

// Paths that do not require authentication (matched after stripping locale prefix)
const PUBLIC_PATHS = ['/login', '/register'];

export async function proxy(req: NextRequest) {
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

  // Protected paths — require a valid session token
  const token = await getToken({ req, secret: process.env.AUTH_SECRET });
  if (!token) {
    const locale = localePrefix ?? routing.defaultLocale;
    const url = req.nextUrl.clone();
    url.pathname = `/${locale}/login`;
    return NextResponse.redirect(url);
  }

  return intlResponse;
}

export const config = {
  // Match all pathnames except API routes, Next.js internals, and static files
  matcher: ['/((?!api|_next|_vercel|.*\\..*).*)'],
};
