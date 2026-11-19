import { describe, it, expect, afterEach, vi } from "vitest";

// Issue #1274 (ASVS V3.3.3): auth.ts hands the __Host- cookie names to Auth.js.
vi.mock("@/lib/prisma", () => ({ default: {} }));
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

const saved = { AUTH_URL: process.env.AUTH_URL, NEXTAUTH_URL: process.env.NEXTAUTH_URL };

async function loadConfig(url: string) {
  vi.resetModules();
  delete process.env.AUTH_URL;
  process.env.NEXTAUTH_URL = url;
  return (await import("./auth")).authConfig;
}

afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe("auth.ts cookie names", () => {
  it("uses the __Host- session cookie on an https deployment", async () => {
    const config = await loadConfig("https://app.example.com");
    expect(config.cookies?.sessionToken?.name).toBe("__Host-authjs.session-token");
    expect(config.cookies?.sessionToken?.options).toMatchObject({ secure: true, path: "/" });
  });

  it("keeps the Auth.js defaults on plain http", async () => {
    const config = await loadConfig("http://localhost:3000");
    expect(config.cookies).toBeUndefined();
  });
});
