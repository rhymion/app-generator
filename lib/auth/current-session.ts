/**
 * Which session the current request belongs to, so a credential change can end the user's other
 * sessions and keep the one that made the change (docs/knowledge/authentication.md "Ending the
 * other sessions on a credential change").
 *
 * - Web: the `sid` of the Auth.js session cookie. The session object handed to the browser does
 *   not carry `sid`, so the cookie is decoded here, on the server, with the same secret(s) and
 *   cookie name Auth.js uses.
 * - Mobile: the `session_id` of a mobile access token in `Authorization: Bearer`.
 *
 * Only a session of `userId` is returned. An API key is no session, so a change made with one
 * keeps none. Outside a request (no `headers()`), or with an unreadable cookie or token, the
 * answer is "no current session", so the caller ends every session: the safe direction.
 */
import { headers } from 'next/headers';
import { getToken } from '@auth/core/jwt';
import { isMobileJwt, verifyMobileAccessToken } from '@/lib/mobile-auth';
import { resolveAuthCookies } from './cookie-policy';
import { sessionSecrets } from './session-secrets';

export type CurrentSessionRef = { webSessionId?: string; mobileSessionId?: string };

/** Auth.js's own names when no cookie names are configured: `__Secure-` on https, plain otherwise. */
const DEFAULT_SESSION_COOKIES = ['__Secure-authjs.session-token', 'authjs.session-token'];

function sessionCookieNames(): string[] {
  const configured = (resolveAuthCookies() as { sessionToken?: { name?: string } } | undefined)?.sessionToken?.name;
  return configured ? [configured] : DEFAULT_SESSION_COOKIES;
}

async function webSessionIdOf(cookieHeader: string, userId: string): Promise<string | undefined> {
  if (!cookieHeader) return undefined;
  const secret = sessionSecrets();
  if (!secret) return undefined;
  // Only the cookie header: getToken() would otherwise fall back to an Authorization bearer value.
  const req = { headers: new Headers({ cookie: cookieHeader }) };
  for (const name of sessionCookieNames()) {
    const token = await getToken({
      req,
      secret,
      cookieName: name,
      salt: name,
      secureCookie: name.startsWith('__Secure-') || name.startsWith('__Host-'),
      logger: { error: () => {}, warn: () => {}, debug: () => {} } as never,
    }).catch(() => null);
    if (token && token.id === userId && typeof token.sid === 'string' && token.sid) return token.sid;
  }
  return undefined;
}

async function mobileSessionIdOf(authorization: string | null, userId: string): Promise<string | undefined> {
  const bearer = authorization?.startsWith('Bearer ') ? authorization.slice('Bearer '.length).trim() : '';
  if (!bearer || !isMobileJwt(bearer)) return undefined;
  try {
    const { userId: owner, sessionId } = await verifyMobileAccessToken(bearer);
    return owner === userId ? sessionId : undefined;
  } catch {
    return undefined;
  }
}

/** The web and mobile session of `userId` that sent the current request, if any. */
export async function currentSessionRef(userId: string): Promise<CurrentSessionRef> {
  let h: Headers;
  try {
    h = (await headers()) as unknown as Headers;
  } catch {
    return {};
  }
  const [webSessionId, mobileSessionId] = await Promise.all([
    webSessionIdOf(h.get('cookie') ?? '', userId),
    mobileSessionIdOf(h.get('authorization'), userId),
  ]);
  return {
    ...(webSessionId ? { webSessionId } : {}),
    ...(mobileSessionId ? { mobileSessionId } : {}),
  };
}
