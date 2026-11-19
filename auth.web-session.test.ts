// Issue #1127: web sessions are revocable server-side. jwt() binds each token to a web_session row
// and checks it in the user lookup it already makes; sign-out deletes the row.
import { describe, it, expect, beforeEach, vi } from "vitest";

const { userFindUnique, createWebSession, extendWebSession, revokeWebSession, needsExtension } = vi.hoisted(() => ({
  userFindUnique: vi.fn(),
  createWebSession: vi.fn(),
  extendWebSession: vi.fn(),
  revokeWebSession: vi.fn(),
  needsExtension: { value: false },
}));

vi.mock("@/lib/prisma", () => ({ default: { user: { findUnique: userFindUnique } } }));
vi.mock("next-auth", () => ({
  default: () => ({ handlers: {}, auth: vi.fn(), signIn: vi.fn(), signOut: vi.fn(), unstable_update: vi.fn() }),
  CredentialsSignin: class CredentialsSignin extends Error {},
}));
vi.mock("next-auth/providers/credentials", () => ({ default: (o: unknown) => o }));
vi.mock("next-auth/providers/google", () => ({ default: (o: unknown) => o }));
vi.mock("@auth/prisma-adapter", () => ({ PrismaAdapter: () => ({}) }));
vi.mock("@/lib/audit-log", () => ({ recordAuditEvent: vi.fn() }));
vi.mock("@/lib/mfa/verify", () => ({ verifyMfaCode: vi.fn() }));
vi.mock("@/lib/auth/create-user", () => ({ createTenantBoundUser: vi.fn() }));
vi.mock("@/lib/auth/mock-oauth-gate", () => ({ isMockGoogleOAuthTestEnabled: () => false }));
vi.mock("@/lib/auth/web-session", () => ({
  createWebSession,
  extendWebSession,
  revokeWebSession,
  webSessionNeedsExtension: () => needsExtension.value,
}));

import { authConfig } from "./auth";

type Cb = (args: Record<string, unknown>) => Promise<Record<string, unknown> | null>;
const jwt = authConfig.callbacks!.jwt as unknown as Cb;
const signOut = authConfig.events!.signOut as unknown as (m: Record<string, unknown>) => Promise<void>;

const liveUser = (sessions: Array<{ expires_at: Date }>) => ({
  mfa_enabled: false,
  mfa_token_version: 0,
  anonymized_at: null,
  web_sessions: sessions,
});
const aRow = { expires_at: new Date(Date.now() + 86_400_000) };

beforeEach(() => {
  vi.clearAllMocks();
  needsExtension.value = false;
  createWebSession.mockResolvedValue("s-new");
});

describe("jwt() and web_session", () => {
  it("records a server-side session at sign-in and stamps its id into the token", async () => {
    userFindUnique.mockResolvedValue({ mfa_enabled: false, mfa_token_version: 0 });
    const out = await jwt({ token: {}, user: { id: "u1" }, account: { provider: "credentials" } });
    expect(createWebSession).toHaveBeenCalledWith("u1", expect.objectContaining({ maxAge: expect.any(Number) }));
    expect(out?.sid).toBe("s-new");
  });

  it("checks the session in the one user lookup, as a joined relation", async () => {
    userFindUnique.mockResolvedValue(liveUser([aRow]));
    await expect(jwt({ token: { id: "u1", sid: "s1", mfa_token_version: 0 } })).resolves.toMatchObject({ id: "u1", sid: "s1" });
    expect(userFindUnique).toHaveBeenCalledTimes(1);
    const args = userFindUnique.mock.calls[0][0];
    expect(args.relationLoadStrategy).toBe("join");
    expect(args.where).toEqual({ id: "u1" });
    expect(args.select.web_sessions).toEqual({ where: { id: "s1" }, select: { expires_at: true } });
    expect(extendWebSession).not.toHaveBeenCalled();
  });

  it("ends a revoked session (its row is gone)", async () => {
    userFindUnique.mockResolvedValue(liveUser([]));
    await expect(jwt({ token: { id: "u1", sid: "s1", mfa_token_version: 0 } })).resolves.toBeNull();
  });

  it("ends the session of a deleted user", async () => {
    userFindUnique.mockResolvedValue(null);
    await expect(jwt({ token: { id: "u1", sid: "s1", mfa_token_version: 0 } })).resolves.toBeNull();
  });

  it("ends a token issued before revocation existed, without a database read", async () => {
    await expect(jwt({ token: { id: "u1", mfa_token_version: 0 } })).resolves.toBeNull();
    expect(userFindUnique).not.toHaveBeenCalled();
  });

  it("pushes the row's purge time forward once it is due", async () => {
    needsExtension.value = true;
    userFindUnique.mockResolvedValue(liveUser([aRow]));
    await jwt({ token: { id: "u1", sid: "s1", mfa_token_version: 0 } });
    expect(extendWebSession).toHaveBeenCalledWith("s1", expect.objectContaining({ updateAge: expect.any(Number) }));
  });

  it("does not let an update call revive a revoked session", async () => {
    userFindUnique.mockResolvedValue(liveUser([]));
    const out = await jwt({
      token: { id: "u1", sid: "s1", mfa_token_version: 0, mfa_pending: true },
      trigger: "update",
      session: { mfa_pending: false },
    });
    expect(out).toBeNull();
  });

  it("still clears mfa_pending on a live session's MFA challenge completion", async () => {
    userFindUnique.mockResolvedValue({ ...liveUser([aRow]), mfa_enabled: true });
    const out = await jwt({
      token: { id: "u1", sid: "s1", mfa_token_version: 0, mfa_pending: true },
      trigger: "update",
      session: { mfa_pending: false },
    });
    expect(out?.mfa_pending).toBe(false);
  });
});

describe("signOut event", () => {
  it("revokes the session server-side", async () => {
    await signOut({ token: { id: "u1", sid: "s1" } });
    expect(revokeWebSession).toHaveBeenCalledWith("s1");
  });

  it("has nothing to revoke for a token without a session id", async () => {
    await signOut({ token: { id: "u1" } });
    expect(revokeWebSession).not.toHaveBeenCalled();
  });
});
