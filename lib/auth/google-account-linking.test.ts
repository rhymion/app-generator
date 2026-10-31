import { beforeEach, describe, expect, it, vi } from 'vitest';

// Issue #1183: a Google account is identified by its `sub`, never by its email address.
// The first block reads the real provider configuration out of auth.ts. The second runs
// @auth/core's own login-or-register logic against an in-memory adapter, with the provider
// flag taken from that configuration, so the three outcomes are measured on the library
// that auth.ts hands the request to rather than inferred from its source.

vi.hoisted(() => {
  process.env.GOOGLE_CLIENT_ID = 'test-client-id';
  process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
});

vi.mock('@/lib/prisma', () => ({ default: { user: { findUnique: vi.fn() } } }));
vi.mock('next-auth', () => ({
  default: () => ({ handlers: {}, auth: vi.fn(), signIn: vi.fn(), signOut: vi.fn(), unstable_update: vi.fn() }),
  CredentialsSignin: class CredentialsSignin extends Error {},
}));
vi.mock('next-auth/providers/credentials', () => ({ default: (o: unknown) => o }));
vi.mock('next-auth/providers/google', () => ({ default: (o: unknown) => ({ id: 'google', ...(o as object) }) }));
vi.mock('@auth/prisma-adapter', () => ({ PrismaAdapter: () => ({}) }));
vi.mock('@/lib/audit-log', () => ({ recordAuditEvent: vi.fn() }));
vi.mock('@/lib/mfa/verify', () => ({ verifyMfaCode: vi.fn() }));
vi.mock('@/lib/auth/create-user', () => ({ createTenantBoundUser: vi.fn() }));
vi.mock('@/lib/auth/mock-oauth-gate', () => ({ isMockGoogleOAuthTestEnabled: () => false }));
vi.mock('@/lib/site-config', () => ({ siteConfig: { auth: { providers: ['credentials', 'google'] } } }));

import { authConfig } from '../../auth';
// @auth/core does not export this module; the relative path reads the shipped file itself.
import { handleLoginOrRegister } from '../../node_modules/@auth/core/lib/actions/callback/handle-login.js';
import { OAuthAccountNotLinked } from '../../node_modules/@auth/core/errors.js';

type GoogleProvider = { id: string; allowDangerousEmailAccountLinking?: boolean };
const google = (authConfig.providers as unknown as GoogleProvider[]).find((p) => p.id === 'google');

describe('the Google provider in auth.ts', () => {
  it('is registered', () => {
    expect(google).toBeDefined();
  });

  it('does not allow linking by email address', () => {
    expect(google?.allowDangerousEmailAccountLinking).toBeFalsy();
    expect(Object.keys(google!)).not.toContain('allowDangerousEmailAccountLinking');
  });
});

type User = { id: string; email: string; name: string };
type AccountRow = { provider: string; providerAccountId: string; userId: string };

function makeAdapter(users: User[], accounts: AccountRow[]) {
  return {
    createUser: vi.fn(async (u: Partial<User>) => {
      const created = { id: `new-${users.length + 1}`, email: u.email!, name: u.name ?? '' };
      users.push(created);
      return created;
    }),
    getUser: vi.fn(async (id: string) => users.find((u) => u.id === id) ?? null),
    getUserByEmail: vi.fn(async (email: string) => users.find((u) => u.email === email) ?? null),
    getUserByAccount: vi.fn(async ({ provider, providerAccountId }: { provider: string; providerAccountId: string }) => {
      const row = accounts.find((a) => a.provider === provider && a.providerAccountId === providerAccountId);
      return row ? (users.find((u) => u.id === row.userId) ?? null) : null;
    }),
    linkAccount: vi.fn(async (a: AccountRow) => {
      accounts.push(a);
    }),
    updateUser: vi.fn(),
    createSession: vi.fn(),
    getSessionAndUser: vi.fn(),
    deleteSession: vi.fn(),
  };
}

function login(
  adapter: ReturnType<typeof makeAdapter>,
  opts: { sessionUserId?: string; sub: string; email: string; flag?: boolean },
) {
  const options = {
    adapter,
    jwt: { decode: vi.fn(async () => (opts.sessionUserId ? { sub: opts.sessionUserId } : null)) },
    events: {},
    session: { strategy: 'jwt', generateSessionToken: () => 'token' },
    cookies: { sessionToken: { name: 'authjs.session-token' } },
    provider: { id: 'google', allowDangerousEmailAccountLinking: opts.flag ?? google?.allowDangerousEmailAccountLinking, account: (t: unknown) => t },
  };
  return handleLoginOrRegister(
    (opts.sessionUserId ? 'session-cookie' : undefined) as string,
    { id: opts.sub, email: opts.email, name: 'Someone' },
    { type: 'oidc', provider: 'google', providerAccountId: opts.sub },
    options as never,
  );
}

describe('@auth/core login-or-register with the provider as auth.ts configures it', () => {
  let users: User[];
  let accounts: AccountRow[];
  let adapter: ReturnType<typeof makeAdapter>;

  beforeEach(() => {
    users = [{ id: 'old-user', email: 'person@example.com', name: 'Person' }];
    accounts = [{ provider: 'google', providerAccountId: 'sub-original', userId: 'old-user' }];
    adapter = makeAdapter(users, accounts);
  });

  it('refuses a signed-out sign-in with a new sub and the email of an existing user', async () => {
    await expect(login(adapter, { sub: 'sub-recreated', email: 'person@example.com' })).rejects.toBeInstanceOf(OAuthAccountNotLinked);
    expect(adapter.linkAccount).not.toHaveBeenCalled();
    expect(adapter.createUser).not.toHaveBeenCalled();
    expect(accounts).toHaveLength(1);
  });

  it('links the new sub to the signed-in user, without any provider flag', async () => {
    const result = await login(adapter, { sessionUserId: 'old-user', sub: 'sub-second-google', email: 'person@example.com' });
    expect(result.user.id).toBe('old-user');
    expect(adapter.linkAccount).toHaveBeenCalledWith(expect.objectContaining({ userId: 'old-user', providerAccountId: 'sub-second-google' }));
  });

  it('signs in a sub that is already linked, whatever email it now carries', async () => {
    const result = await login(adapter, { sub: 'sub-original', email: 'changed-address@example.com' });
    expect(result.user.id).toBe('old-user');
    expect(adapter.linkAccount).not.toHaveBeenCalled();
    expect(adapter.createUser).not.toHaveBeenCalled();
  });

  it('still creates a user for an email nobody has', async () => {
    const result = await login(adapter, { sub: 'sub-brand-new', email: 'nobody@example.com' });
    expect(result.isNewUser).toBe(true);
    expect(adapter.linkAccount).toHaveBeenCalledWith(expect.objectContaining({ providerAccountId: 'sub-brand-new' }));
  });

  it('would have linked the signed-out re-created account if the flag were set (the case the flag removal closes)', async () => {
    const result = await login(adapter, { sub: 'sub-recreated', email: 'person@example.com', flag: true });
    expect(result.user.id).toBe('old-user');
    expect(adapter.linkAccount).toHaveBeenCalledWith(expect.objectContaining({ userId: 'old-user', providerAccountId: 'sub-recreated' }));
  });
});
