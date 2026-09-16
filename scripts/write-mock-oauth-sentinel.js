/* eslint-disable @typescript-eslint/no-require-imports */
'use strict';
// Writes the e2e test-harness sentinel that auth.ts requires (alongside
// MOCK_GOOGLE_OAUTH_TEST=true) before it will register the mock Google
// OAuth provider — see auth.ts's isMockGoogleOAuthTestEnabled() for the
// full rationale (cmd_528).
//
// This script is wired into the `pre*` hooks of every e2e npm script that
// builds or starts the server (package.json) so the sentinel is always in
// place before auth.ts first loads. It is NOT part of `build`, `build:full`,
// or `vercel-build` — the only commands any real deployment pipeline runs —
// so the sentinel never exists outside a test-harness invocation.
//
// Deliberately a no-op unless MOCK_GOOGLE_OAUTH_TEST is already "true":
// running this script has zero effect in any context where the flag isn't
// enabled, so it's safe to run unconditionally on every e2e pre-hook.
const fs = require('node:fs');
const path = require('node:path');
const { loadEnvConfig } = require('@next/env');

// Same loader Next.js, prisma.config.ts, and the other scripts/*.js
// launchers use — resolves .env.<NODE_ENV> + .env.<NODE_ENV>.local.
loadEnvConfig(process.cwd(), false);

const SENTINEL_PATH = path.join(process.cwd(), '.mock-oauth-test-sentinel');

if (process.env.MOCK_GOOGLE_OAUTH_TEST === 'true') {
  fs.writeFileSync(
    SENTINEL_PATH,
    `written by scripts/write-mock-oauth-sentinel.js, NODE_ENV=${process.env.NODE_ENV}\n`,
  );
  console.log(`[write-mock-oauth-sentinel] wrote ${SENTINEL_PATH}`);
} else {
  console.log(
    '[write-mock-oauth-sentinel] MOCK_GOOGLE_OAUTH_TEST is not "true" — skipping (no-op).',
  );
}
