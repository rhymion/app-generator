#!/bin/bash
# Runs scripts/migrations/06_app_setting_business_date_optional.sql against a scratch database that was
# built from the PREVIOUS prisma/schema.prisma (the git ref in BUSINESS_DATE_MIGRATION_BASE_REF; the default
# HEAD~1 is right while the schema change is the tip commit, otherwise pass the ref before the change).
#
# The scratch database gets the old schema through `prisma migrate diff --from-empty`, then rows of each kind
# (pinned, unpinned with a placeholder date, a per-organization unpinned row). After the script runs, the
# unpinned rows must have no date, the pinned row must keep its date, and `prisma migrate diff` from the
# migrated database to the current prisma/schema.prisma must report no difference (so the script covers every
# statement the schema change needs; `prisma db push` would hide a missing one).
#
# The scratch database lives on the server named by DATABASE_URL in .env.test (start it with
# `npm run docker:up:test:wait`); it is created and dropped here and nothing else is touched.
# The password is passed through PGPASSWORD, never on a command line.
#
# Usage: BUSINESS_DATE_MIGRATION_BASE_REF=<git ref of the pre-change schema> bash scripts/check_business_date_migration.sh
# Exit code: 0 = pass, non-zero = fail.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

SQL="scripts/migrations/06_app_setting_business_date_optional.sql"
ENV_FILE="${BUSINESS_DATE_MIGRATION_ENV_FILE:-.env.test}"
BASE_REF="${BUSINESS_DATE_MIGRATION_BASE_REF:-HEAD~1}"

eval "$(node -e '
const fs = require("fs");
const line = fs.readFileSync(process.argv[1], "utf8").split("\n").find((l) => l.startsWith("DATABASE_URL="));
if (!line) { console.error("DATABASE_URL not found in " + process.argv[1]); process.exit(1); }
const u = new URL(line.slice("DATABASE_URL=".length).replace(/^"|"$/g, ""));
const q = (s) => "\x27" + s.replace(/\x27/g, "\x27\\\x27\x27") + "\x27";
console.log("export PGHOST=" + q(u.hostname) + " PGPORT=" + q(u.port || "5432") + " PGUSER=" + q(decodeURIComponent(u.username)) + " PGPASSWORD=" + q(decodeURIComponent(u.password)));
console.log("export SCRATCH_BASE_URL=" + q(u.protocol + "//" + u.username + ":" + u.password + "@" + u.host));
' "$ENV_FILE")"

WORK="$(mktemp -d)"
SCRATCH="bd_migration_$$"
psql -v ON_ERROR_STOP=1 -q -d postgres -c "CREATE DATABASE \"$SCRATCH\"" >/dev/null
cleanup() {
  psql -q -d postgres -c "DROP DATABASE IF EXISTS \"$SCRATCH\"" >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT

run() { psql -v ON_ERROR_STOP=1 -q -X -d "$SCRATCH" "$@"; }

# The database URL for Prisma is handed over through the environment, never an argument.
export BD_SCRATCH_URL="$SCRATCH_BASE_URL/$SCRATCH"

git show "$BASE_REF:prisma/schema.prisma" > "$WORK/old.prisma"
if ! grep -q '^  business_date String$' "$WORK/old.prisma"; then
  echo "business-date-migration: $BASE_REF does not hold the pre-change schema (business_date String)" >&2
  exit 1
fi
DATABASE_URL="$BD_SCRATCH_URL" DIRECT_URL= npx prisma migrate diff --from-empty --to-schema "$WORK/old.prisma" --script > "$WORK/old.sql"
run -f "$WORK/old.sql" >/dev/null

# Rows of each kind. Foreign keys are not enforced while seeding (only the migration is under test).
run >/dev/null <<'SQL'
SET session_replication_role = replica;
INSERT INTO "app_setting" ("id", "organization_id", "business_date", "is_pinned", "updated_at", "creator_id", "updater_id") VALUES
  ('s_default_unpinned', NULL, '2026-09-17', false, now(), 'u1', 'u1'),
  ('s_org_pinned', 'org_a', '2026-10-01', true, now(), 'u1', 'u1'),
  ('s_org_unpinned', 'org_b', '2026-09-17', false, now(), 'u1', 'u1');
SQL

run -f "$SQL" >/dev/null
# Running it again changes nothing.
run -f "$SQL" >/dev/null

actual=$(run -At -F '|' -c 'SELECT "id", coalesce("business_date", '"'"'<null>'"'"'), "is_pinned" FROM "app_setting" ORDER BY "id"')
expected='s_default_unpinned|<null>|f
s_org_pinned|2026-10-01|t
s_org_unpinned|<null>|f'
if [ "$actual" != "$expected" ]; then
  echo "business-date-migration: migrated rows differ" >&2
  diff <(echo "$expected") <(echo "$actual") >&2 || true
  exit 1
fi

nullable=$(run -At -c "SELECT is_nullable FROM information_schema.columns WHERE table_name = 'app_setting' AND column_name = 'business_date'")
if [ "$nullable" != "YES" ]; then
  echo "business-date-migration: business_date is still NOT NULL" >&2
  exit 1
fi

# No drift left between the migrated database and the current schema: a statement the schema change needs
# but the script lacks would show up here (prisma db push would paper over it).
if ! drift=$(DATABASE_URL="$BD_SCRATCH_URL" DIRECT_URL= npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code 2>&1); then
  echo "business-date-migration: the migrated database differs from prisma/schema.prisma:" >&2
  echo "$drift" >&2
  exit 1
fi

echo "business-date-migration: PASS (3 rows migrated, idempotent, no schema drift)"
