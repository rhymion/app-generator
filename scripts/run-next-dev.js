/* eslint-disable @typescript-eslint/no-require-imports */
'use strict';
// Dev server launcher. Reads PORT from the active .env.{NODE_ENV}
// via @next/env (same loader Next.js and prisma.config.ts use),
// then starts next dev on that port.
const { loadEnvConfig } = require('@next/env');
const { spawnSync } = require('node:child_process');

loadEnvConfig(process.cwd(), true);

const port = process.env.PORT;
if (!port) {
  console.error('[run-next-dev] PORT not set. Check .env.development or .env.test.');
  process.exit(1);
}

const result = spawnSync(
  'npx',
  ['next', 'dev', '-p', port],
  { stdio: 'inherit', env: process.env }
);
process.exit(result.status ?? 1);
