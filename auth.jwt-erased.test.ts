import { describe, it, expect, beforeEach, vi } from "vitest";

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
