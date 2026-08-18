# Env File Loading Paths and the Scope of `.local` Overrides (cmd_503)

**Status: Adopted**
**Date: 2026-07-31**

## Problem

This project's env-file convention (`.env`, `.env.<NODE_ENV>`, and the
gitignored `.env.<NODE_ENV>.local` overlay for secrets/machine-local
settings) is only fully honored by **one** of the two independent env
consumption paths in the repo: the Node/`@next/env` path. The Docker Compose
path silently ignored `.local` files, forcing anyone who needed a
`.local`-only variable (e.g. `COMPOSE_PROJECT_NAME`) to be visible to
`docker compose` to instead write it into the git-tracked `.env.<NODE_ENV>`
file — defeating the purpose of the `.local` convention for that variable.

## Consumer inventory

| Consumer | Mechanism | Honors `.local`? |
|---|---|---|
| `prisma.config.ts` | `@next/env` `loadEnvConfig()` | Yes |
| `cypress.config.ts` | `@next/env` `loadEnvConfig()` | Yes |
| `scripts/run-next-dev.js` | `@next/env` `loadEnvConfig()` | Yes |
| `scripts/run-next-start.js` | `@next/env` `loadEnvConfig()` | Yes |
| `scripts/run-e2e.js` | `@next/env` `loadEnvConfig()` | Yes |
| `scripts/seed.ts`, `scripts/seed-tenant.ts` | `@next/env` `loadEnvConfig()` | Yes |
| `next build` / `next dev` / `next start` (invoked directly, outside the scripts above) | Next.js's own internal `@next/env` call | Yes — same rule, see the NODE_ENV trap below |
| `npm run docker:up:test` / `docker:down:test` / `docker:up:dev` / `docker:down:dev` / `docker:up:prod` / `docker:down:prod` | `docker compose --env-file` (was: single file) | **Fixed in this cmd** — now layers `.local` when present |
| `npm run pretest:e2e:cy:api` | same `docker compose --env-file` path as above | **Fixed in this cmd** (now routed through the same wrapper) |
| `.github/workflows/ci.yml` (`e2e-tests` job) | writes a disposable `AUTH_SECRET` line directly into `.env.test.local`, consumed by the Node path above | Yes (by construction — CI has no other secret source) |
| `scripts/db-reset-sql.sh` (`npm run db:reset:test:sql`) | `source .env` (plain shell `source`, not `@next/env`) | **No** — but it sources `.env`, not `.env.test`/`.env.test.local` at all. This is a pre-existing, separate inconsistency (the script's own comment describes an expected `.env` → `.env.test` symlink that does not exist in a fresh checkout) and is out of scope for this cmd: it is not part of the mandatory gate, and no other shell script in the repo directly sources `.env.test`. |
| `scripts/gcp-*.sh` (production deploy tooling) | source `.env.production.local` directly | N/A by design — production has no separate `.env.production` baseline; `.env.production.local` is the sole file, matching the "AUTH_SECRET not git-managed" policy for prod deploys. |

Grep coverage used to build this table: `--env-file`, `loadEnvConfig`,
`dotenv`, `source .env`/`. .env` across `package.json`, `scripts/*.sh`,
`scripts/*.js`, `cypress.config.ts`, `prisma.config.ts`, `vitest*.ts`,
`.github/workflows/ci.yml`, `docker-compose.*.yml`.

## Fix: `scripts/docker-compose-env.js`

`docker compose --env-file` only reads the file(s) named explicitly on the
command line — unlike `@next/env`, it never looks for a sibling `.local`
file on its own. `--env-file` can be passed more than once, and later
occurrences win for any variable both files define (values not in the later
file still take effect from the earlier one). But passing a path that
doesn't exist makes `docker compose` fail hard with `couldn't find env
file` — and `.env.<name>.local` is gitignored, so it usually doesn't exist.

`scripts/docker-compose-env.js` (a small Node wrapper, following the same
pattern as `scripts/run-e2e.js`/`run-next-dev.js`) resolves this
cross-platform (the alternative — `[ -f .env.test.local ] && ...` inline in
a `package.json` script — is a POSIX shell conditional that doesn't run on
Windows without WSL/Git Bash):

```js
const baseFile = `.env.${envName}`;
const localFile = `${baseFile}.local`;
const envFileArgs = ['--env-file', baseFile];
if (existsSync(localFile)) envFileArgs.push('--env-file', localFile);
```

All six `docker:up:*`/`docker:down:*` scripts, plus `docker:up:test:wait`
(used by `pretest:e2e:cy:api`, which previously duplicated the raw `docker
compose --env-file .env.test ... up -d --wait` invocation inline inside a
`bash -c` string instead of reusing `docker:up:test`), now route through
this wrapper. No compose file, `package.json` `up`/`down` flags, or port
default changed — only how the env file list is assembled.

## The `NODE_ENV` trap (separate from the Docker gap)

Every `@next/env`-based consumer above resolves its file set purely from
`process.env.NODE_ENV` at the moment it runs — **not** from which npm
script name was invoked:

```
NODE_ENV === 'test'         → .env.test.local, .env.test, .env
NODE_ENV === 'development'  → .env.development.local, .env.local, .env.development, .env
NODE_ENV === 'production' (default when unset) → .env.production.local, .env.local, .env.production, .env
```

(`.env.local` is intentionally *excluded* when `NODE_ENV==='test'` — see the
comment at the top of `.env` — so a variable placed only in `.env.local`
will never reach a test-mode run, by design.)

Any invocation that reaches `@next/env` **without** going through a
`cross-env NODE_ENV=test`-prefixed npm script — for example running `npm
run db:push` by itself, `npx next dev` directly, or a bare `npm start` —
resolves the **development/production** file chain, not the test one, even
if the intent was "run this against my test env". This is Next.js's
documented convention, not a bug, but it silently reads a completely
different set of files than expected. If a variable is only defined in
`.env.test.local`, it will appear "not set" to any such invocation. When a
script genuinely needs test-mode file resolution outside the existing
`cross-env`-wrapped npm scripts, set `NODE_ENV=test` explicitly rather than
relying on the invoked script's name.

## `COMPOSE_PROJECT_NAME` precedence: shell env beats `--env-file`

Independent of the `.local`-layering fix above, `docker compose` gives a
**shell environment variable** priority over every `--env-file` value for
the same key — including `COMPOSE_PROJECT_NAME`. Verified:

```
$ COMPOSE_PROJECT_NAME=from_shell docker compose --env-file .env.test --env-file .env.test.local -f docker-compose.test.yml config
name: from_shell
```

regardless of what either `--env-file` sets. This means: if
`COMPOSE_PROJECT_NAME` is already `export`ed in the calling shell (e.g. left
over from a previous manual `export` in an interactive session), it will
silently win over both `.env.test` and `.env.test.local`, and edits to the
`.local` file will appear to have no effect. `export`ing the desired value
directly is a valid, immediate way to force a specific project name for one
shell session, but it is a workaround for that session only — it does not
change what a fresh shell (or CI) resolves, so the `.local`-file fix above
remains the durable mechanism for anyone who isn't manually exporting.

## Verification performed

- `.env.test.local`-only variable (`COMPOSE_PROJECT_NAME`) confirmed absent
  from `docker compose ... config` output before the fix (single
  `--env-file .env.test`), and present after (two `--env-file` flags, `.local`
  second) — both via a scratch marker file and via real containers started
  by `npm run docker:up:test` with a dedicated, isolated project name and
  ports.
- `docker:up:test` confirmed to succeed (exit 0, fallback project name) in a
  tree with no `.env.test.local` present at all.
- Full mandatory gate (`.claude/commands/update-generator.md`'s 9 steps —
  pytest, vitest, `test:e2e:build`, `check:generated`, `test:e2e:cy:api`,
  `test:e2e:cy:ui`, lint, `npm audit --omit=dev --audit-level=high`,
  `pip-audit`) passed with zero regressions in an isolated worktree with
  dedicated ports, `check:generated` confirming zero golden diff (this cmd
  touches only env-file loading, no generator/template code).
- The gate run itself is a live demonstration of the underlying goal: the
  git-tracked `.env.test` in this repo has never contained `AUTH_SECRET` or
  any other secret (it only has non-secret test settings — ports, the fixed
  local DB URL, rate-limit tuning); the full suite, including NextAuth
  session-based Cypress specs, passed end-to-end with `AUTH_SECRET` supplied
  exclusively via `.env.test.local`.

## Related

- `scripts/docker-compose-env.js` — the fix in this repo.
- This repo is also consumed through isolated git worktrees by separate
  internal tooling that derives a per-worktree `COMPOSE_PROJECT_NAME` and
  ports and writes them directly into the worktree's `.env.test`, to avoid
  different worktrees' Docker Compose stacks colliding with each other.
  That mechanism is orthogonal to this fix: it solves collisions between
  *ephemeral, disposable* worktrees by writing into the tracked file for
  the lifetime of that worktree; this fix is what lets a *persistent* dev
  checkout keep such values in the gitignored `.local` file instead,
  without ever needing to edit the tracked file at all.
