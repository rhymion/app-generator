/* eslint-disable @typescript-eslint/no-require-imports */
'use strict';
// Cross-platform `docker compose` launcher that layers .env.<name>.local
// over .env.<name> when the .local file exists.
//
// `docker compose --env-file` only reads the file(s) named explicitly on
// the command line — it never looks for a sibling `.local` override the
// way @next/env's loadEnvConfig() does. Passing `--env-file` twice is
// supported and later-wins (docker/compose#9737), so this script appends
// the `.local` file only when present; passing a nonexistent path makes
// docker compose fail hard with "couldn't find env file", and
// `.env.<name>.local` is gitignored so it usually doesn't exist.
//
// Precedence note: shell environment variables still beat every
// --env-file value for docker compose itself (e.g. an exported
// COMPOSE_PROJECT_NAME wins over both .env.test and .env.test.local).
// See docs/knowledge/env-file-loading-and-local-overrides.md.
const { existsSync } = require('node:fs');
const { spawnSync } = require('node:child_process');

const [, , envName, ...composeArgs] = process.argv;
if (!envName || composeArgs.length === 0) {
  console.error(
    '[docker-compose-env] Usage: node scripts/docker-compose-env.js <env-file-suffix> <docker compose args...>'
  );
  process.exit(1);
}

const baseFile = `.env.${envName}`;
const localFile = `${baseFile}.local`;

const envFileArgs = ['--env-file', baseFile];
if (existsSync(localFile)) {
  envFileArgs.push('--env-file', localFile);
}

const result = spawnSync('docker', ['compose', ...envFileArgs, ...composeArgs], {
  stdio: 'inherit',
});
process.exit(result.status ?? 1);
