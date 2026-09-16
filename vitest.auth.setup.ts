import { vi } from "vitest";
import path from "path";

// Setup environment for tests
process.env.DATABASE_URL = `file:${path.join(process.cwd(), ".test-db")}`;
// process.env.NODE_ENV = "test";
process.env.AUTH_SECRET = "test-secret-for-testing-only";

// Mock @/auth's exported helpers to avoid requiring a real session in tests.
// Auth.js v5 callers reach for `auth()` (replaces v4's `getServerSession`).
vi.mock("@/auth", () => ({
  auth: vi.fn(() =>
    Promise.resolve({
      user: { id: "test-user-id", email: "test@example.com" },
    })
  ),
  signIn: vi.fn(),
  signOut: vi.fn(),
  handlers: { GET: vi.fn(), POST: vi.fn() },
}));

export {};
