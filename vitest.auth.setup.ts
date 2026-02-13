import { vi } from "vitest";
import path from "path";
import fs from "fs";

// Setup environment for tests
process.env.DATABASE_URL = `file:${path.join(process.cwd(), ".test-db")}`;
// process.env.NODE_ENV = "test";
process.env.AUTH_SECRET = "test-secret-for-testing-only";

// Mock next-auth to avoid requiring a session in tests
vi.mock("next-auth/next", () => ({
  getServerSession: vi.fn(() =>
    Promise.resolve({
      user: { id: "test-user-id", email: "test@example.com" },
    })
  ),
}));

export {};
