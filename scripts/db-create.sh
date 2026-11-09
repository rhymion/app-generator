#!/usr/bin/env bash
# Create/update the database schema for a deploy (used by `vercel-build`).
#
# - prisma/migrations/ holds at least one migration (`*/migration.sql`):
#     run `migrate:deploy` (apply pending migrations; the normal path for
#     generated apps, whose deploys ship developer-prepared migrations).
# - otherwise: run `db:push` (sync the DB straight from schema.prisma).
#     This is the app-generator's own deploy path — prisma/migrations/ is
#     gitignored here, so a deploy of app-generator itself has no migrations
#     and `migrate:deploy` would apply nothing, leaving the DB without tables.
#
# A bare migration_lock.toml does not count as a migration.
# `db:push` runs without --accept-data-loss, so a destructive schema change
# fails the build instead of silently dropping data.
# See docs/knowledge/db-create-migrate-or-push.md.
set -euo pipefail

PROJ_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MIGRATIONS_DIR="$PROJ_ROOT/prisma/migrations"

cd "$PROJ_ROOT"

if compgen -G "$MIGRATIONS_DIR/*/migration.sql" > /dev/null; then
  echo "[db:create] migration files found in prisma/migrations -> migrate:deploy"
  exec npm run --silent migrate:deploy
else
  echo "[db:create] no migration files in prisma/migrations -> db:push"
  exec npm run --silent db:push
fi
