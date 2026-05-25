# Changelog
All notable changes to this project will be documented in this file.
The format is based on Keep a Changelog (https://keepachangelog.com/),
and this project adheres to Semantic Versioning (https://semver.org/).

## [Unreleased]

### Breaking Changes
- **BREAKING**: Split docker-compose into separate dev (`docker-compose.dev.yml`,
  postgres only) and test (`docker-compose.test.yml`, postgres + redis) configurations.
- **BREAKING**: The dev database is now `my_next_dev` (previously `my_next_test` in
  `.env.development` — a misconfiguration). Run:
  ```
  npm run docker:up:dev && npm run setup
  ```
  to initialize the new dev volume.
- **BREAKING**: Removed `env:use` symlink mechanism. Environment switching is now
  handled by Next.js native env loading (`NODE_ENV` based).
- Removed scripts: `env:use`, `env:current`, `env:check`, `env:require`,
  `env:require:test`, `check:build`, `cy:run`, `cy:run:api`, `cy:test`,
  `cy:test:api`, `dev:all`, `build:all`, `ports:generate`, `ports:check`.
- Removed script files: `scripts/env-use.sh`, `env-current.sh`, `env-require.sh`,
  `check-env.sh`, `check-build-fresh.sh`, `scripts/generate-env-test.js`,
  `config/ports.yaml`.

### Added
- `docker:up:dev` / `docker:down:dev` npm scripts to manage the dev Postgres
  container independently of the test containers.
- `docker-compose.dev.yml` defining `postgres-dev` (port 5433, DB `my_next_dev`).
- `prisma.config.ts`: Prisma 7 native config using `@next/env` for env loading.
- `test:e2e`, `test:e2e:build`, `test:e2e:start`, `test:e2e:dev`: E2E test scripts
  using `cross-env NODE_ENV=test` for isolated test environment.
- Removed hardcoded localhost:3000 URL from test:e2e scripts.
  Introduced scripts/run-e2e.js Node.js orchestrator that reads
  PORT from .env.test via @next/env.
- `setup`, `dev:full`, `build:full`: Explicit setup + dev/build workflows.

### Changed
- Dev environment now uses in-memory rate limiter (`REDIS_URL` removed from
  `.env.development`); Redis is only needed for E2E tests and rate-limit
  adapter unit tests.
- `docker:up:test` / `docker:down:test` updated to use `--env-file .env.test`.
- Production remains on Vercel-managed Postgres and KV (unchanged).
- `dev`: simplified to `next dev` (Next.js native env loading).
- `start`: simplified to `next start`.
- `.env`, `.env.development` are now committed (non-secrets). `.env.production`
  remains gitignored.
- New env file convention: `.env` (common baseline), `.env.development` (dev),
  `.env.test` (E2E), `.env.local` (local secrets, gitignored).
