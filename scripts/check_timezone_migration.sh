#!/bin/bash
# Runs scripts/migrations/04_app_setting_timezone_enum.sql against a scratch database.
#
# A minimal pre-migration app_setting table (timezone as a free String, default 'UTC') is filled
# with a recognised IANA name, the former default, an already-member-shaped value and values the
# list does not know; the migration must map the first three and coerce the rest to 'utc' while
# recording each coerced row (id + original value) in "_app_setting_timezone_coerced".
#
# The scratch database lives on the server named by DATABASE_URL in .env.test (start it with
# `npm run docker:up:test:wait`); it is created and dropped here and nothing else is touched.
# The password is passed through PGPASSWORD, never on a command line.
#
# Usage: bash scripts/check_timezone_migration.sh
# Exit code: 0 = pass, non-zero = fail.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

SQL="scripts/migrations/04_app_setting_timezone_enum.sql"
ENV_FILE="${TIMEZONE_MIGRATION_ENV_FILE:-.env.test}"

eval "$(node -e '
const fs = require("fs");
const line = fs.readFileSync(process.argv[1], "utf8").split("\n").find((l) => l.startsWith("DATABASE_URL="));
if (!line) { console.error("DATABASE_URL not found in " + process.argv[1]); process.exit(1); }
const u = new URL(line.slice("DATABASE_URL=".length).replace(/^"|"$/g, ""));
const q = (s) => "\x27" + s.replace(/\x27/g, "\x27\\\x27\x27") + "\x27";
console.log("export PGHOST=" + q(u.hostname) + " PGPORT=" + q(u.port || "5432") + " PGUSER=" + q(decodeURIComponent(u.username)) + " PGPASSWORD=" + q(decodeURIComponent(u.password)));
' "$ENV_FILE")"

SCRATCH="tz_migration_$$"
psql -v ON_ERROR_STOP=1 -q -d postgres -c "CREATE DATABASE \"$SCRATCH\"" >/dev/null
cleanup() { psql -q -d postgres -c "DROP DATABASE IF EXISTS \"$SCRATCH\"" >/dev/null 2>&1 || true; }
trap cleanup EXIT

run() { psql -v ON_ERROR_STOP=1 -q -X -d "$SCRATCH" "$@"; }

run >/dev/null <<'SQL'
CREATE TABLE "app_setting" (
  "id" TEXT PRIMARY KEY,
  "timezone" VARCHAR(255) NOT NULL DEFAULT 'UTC'
);
CREATE INDEX "app_setting_timezone_idx" ON "app_setting"("timezone");
INSERT INTO "app_setting" ("id", "timezone") VALUES
  ('s_default', 'UTC'),
  ('s_tokyo', 'Asia/Tokyo'),
  ('s_kathmandu', 'Asia/Kathmandu'),
  ('s_member', 'europe_paris'),
  ('s_unknown_zone', 'Not/AZone'),
  ('s_legacy_name', 'Asia/Calcutta'),
  ('s_lowercase', 'asia/tokyo'),
  ('s_empty', '');
SQL

run -f "$SQL" >/dev/null

actual=$(run -At -F '|' -c 'SELECT "id", "timezone"::text FROM "app_setting" ORDER BY "id"')
expected='s_default|utc
s_empty|utc
s_kathmandu|asia_kathmandu
s_legacy_name|utc
s_lowercase|utc
s_member|europe_paris
s_tokyo|asia_tokyo
s_unknown_zone|utc'
if [ "$actual" != "$expected" ]; then
  echo "timezone-migration: migrated values differ" >&2
  diff <(echo "$expected") <(echo "$actual") >&2 || true
  exit 1
fi

coerced=$(run -At -F '|' -c 'SELECT "app_setting_id", "original_value", "coerced_to"::text FROM "_app_setting_timezone_coerced" ORDER BY "app_setting_id"')
expected_coerced='s_empty||utc
s_legacy_name|Asia/Calcutta|utc
s_lowercase|asia/tokyo|utc
s_unknown_zone|Not/AZone|utc'
if [ "$coerced" != "$expected_coerced" ]; then
  echo "timezone-migration: coerced-row record differs" >&2
  diff <(echo "$expected_coerced") <(echo "$coerced") >&2 || true
  exit 1
fi

default=$(run -At -c "SELECT column_default FROM information_schema.columns WHERE table_name = 'app_setting' AND column_name = 'timezone'")
if [ "$default" != "'utc'::\"Timezone\"" ]; then
  echo "timezone-migration: unexpected column default: $default" >&2
  exit 1
fi

index=$(run -At -c "SELECT count(*) FROM pg_indexes WHERE tablename = 'app_setting' AND indexname = 'app_setting_timezone_idx'")
if [ "$index" != "1" ]; then
  echo "timezone-migration: the timezone index is missing after the migration" >&2
  exit 1
fi

echo "timezone-migration: PASS (8 rows migrated, 4 coerced and recorded)"
