#!/usr/bin/env bash
# Seed the Vercel-connected database with the minimum bootstrap data.
# Canonical copy — consumer repos reference this file via their
# app-generator submodule rather than keeping their own duplicate (cmd_711).
#
# Prerequisite: scripts/vercel-deploy.sh (or a git push to trigger Vercel
#   preview auto-deploy) must have completed at least once. The first Vercel
#   deploy runs vercel-build, which includes `migrate:deploy` — that is what
#   creates the database schema. Running this script before any deploy will
#   fail because the target tables do not yet exist.
#
# Seeds (idempotent): pg_trgm extension, default tenant (id/slug=default),
#   admin user admin@example.com / password123, Administrator role, full-CRUD
#   permissions. Every write uses upsert on a unique key, CREATE EXTENSION IF
#   NOT EXISTS, or a findFirst guard — safe to re-run.
#
# Required before signup works: without the default tenant row, signup fails
#   with a user_tenant_id_fkey FK violation.
#
# Usage:
#   ./scripts/vercel-seed.sh           # seed staging DB (preview)
#   ./scripts/vercel-seed.sh --prod    # seed production DB
#   DRY_RUN=true ./scripts/vercel-seed.sh [--prod]
#   SEED_COMMAND=db:seed-demo ./scripts/vercel-seed.sh   # run a different
#     app-generator npm script instead of the default db:seed-baseline
#     (e.g. db:seed-demo for one-off demo data; the target script's own
#     env-var guards, such as db:seed-demo's SEED_DEMO_DATA=true, still
#     apply and must be set separately)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/vercel-env.sh"

DRY_RUN="${DRY_RUN:-false}"
SEED_COMMAND="${SEED_COMMAND:-db:seed-baseline}"
_TARGET="${1:-}"
case "$_TARGET" in
  --prod)    _TARGET="prod" ;;
  --staging|"") _TARGET="staging" ;;
  *)
    echo "Usage: $(basename "$0") [--prod]"
    echo "  (no flag): seed staging DB"
    echo "  --prod   : seed production DB"
    exit 1 ;;
esac

if [[ "$_TARGET" == "prod" ]]; then
  : "${DATABASE_URL_UNPOOLED_PROD:?DATABASE_URL_UNPOOLED_PROD is required}"
  _DB_URL="$DATABASE_URL_UNPOOLED_PROD"
  _ENV_LABEL="production"
else
  : "${DATABASE_URL_UNPOOLED_STAGING:?DATABASE_URL_UNPOOLED_STAGING is required}"
  _DB_URL="$DATABASE_URL_UNPOOLED_STAGING"
  _ENV_LABEL="staging"
fi

echo "================================================================="
echo "  Vercel DB Seed Script"
echo "================================================================="
echo "  Target: ${_ENV_LABEL}"
echo "================================================================="
echo ""

# ── Guard: schema must exist (created by migrate:deploy in vercel-build) ───
# Analogous to gcp-seed.sh's Job-existence guard. Skipped in DRY_RUN so the
# plan can be previewed without credentials.
#
# Keyed on `prisma migrate status`'s exit code, not its message text: this
# repo has zero committed migration files (it uses `db:push` normally), so
# `migrate status` prints the same "No migration found in prisma/migrations"
# line on BOTH an empty/schema-less database (exit 1, real problem) and a
# fully up-to-date one (exit 0, fine) — confirmed live against a scratch
# Postgres container. An earlier draft of this guard matched on that message
# text plus a fixed connection-error string list; neither pattern actually
# occurs verbatim in this Prisma version's real output (also confirmed
# live), so it silently fell through to "confirmed" on every failure mode,
# including a completely unrelated `prisma.config.ts` load error. Exit code
# is the only signal proven reliable across all three cases tested
# (unreachable DB, schema-less DB, up-to-date DB) — fail closed on anything
# nonzero and show the real Prisma output so a human can tell which case it
# was, instead of guessing from a hardcoded message allowlist.
if [[ "$DRY_RUN" != "true" ]]; then
  echo "[Guard] Checking schema exists (migration state)..."
  # `npm --prefix <dir> exec` does not cd into <dir> the way `npm --prefix
  # <dir> run <script>` does, and no package.json script exposes a bare
  # `prisma <args>` passthrough — confirmed live (prisma otherwise fails to
  # find prisma/schema.prisma relative to the caller's cwd). A subshell cd is
  # used instead of adding a new script just for this.
  if MIGRATE_STATUS=$(cd "${ROOT}/app-generator" && DATABASE_URL="${_DB_URL}" npx prisma migrate status 2>&1); then
    echo "  Schema confirmed — proceeding."
    echo ""
  else
    echo "ERROR: schema is not ready for seeding on ${_ENV_LABEL}." >&2
    echo "" >&2
    echo "$MIGRATE_STATUS" | sed 's/^/  /' >&2
    echo "" >&2
    echo "  If the message above says no migration is applied yet / database not" >&2
    echo "  managed by Prisma Migrate:" >&2
    if [[ "$_TARGET" == "prod" ]]; then
      echo "    Run scripts/vercel-deploy.sh --prod first, then re-run this script." >&2
    else
      echo "    Run scripts/vercel-deploy.sh (or git push to trigger Vercel auto-deploy)" >&2
      echo "    first, then re-run this script." >&2
    fi
    echo "  If it is a connection error (e.g. P1001/P1017), check" >&2
    echo "  DATABASE_URL_UNPOOLED_${_TARGET^^} in .env.production.local." >&2
    exit 1
  fi
fi

# ── Seed ─────────────────────────────────────────────────────────────────
echo "[Seed] Running ${SEED_COMMAND} against ${_ENV_LABEL} DB..."
if [[ "$DRY_RUN" == "true" ]]; then
  echo "[DRY-RUN] DATABASE_URL=<redacted> npm --prefix app-generator run ${SEED_COMMAND}"
else
  DATABASE_URL="${_DB_URL}" \
    npm --prefix "${ROOT}/app-generator" run "${SEED_COMMAND}"
fi
echo "  OK: ${_ENV_LABEL} seed complete."
echo ""
echo "================================================================="
echo "  Seed complete"
echo "================================================================="
echo ""
if [[ "$_TARGET" == "staging" ]]; then
  echo "  Next: scripts/vercel-seed.sh --prod    (if production has been deployed)"
else
  echo "  Vercel setup is complete."
fi
