import { describe, it, expect } from 'vitest';
import { hostPrefixEnabled, resolveAuthCookies } from './cookie-policy';

// Issue #1274 (ASVS V3.3.3): the Auth.js cookies carry the __Host- prefix on an https deployment.
describe('resolveAuthCookies', () => {
  const https = { NEXTAUTH_URL: 'https://app.example.com' };

  it('gives the session, callback-url, PKCE, state and nonce cookies the __Host- prefix over https', () => {
    const cookies = resolveAuthCookies(https)!;
    expect(cookies.sessionToken?.name).toBe('__Host-authjs.session-token');
    expect(cookies.callbackUrl?.name).toBe('__Host-authjs.callback-url');
    expect(cookies.pkceCodeVerifier?.name).toBe('__Host-authjs.pkce.code_verifier');
    expect(cookies.state?.name).toBe('__Host-authjs.state');
    expect(cookies.nonce?.name).toBe('__Host-authjs.nonce');
  });

  it('sets the attributes the prefix requires: Secure, Path=/ and no Domain', () => {
    const cookies = resolveAuthCookies(https)!;
    for (const cookie of Object.values(cookies)) {
      expect(cookie?.options).toMatchObject({ secure: true, path: '/', httpOnly: true, sameSite: 'lax' });
      expect(cookie?.options).not.toHaveProperty('domain');
    }
  });

  it('keeps the Auth.js lifetime of the PKCE and state cookies', () => {
    const cookies = resolveAuthCookies(https)!;
    expect(cookies.pkceCodeVerifier?.options?.maxAge).toBe(900);
    expect(cookies.state?.options?.maxAge).toBe(900);
    expect(cookies.sessionToken?.options).not.toHaveProperty('maxAge');
  });

  it('prefers AUTH_URL over NEXTAUTH_URL', () => {
    expect(hostPrefixEnabled({ AUTH_URL: 'http://localhost:3000', NEXTAUTH_URL: 'https://app.example.com' })).toBe(false);
    expect(hostPrefixEnabled({ AUTH_URL: 'https://app.example.com', NEXTAUTH_URL: 'http://localhost:3000' })).toBe(true);
  });

  it('keeps the Auth.js defaults over http, with no configured URL or an unparsable one', () => {
    expect(resolveAuthCookies({ NEXTAUTH_URL: 'http://localhost:3000' })).toBeUndefined();
    expect(resolveAuthCookies({})).toBeUndefined();
    expect(resolveAuthCookies({ NEXTAUTH_URL: 'not a url' })).toBeUndefined();
  });

  it('is turned off by AUTH_COOKIE_HOST_PREFIX=false', () => {
    expect(resolveAuthCookies({ ...https, AUTH_COOKIE_HOST_PREFIX: 'false' })).toBeUndefined();
    expect(resolveAuthCookies({ ...https, AUTH_COOKIE_HOST_PREFIX: ' FALSE ' })).toBeUndefined();
    expect(resolveAuthCookies({ ...https, AUTH_COOKIE_HOST_PREFIX: 'true' })).toBeDefined();
  });
});
