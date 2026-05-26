/* eslint-disable @typescript-eslint/no-require-imports */
'use strict';
// Production/test server launcher. Reads PORT from the active
// .env.{NODE_ENV} via @next/env, then starts next start on that port.
const { loadEnvConfig } = require('@next/env');
const { spawnSync } = require('node:child_process');

loadEnvConfig(process.cwd(), false);

const port = process.env.PORT;
if (!port) {
  console.error('[run-next-start] PORT not set. Check your .env.{NODE_ENV} file.');
  process.exit(1);
}

const result = spawnSync(
  'npx',
  ['next', 'start', '-p', port],
  { stdio: 'inherit', env: process.env }
);
process.exit(result.status ?? 1);
