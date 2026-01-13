import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getToken } from 'next-auth/jwt';

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Public routes that do not require authentication
  const PUBLIC_PATHS = [
    '/',
    '/login',
    '/register',
    '/api/auth',
    '/api/auth/',
    '/favicon.ico',
  ];

  // Allow next internals and public assets through
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/static') ||
    pathname.startsWith('/public') ||
    pathname.startsWith('/api') && pathname.startsWith('/api/auth') === false
  ) {
    // allow static, next internals; let API auth be checked below
    // Fall through to token check for APIs except auth
  }

  // allow explicit public paths
  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + '/'))) {
    return NextResponse.next();
  }

  // Check token (works in Edge runtime)
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
  if (!token) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
