/* eslint-disable @typescript-eslint/no-require-imports */
'use strict';
// E2E orchestrator. Reads PORT from .env.test via @next/env
// (same loader Next.js and prisma.config.ts use), then invokes
// start-server-and-test with the resolved http://localhost:PORT URL.
const { loadEnvConfig } = require('@next/env');
const { spawnSync } = require('node:child_process');

// Load .env.test (NODE_ENV=test is set by npm scripts via cross-env)
loadEnvConfig(process.cwd(), false);

const { PORT } = process.env;
if (!PORT) {
  console.error('[run-e2e] PORT not set. Check .env.test.');
  process.exit(1);
}

const [, , serverScript, ...testCmdParts] = process.argv;
if (!serverScript || testCmdParts.length === 0) {
  console.error('[run-e2e] Usage: node scripts/run-e2e.js <server-script> <test-command...>');
  process.exit(1);
}
const testCmd = testCmdParts.join(' ');

const result = spawnSync(
  'npx',
  ['start-server-and-test', serverScript, `http://localhost:${PORT}`, testCmd],
  { stdio: 'inherit', env: process.env }
);
process.exit(result.status ?? 1);
