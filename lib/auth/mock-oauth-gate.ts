import fs from "node:fs";
import path from "node:path";

// Second, independently-sourced gate for the mock Google OAuth test
// provider (cmd_528, hardening cmd_527's MOCK_GOOGLE_OAUTH_TEST). A single
// env var is not an acceptable gate on its own: if it ever leaks into a real
// deploy's environment (e.g. a platform env var mistakenly scoped to
// "all environments" instead of just Preview), anyone who knows a user's
// email could sign in as them with zero password/MFA check — the exact
// class of bug this file's mock provider is meant to help catch, not create.
//
// Experimentally verified (cmd_528) that a second env var cannot be the
// fix: `next build` (Turbopack) bakes in `process.env.NODE_ENV` at build
// time regardless of access syntax — `process.env.NODE_ENV`,
// `process.env["NODE_ENV"]`, and even `process.env[k]` for a
// module-level-const `k = "NODE_ENV"` all compiled down to the literal
// string `"production"` in a throwaway probe route's build output. There is
// no bracket-notation escape hatch, and stacking a second *env var* behind
// MOCK_GOOGLE_OAUTH_TEST wouldn't add an independent gate anyway — both
// would sit behind the exact same "flip it in the platform dashboard"
// channel.
//
// So the second gate is a filesystem sentinel instead of an env var. It is
// written only by `scripts/write-mock-oauth-sentinel.js`, wired into the
// e2e npm scripts' `pre*` hooks (package.json) — never by `npm run build`,
// `build:full`, or `vercel-build`, the only commands any real deployment
// pipeline runs. Enabling the mock provider in production would require
// BOTH a dashboard env var change AND a change to the deploy pipeline
// itself that ships the sentinel writer into the build — a materially
// different, code-reviewed change, not a dashboard toggle.
//
// Fail-closed: if the flag is set but the sentinel is absent, this throws
// instead of silently skipping provider registration. A misconfigured
// deploy should fail loudly, not quietly run with a live, unauthenticated
// account-takeover path. See docs/knowledge/authentication.md "MFA on the
// OAuth path".
//
// Deliberately kept dependency-free (no next-auth import) so it can be unit
// tested in isolation — importing auth.ts directly in vitest fails with
// "Cannot find module next/server" (next-auth transitively imports a
// Next.js-bundler-only subpath vitest's Vite-based resolver can't handle;
// see auth.mock-oauth-gate.test.ts and docs/knowledge/authentication.md).
export const MOCK_OAUTH_SENTINEL_PATH = path.join(
  process.cwd(),
  ".mock-oauth-test-sentinel",
);

export function isMockGoogleOAuthTestEnabled(): boolean {
  if (process.env.MOCK_GOOGLE_OAUTH_TEST !== "true") return false;

  let sentinelPresent = false;
  try {
    sentinelPresent = fs.statSync(MOCK_OAUTH_SENTINEL_PATH).isFile();
  } catch {
    sentinelPresent = false;
  }

  if (!sentinelPresent) {
    throw new Error(
      "MOCK_GOOGLE_OAUTH_TEST=true but the e2e test harness sentinel file " +
        `(${MOCK_OAUTH_SENTINEL_PATH}) is missing. This flag must never be ` +
        "set outside the e2e test harness (scripts/write-mock-oauth-sentinel.js, " +
        "run via the test:e2e:* npm scripts). Refusing to start rather than " +
        "silently registering an unauthenticated mock OAuth provider — see " +
        "docs/knowledge/authentication.md.",
    );
  }

  return true;
}
