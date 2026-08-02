import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import fs from "node:fs";

// Kept as a standalone module specifically so this gate's fail-closed logic
// can be unit tested — importing auth.ts directly in vitest fails with
// "Cannot find module next/server" (next-auth transitively imports a
// Next.js-bundler-only subpath the Vite-based resolver vitest uses can't
// handle). See mock-oauth-gate.ts's header comment and
// docs/knowledge/authentication.md for the full "what's unit-testable vs.
// what needs e2e" split (cmd_528).
import {
  isMockGoogleOAuthTestEnabled,
  MOCK_OAUTH_SENTINEL_PATH,
} from "./mock-oauth-gate";

const ORIGINAL_ENV = { ...process.env };

describe("isMockGoogleOAuthTestEnabled — second, independently-sourced gate (cmd_528)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    process.env = { ...ORIGINAL_ENV };
    delete process.env.MOCK_GOOGLE_OAUTH_TEST;
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it("returns false when the flag is unset, without ever touching the filesystem", () => {
    const statSpy = vi.spyOn(fs, "statSync");
    expect(isMockGoogleOAuthTestEnabled()).toBe(false);
    expect(statSpy).not.toHaveBeenCalled();
  });

  it("returns false when the flag is set to a non-'true' string (e.g. accidental '1' or 'True')", () => {
    process.env.MOCK_GOOGLE_OAUTH_TEST = "1";
    expect(isMockGoogleOAuthTestEnabled()).toBe(false);
    process.env.MOCK_GOOGLE_OAUTH_TEST = "True";
    expect(isMockGoogleOAuthTestEnabled()).toBe(false);
  });

  it("fails closed (throws) when the flag is set but the sentinel file is missing", () => {
    process.env.MOCK_GOOGLE_OAUTH_TEST = "true";
    vi.spyOn(fs, "statSync").mockImplementation(() => {
      throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    });

    expect(() => isMockGoogleOAuthTestEnabled()).toThrow(/sentinel/i);
    expect(() => isMockGoogleOAuthTestEnabled()).toThrow(MOCK_OAUTH_SENTINEL_PATH);
  });

  it("fails closed (throws) when the sentinel path exists but is not a regular file", () => {
    process.env.MOCK_GOOGLE_OAUTH_TEST = "true";
    vi.spyOn(fs, "statSync").mockReturnValue({
      isFile: () => false,
    } as unknown as ReturnType<typeof fs.statSync>);

    expect(() => isMockGoogleOAuthTestEnabled()).toThrow(/sentinel/i);
  });

  it("returns true only when BOTH the flag and the sentinel file are present", () => {
    process.env.MOCK_GOOGLE_OAUTH_TEST = "true";
    const statSpy = vi.spyOn(fs, "statSync").mockReturnValue({
      isFile: () => true,
    } as unknown as ReturnType<typeof fs.statSync>);

    expect(isMockGoogleOAuthTestEnabled()).toBe(true);
    expect(statSpy).toHaveBeenCalledWith(MOCK_OAUTH_SENTINEL_PATH);
  });
});
