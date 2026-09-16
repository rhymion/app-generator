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
//
// COMPOSE_PROJECT_NAME fail-closed guard:
// When neither `-p`/`--project-name` nor a resolvable COMPOSE_PROJECT_NAME
// is present, `docker compose` silently falls back to the current
// directory's basename as the project name. This repo's submodule path
// (per .gitmodules) always checks out to a directory literally named
// "app-generator" — identical across every worktree/checkout — so that
// fallback silently lands every isolated worktree in the SAME compose
// project namespace as every other checkout, including a developer's own
// persistent dev containers. Two independent checkouts colliding this way
// can stop or delete each other's containers/volumes with no warning.
// This guard refuses to proceed rather than let that happen silently.
//
// Exempted only for recognized CI (the standard `CI=true` env var GitHub
// Actions — and most other CI providers — set on every job): a CI runner
// is a fresh, single-tenant, ephemeral VM with no other compose stack to
// collide with, so the same fallback that is dangerous on a shared
// developer host is harmless there. Anywhere else (an interactive shell,
// a worktree-based dev flow, an automated agent) this is a hard failure —
// export a unique COMPOSE_PROJECT_NAME (or pass -p/--project-name)
// before retrying.
const { existsSync, readFileSync } = require('node:fs');
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

// Last-line-wins for a `KEY=value` (optionally quoted) line, matching both
// dotenv's and docker compose's own re-declaration semantics.
function readEnvValue(filePath, key) {
  if (!existsSync(filePath)) return undefined;
  let value;
  for (const rawLine of readFileSync(filePath, 'utf8').split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    if (line.slice(0, eq).trim() !== key) continue;
    let v = line.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    value = v;
  }
  return value;
}

const hasExplicitProjectFlag = composeArgs.some(
  (arg) => arg === '-p' || arg === '--project-name' || arg.startsWith('--project-name=')
);

if (!hasExplicitProjectFlag) {
  // Same precedence docker compose itself applies (verified, see
  // docs/knowledge/env-file-loading-and-local-overrides.md): shell env >
  // later --env-file (.local) > earlier --env-file (base).
  const resolved =
    process.env.COMPOSE_PROJECT_NAME ||
    readEnvValue(localFile, 'COMPOSE_PROJECT_NAME') ||
    readEnvValue(baseFile, 'COMPOSE_PROJECT_NAME');

  if (!resolved && process.env.CI !== 'true') {
    console.error(
      [
        '[docker-compose-env] Refusing to run: COMPOSE_PROJECT_NAME is not set',
        `  (checked: shell env, ${localFile}, ${baseFile}) and no -p/--project-name was passed.`,
        '  Without an explicit project name, docker compose falls back to this',
        "  directory's basename — the SAME value for every worktree/checkout of",
        '  this repo — which collides with any other running stack under that name.',
        '',
        '  Fix: export COMPOSE_PROJECT_NAME=<unique-name> for this worktree/checkout',
        '  (or pass -p <unique-name>) before retrying.',
      ].join('\n')
    );
    process.exit(1);
  }
}

const result = spawnSync('docker', ['compose', ...envFileArgs, ...composeArgs], {
  stdio: 'inherit',
});
process.exit(result.status ?? 1);
