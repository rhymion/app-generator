/**
 * Names and attributes of the Auth.js cookies (Issue #1274, ASVS V3.3.3).
 *
 * Auth.js names its cookies `__Secure-authjs.*` over https. A `__Secure-` cookie
 * may still carry a `Domain` attribute, so a sibling host under the same parent
 * domain can set one that the app then reads. The `__Host-` prefix forbids that:
 * the browser accepts such a cookie only with `Secure`, `Path=/` and no `Domain`,
 * so it is bound to the exact host that set it. Auth.js already uses `__Host-`
 * for its CSRF cookie; this module applies it to the session, callback-url,
 * PKCE, state and nonce cookies as well.
 *
 * The prefix needs https, and the cookie names are fixed when auth.ts is loaded,
 * so it is applied when the configured application URL (`AUTH_URL`, or
 * `NEXTAUTH_URL`) is https. Over plain http (local development, the test
 * server) Auth.js keeps its unprefixed names, and with no configured URL its
 * own defaults apply unchanged.
 *
 * `AUTH_COOKIE_HOST_PREFIX=false` turns the prefix off for a deployment that has
 * to share these cookies across hosts (a cookie with a `Domain` attribute set
 * through the Auth.js `cookies` option).
 *
 * Changing a cookie name signs every user out once: a browser still holding the
 * old `__Secure-` cookie is not recognised under the new name.
 */
import type { NextAuthConfig } from 'next-auth';

type CookiesOption = NonNullable<NextAuthConfig['cookies']>;

const HOST_PREFIX = '__Host-';

/** The cookies that get the prefix, with the Auth.js base name and any `maxAge` it sets. */
const PREFIXED_COOKIES = {
  sessionToken: { name: 'authjs.session-token' },
  callbackUrl: { name: 'authjs.callback-url' },
  pkceCodeVerifier: { name: 'authjs.pkce.code_verifier', maxAge: 60 * 15 },
  state: { name: 'authjs.state', maxAge: 60 * 15 },
  nonce: { name: 'authjs.nonce' },
} as const;

function configuredUrlIsHttps(env: Record<string, string | undefined>): boolean {
  const raw = (env.AUTH_URL || env.NEXTAUTH_URL || '').trim();
  if (!raw) return false;
  try {
    return new URL(raw).protocol === 'https:';
  } catch {
    return false;
  }
}

/** True when the Auth.js cookies are given the `__Host-` prefix. */
export function hostPrefixEnabled(env: Record<string, string | undefined> = process.env): boolean {
  if ((env.AUTH_COOKIE_HOST_PREFIX ?? '').trim().toLowerCase() === 'false') return false;
  return configuredUrlIsHttps(env);
}

/**
 * The `cookies` option for the Auth.js config, or `undefined` to keep the
 * Auth.js defaults. Every prefixed cookie is `Secure`, `HttpOnly`,
 * `SameSite=Lax`, `Path=/` and has no `Domain`, as the prefix requires.
 */
export function resolveAuthCookies(env: Record<string, string | undefined> = process.env): CookiesOption | undefined {
  if (!hostPrefixEnabled(env)) return undefined;
  const cookies: CookiesOption = {};
  for (const [key, def] of Object.entries(PREFIXED_COOKIES)) {
    (cookies as Record<string, unknown>)[key] = {
      name: `${HOST_PREFIX}${def.name}`,
      options: {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        secure: true,
        ...('maxAge' in def ? { maxAge: def.maxAge } : {}),
      },
    };
  }
  return cookies;
}
