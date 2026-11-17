// Issue #1281: MFA_REQUIRED_ROLES marks the session of a not-enrolled user whose
// role requires MFA, on every sign-in method and on every later request.
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

type Cb = (args: Record<string, unknown>) => Promise<Record<string, unknown> | null>;
const jwt = authConfig.callbacks!.jwt as unknown as Cb;
const session = authConfig.callbacks!.session as unknown as Cb;

/** A user row: the MFA columns for the jwt() read, the role names for the policy read. */
function stubUser(mfaEnabled: boolean, roles: string[]) {
  userFindUnique.mockImplementation(async (args?: { select?: Record<string, unknown> }) =>
    args?.select && "roles" in args.select
      ? { roles: roles.map((name) => ({ name })) }
      : { mfa_enabled: mfaEnabled, mfa_token_version: 0, anonymized_at: null },
  );
}

const signIn = (provider: string) => ({
  token: { id: "u1" },
  user: { id: "u1" },
  account: { provider },
});

beforeEach(() => userFindUnique.mockReset());
afterEach(() => {
  delete process.env.MFA_REQUIRED_ROLES;
});

describe("jwt() with MFA_REQUIRED_ROLES", () => {
  it("restricts a not-enrolled user whose role is listed, at credentials sign-in", async () => {
    process.env.MFA_REQUIRED_ROLES = "Admin";
    stubUser(false, ["Admin"]);
    await expect(jwt(signIn("credentials"))).resolves.toMatchObject({ mfa_enrollment_required: true });
  });

  it("restricts the same user at OAuth sign-in", async () => {
    process.env.MFA_REQUIRED_ROLES = "Admin";
    stubUser(false, ["Admin"]);
    await expect(jwt(signIn("google"))).resolves.toMatchObject({ mfa_enrollment_required: true });
  });

  it("does not restrict a user whose roles are not listed", async () => {
    process.env.MFA_REQUIRED_ROLES = "Admin";
    stubUser(false, ["Staff"]);
    await expect(jwt(signIn("credentials"))).resolves.toMatchObject({ mfa_enrollment_required: false });
  });

  it("does not restrict an enrolled user", async () => {
    process.env.MFA_REQUIRED_ROLES = "*";
    stubUser(true, ["Admin"]);
    await expect(jwt({ token: { id: "u1", mfa_token_version: 0 } })).resolves.toMatchObject({
      mfa_enrollment_required: false,
    });
  });

  it("restricts nobody while the variable is unset", async () => {
    stubUser(false, ["Admin"]);
    await expect(jwt(signIn("credentials"))).resolves.toMatchObject({ mfa_enrollment_required: false });
  });

  it("lifts the restriction on the next request once the user has enrolled", async () => {
    process.env.MFA_REQUIRED_ROLES = "*";
    stubUser(true, []);
    const token = { id: "u1", mfa_token_version: 0, mfa_enrollment_required: true };
    await expect(jwt({ token })).resolves.toMatchObject({ mfa_enrollment_required: false });
  });

  it("restricts an existing session when the policy starts applying to it", async () => {
    process.env.MFA_REQUIRED_ROLES = "Admin";
    stubUser(false, ["Admin"]);
    await expect(jwt({ token: { id: "u1", mfa_token_version: 0 } })).resolves.toMatchObject({
      mfa_enrollment_required: true,
    });
  });
});

describe("session() exposes the restriction", () => {
  it("copies mfa_enrollment_required from the token", async () => {
    const s = await session({ session: { user: {} }, token: { id: "u1", mfa_enrollment_required: true } });
    expect(s).toMatchObject({ user: { id: "u1" }, mfa_enrollment_required: true });
  });

  it("defaults to false", async () => {
    const s = await session({ session: { user: {} }, token: { id: "u1" } });
    expect(s).toMatchObject({ mfa_enrollment_required: false });
  });
});
