import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const { userFindUnique } = vi.hoisted(() => ({ userFindUnique: vi.fn() }));

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

import { authConfig } from "./auth";

type JwtCb = (args: { token: Record<string, unknown> }) => Promise<Record<string, unknown> | null>;
const jwt = authConfig.callbacks!.jwt as unknown as JwtCb;

beforeEach(() => userFindUnique.mockReset());

describe("jwt() callback after erasure", () => {
  it("ends the session of an anonymized user", async () => {
    userFindUnique.mockResolvedValue({ mfa_enabled: false, mfa_token_version: 0, anonymized_at: new Date() });
    await expect(jwt({ token: { id: "u1", mfa_token_version: 0 } })).resolves.toBeNull();
  });

  it("keeps the session of a live user", async () => {
    userFindUnique.mockResolvedValue({ mfa_enabled: false, mfa_token_version: 0, anonymized_at: null });
    const token = { id: "u1", mfa_token_version: 0 };
    await expect(jwt({ token })).resolves.toMatchObject({ id: "u1" });
  });
});

describe("jwt() callback absolute session lifetime", () => {
  const live = { mfa_enabled: false, mfa_token_version: 0, anonymized_at: null };
  const now = () => Math.floor(Date.now() / 1000);

  async function loadJwt(limit: string | undefined) {
    vi.resetModules();
    if (limit === undefined) delete process.env.SESSION_ABSOLUTE_MAX_AGE_SECONDS;
    else process.env.SESSION_ABSOLUTE_MAX_AGE_SECONDS = limit;
    const mod = await import("./auth");
    return mod.authConfig.callbacks!.jwt as unknown as JwtCb;
  }

  afterEach(() => {
    delete process.env.SESSION_ABSOLUTE_MAX_AGE_SECONDS;
  });

  it("ends a session older than the limit even though it is active", async () => {
    userFindUnique.mockResolvedValue(live);
    const cb = await loadJwt("3600");
    await expect(cb({ token: { id: "u1", mfa_token_version: 0, session_started_at: now() - 7200 } })).resolves.toBeNull();
  });

  it("keeps a session younger than the limit", async () => {
    userFindUnique.mockResolvedValue(live);
    const cb = await loadJwt("3600");
    await expect(cb({ token: { id: "u1", mfa_token_version: 0, session_started_at: now() - 60 } })).resolves.toMatchObject({ id: "u1" });
  });

  it("ends a session whose token has no start time once a limit is set", async () => {
    userFindUnique.mockResolvedValue(live);
    const cb = await loadJwt("3600");
    await expect(cb({ token: { id: "u1", mfa_token_version: 0 } })).resolves.toBeNull();
  });

  it("leaves old sessions alone when no limit is set", async () => {
    userFindUnique.mockResolvedValue(live);
    const cb = await loadJwt(undefined);
    await expect(cb({ token: { id: "u1", mfa_token_version: 0, session_started_at: 1 } })).resolves.toMatchObject({ id: "u1" });
  });

  it("stamps the start time at sign-in", async () => {
    userFindUnique.mockResolvedValue({ mfa_enabled: false, mfa_token_version: 0 });
    const cb = (await loadJwt("3600")) as unknown as (a: Record<string, unknown>) => Promise<Record<string, unknown> | null>;
    const out = await cb({ token: {}, user: { id: "u1" }, account: { provider: "credentials" } });
    expect(out?.session_started_at).toBeGreaterThanOrEqual(now() - 5);
  });
});
