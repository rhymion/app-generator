#!/bin/bash
# Checks that the migration files build the database the Prisma schema describes.
#
# On an empty scratch database it runs `prisma migrate deploy` with prisma/migrations,
# then `prisma migrate diff` from that database to prisma/schema.prisma. Any SQL the
# diff prints is a table, column, index, enum or constraint that the schema has and the
# migrations do not create (or the reverse).
#
# Usage:
#   bash scripts/check-migrations-match-schema.sh [--exceptions FILE] [--keep-db]
#   bash scripts/check-migrations-match-schema.sh --help
#
# Exit code: 0 = migrations match the schema, 1 = they differ, 2 = precondition,
# guard or infrastructure failure (nothing was verified).

set -euo pipefail

usage() {
  cat <<'EOF'
check-migrations-match-schema.sh - do the migrations build what the schema describes?

Run it from the app root (the directory that holds prisma/), AFTER `prj:sync` and
`generate-code`. Models the generator adds to prisma/schema.prisma (for example
scheduled_task_run) exist only in the generated schema, so a run before generate-code
checks the wrong schema.

What it does
  1. Creates a scratch database on a local PostgreSQL server.
  2. Runs `prisma migrate deploy` there (prisma/migrations).
  3. Runs `prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma
     --script` and fails when the printed SQL is not empty.
  4. Drops the scratch database.

Options
  --exceptions FILE  Known differences that stay on purpose. Default:
                     prisma/migration-schema-exceptions.txt (a missing file means none).
                     Format: one rule per line; blank lines and lines starting with #
                     are ignored; a rule is the beginning of a SQL statement as the
                     diff prints it (whitespace collapsed, case significant), e.g.
                         # legacy table, dropped once a drop migration is approved
                         DROP TABLE "legacy_orphan"
                         ALTER TABLE "legacy_orphan" DROP CONSTRAINT
                     A rule that matches nothing is reported as stale.
                     An example file is scripts/migration-schema-exceptions.example.txt.
  --keep-db          Do not drop the scratch database (for debugging).
  --help             This text.

Database
  The server comes from MIGRATION_CHECK_DATABASE_URL, else from DATABASE_URL in the
  env file named by MIGRATION_CHECK_ENV_FILE (default .env.test). Only the server,
  credentials and port are used; the script always creates its own database. The
  host must be a loopback address (localhost, 127.0.0.1, ::1): anything else is
  refused. Connection strings are passed to child processes through environment
  variables only, never on a command line.

What it prevents
  A table, column, index, enum value or constraint that exists in prisma/schema.prisma
  but that no migration creates. A deployed database built by `migrate deploy` would
  lack it while `db:push` test databases would have it, so the gap stays invisible
  until the code runs against the deployed database.

What it does NOT catch
  - Objects Prisma does not model: triggers, functions, roles, grants, extensions,
    raw SQL in prisma/sql or in migration files. The diff cannot see them.
  - Failures that depend on existing rows (a NOT NULL column added to a table that
    already has data, a unique index over duplicate values). The scratch database
    is empty.
  - Whether the migrations are right for a database in an older state.

When to run it
  Migrations are written when a change is merged to develop, so a feature branch
  whose schema is ahead of its migrations is normal. Run the check when preparing a
  develop merge or a deployment, not on every commit.

Exit code: 0 match, 1 differ, 2 precondition/guard/infrastructure failure.
EOF
}

EXCEPTIONS="prisma/migration-schema-exceptions.txt"
KEEP_DB=0
while [ $# -gt 0 ]; do
  case "$1" in
    --help|-h) usage; exit 0 ;;
    --exceptions)
      [ $# -ge 2 ] || { echo "check-migrations: --exceptions needs a file" >&2; exit 2; }
      EXCEPTIONS="$2"; shift 2 ;;
    --keep-db) KEEP_DB=1; shift ;;
    *) echo "check-migrations: unknown argument: $1" >&2; usage >&2; exit 2 ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="${MIGRATION_CHECK_ROOT:-$(pwd)}"
cd "$ROOT"

fail() { echo "check-migrations: $*" >&2; exit 2; }

[ -f prisma/schema.prisma ] || fail "prisma/schema.prisma not found in $ROOT (run from the app root)"
[ -d prisma/migrations ] || fail "prisma/migrations not found. Run prj:sync first (the migrations live in the consumer's prj/prisma/migrations)."
[ -f code_generator/.generated/json_schema.yaml ] || fail "generate-code has not run here. Run prj:sync and generate-code first: generator-added models exist only in the generated schema."
for tool in node python3 psql; do
  command -v "$tool" >/dev/null 2>&1 || fail "$tool is required"
done

# Resolve the server and enforce the throwaway-database guard before anything connects.
ENV_FILE="${MIGRATION_CHECK_ENV_FILE:-.env.test}"
GUARD_RC=0
GUARD_OUT="$(
  SOURCE_URL="${MIGRATION_CHECK_DATABASE_URL:-}" ENV_FILE="$ENV_FILE" SCRATCH="migcheck_$$_$RANDOM" node -e '
const fs = require("fs");
let raw = process.env.SOURCE_URL;
let origin = "MIGRATION_CHECK_DATABASE_URL";
if (!raw) {
  origin = "DATABASE_URL in " + process.env.ENV_FILE;
  let text;
  try { text = fs.readFileSync(process.env.ENV_FILE, "utf8"); } catch (e) { console.error("cannot read " + process.env.ENV_FILE); process.exit(2); }
  const line = text.split("\n").find((l) => l.startsWith("DATABASE_URL="));
  if (!line) { console.error("DATABASE_URL not found in " + process.env.ENV_FILE); process.exit(2); }
  raw = line.slice("DATABASE_URL=".length).trim().replace(/^["\x27]|["\x27]$/g, "");
}
let u;
try { u = new URL(raw); } catch (e) { console.error("the database URL (" + origin + ") is not a valid URL"); process.exit(2); }
if (!/^postgres(ql)?:$/.test(u.protocol)) { console.error("the database URL (" + origin + ") is not a PostgreSQL URL"); process.exit(2); }
const host = u.hostname.replace(/^\[|\]$/g, "");
if (!["localhost", "127.0.0.1", "::1"].includes(host)) {
  console.error("REFUSED: host \"" + host + "\" (" + origin + ") is not a loopback address. This check creates and drops a database and must only run against a throwaway local server.");
  process.exit(2);
}
const q = (s) => "\x27" + s.replace(/\x27/g, "\x27\\\x27\x27") + "\x27";
const scratch = process.env.SCRATCH;
u.pathname = "/" + scratch;
console.log("PGHOST=" + q(host));
console.log("PGPORT=" + q(u.port || "5432"));
console.log("PGUSER=" + q(decodeURIComponent(u.username)));
console.log("PGPASSWORD=" + q(decodeURIComponent(u.password)));
console.log("SCRATCH_DB=" + q(scratch));
console.log("SCRATCH_URL=" + q(u.toString()));
' 2>&1
)" || GUARD_RC=$?
if [ "$GUARD_RC" -ne 0 ]; then
  echo "check-migrations: $GUARD_OUT" >&2
  exit 2
fi

eval "$GUARD_OUT"
export PGHOST PGPORT PGUSER PGPASSWORD
unset PGSERVICE PGDATABASE PGHOSTADDR PGPASSFILE PGSERVICEFILE PGSSLMODE
# The Prisma CLI reads these through prisma.config.ts; DIRECT_URL wins over DATABASE_URL there.
export DATABASE_URL="$SCRATCH_URL" DIRECT_URL="$SCRATCH_URL"
unset SHADOW_DATABASE_URL PRISMA_DATABASE_URL VERCEL

PRISMA_CMD="${MIGRATION_CHECK_PRISMA:-npx --no-install prisma}"
WORK="$(mktemp -d)"
DB_CREATED=0
cleanup() {
  if [ "$DB_CREATED" -eq 1 ] && [ "$KEEP_DB" -eq 0 ]; then
    psql -q -X -d postgres -c "DROP DATABASE IF EXISTS \"$SCRATCH_DB\"" >/dev/null 2>&1 || true
  fi
  rm -rf "$WORK"
}
trap cleanup EXIT

echo "== check-migrations-match-schema =="
psql -v ON_ERROR_STOP=1 -q -X -d postgres -c "CREATE DATABASE \"$SCRATCH_DB\"" >/dev/null \
  || fail "cannot create the scratch database on $PGHOST:$PGPORT (is the local PostgreSQL running?)"
DB_CREATED=1
echo "-- scratch database $SCRATCH_DB on $PGHOST:$PGPORT"

echo "-- prisma migrate deploy --"
# shellcheck disable=SC2086
if ! $PRISMA_CMD migrate deploy >"$WORK/deploy.log" 2>&1; then
  tail -n 40 "$WORK/deploy.log" >&2
  echo "check-migrations: FAIL - the migrations do not apply to an empty database." >&2
  exit 1
fi

echo "-- prisma migrate diff (migrations -> prisma/schema.prisma) --"
# shellcheck disable=SC2086
if ! $PRISMA_CMD migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script >"$WORK/diff.sql" 2>"$WORK/diff.err"; then
  tail -n 40 "$WORK/diff.err" >&2
  fail "prisma migrate diff failed"
fi

rc=0
python3 -I "$SCRIPT_DIR/migration_diff_filter.py" "$WORK/diff.sql" "$EXCEPTIONS" >"$WORK/uncovered.sql" || rc=$?
case "$rc" in
  0) echo "OK: the migrations build the schema (exceptions file: $EXCEPTIONS)"; exit 0 ;;
  1)
    echo "FAIL: the schema has changes that no migration creates (or the reverse):" >&2
    cat "$WORK/uncovered.sql" >&2
    echo "Write a migration for them, or list a deliberate difference in $EXCEPTIONS." >&2
    exit 1 ;;
  *) fail "could not evaluate the diff" ;;
esac
