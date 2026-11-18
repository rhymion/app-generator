import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { encode } from '@auth/core/jwt';

// Which session sent the request (lib/auth/current-session.ts): the sid of the Auth.js cookie,
// decoded on the server, and the session id of a mobile access token.
const { requestHeaders, verifyMobile } = vi.hoisted(() => ({
  requestHeaders: { value: new Headers() as Headers | null },
  verifyMobile: vi.fn(),
}));

vi.mock('next/headers', () => ({
  headers: async () => {
    if (!requestHeaders.value) throw new Error('outside a request');
    return requestHeaders.value;
  },
}));
vi.mock('@/lib/mobile-auth', () => ({
  isMobileJwt: (t: string) => t.startsWith('mobile.'),
  verifyMobileAccessToken: verifyMobile,
}));

import { currentSessionRef } from './current-session';

const SECRET = 'a'.repeat(64);
const env = { ...process.env };

async function cookie(name: string, payload: Record<string, unknown>, secret = SECRET) {
  return `${name}=${await encode({ token: payload, secret, salt: name })}`;
}

beforeEach(() => {
  process.env.AUTH_SECRET = SECRET;
  delete process.env.AUTH_SECRET_PREVIOUS;
  delete process.env.NEXTAUTH_URL;
  delete process.env.AUTH_URL;
  requestHeaders.value = new Headers();
  verifyMobile.mockReset();
});

afterEach(() => {
  process.env = { ...env };
});

describe('currentSessionRef', () => {
  it('reads the sid of the session cookie of the same user', async () => {
    requestHeaders.value = new Headers({ cookie: await cookie('authjs.session-token', { id: 'u1', sid: 's1' }) });
    expect(await currentSessionRef('u1')).toEqual({ webSessionId: 's1' });
  });

  it('reads the __Secure- cookie Auth.js uses on https', async () => {
    requestHeaders.value = new Headers({ cookie: await cookie('__Secure-authjs.session-token', { id: 'u1', sid: 's2' }) });
    expect(await currentSessionRef('u1')).toEqual({ webSessionId: 's2' });
  });

  it('reads the __Host- cookie when the prefix is configured', async () => {
    process.env.NEXTAUTH_URL = 'https://app.example.com';
    requestHeaders.value = new Headers({ cookie: await cookie('__Host-authjs.session-token', { id: 'u1', sid: 's3' }) });
    expect(await currentSessionRef('u1')).toEqual({ webSessionId: 's3' });
  });

  it('reads a cookie signed with the previous secret while it is rotated', async () => {
    process.env.AUTH_SECRET_PREVIOUS = 'b'.repeat(64);
    requestHeaders.value = new Headers({
      cookie: await cookie('authjs.session-token', { id: 'u1', sid: 's4' }, 'b'.repeat(64)),
    });
    expect(await currentSessionRef('u1')).toEqual({ webSessionId: 's4' });
  });

  it("ignores another user's session, a forged cookie and a cookie without sid", async () => {
    requestHeaders.value = new Headers({ cookie: await cookie('authjs.session-token', { id: 'u2', sid: 's1' }) });
    expect(await currentSessionRef('u1')).toEqual({});
    requestHeaders.value = new Headers({ cookie: await cookie('authjs.session-token', { id: 'u1', sid: 's1' }, 'c'.repeat(64)) });
    expect(await currentSessionRef('u1')).toEqual({});
    requestHeaders.value = new Headers({ cookie: await cookie('authjs.session-token', { id: 'u1' }) });
    expect(await currentSessionRef('u1')).toEqual({});
    requestHeaders.value = new Headers({ cookie: 'authjs.session-token=garbage' });
    expect(await currentSessionRef('u1')).toEqual({});
  });

  it('reads the session of a mobile access token of the same user', async () => {
    verifyMobile.mockResolvedValue({ userId: 'u1', sessionId: 'm1' });
    requestHeaders.value = new Headers({ authorization: 'Bearer mobile.token' });
    expect(await currentSessionRef('u1')).toEqual({ mobileSessionId: 'm1' });
    verifyMobile.mockResolvedValue({ userId: 'u2', sessionId: 'm2' });
    expect(await currentSessionRef('u1')).toEqual({});
  });

  it('keeps no session for an API key or an invalid mobile token', async () => {
    requestHeaders.value = new Headers({ authorization: 'Bearer sk_live_key' });
    expect(await currentSessionRef('u1')).toEqual({});
    expect(verifyMobile).not.toHaveBeenCalled();
    verifyMobile.mockRejectedValue(new Error('expired'));
    requestHeaders.value = new Headers({ authorization: 'Bearer mobile.expired' });
    expect(await currentSessionRef('u1')).toEqual({});
  });

  it('keeps no session outside a request', async () => {
    requestHeaders.value = null;
    expect(await currentSessionRef('u1')).toEqual({});
  });
});
