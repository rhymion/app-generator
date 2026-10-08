#!/bin/bash
# Runs the Expo mobile app's Playwright specs against a real build.
#
# The default schema has no entity without relations, so it gets no native
# entity screens (code_generator/mobile_entities.py). This script therefore
# builds a disposable copy of the working tree with the entities of
# code_generator/tests/fixtures/mobile_entity_e2e_gate/ merged into its schema
# (scripts/compose_child_datagrid_e2e_fixture.py), starts the Next.js API, the
# Expo web bundle and the same-origin proxy that joins them, and runs every
# spec in mobile/e2e/.
#
# Isolation: like scripts/check_child_datagrid_e2e_gate_fixture.sh, everything
# happens in the copy (.generated-mobile-entity-pw/), with its own docker compose
# project, three ports derived from this checkout's path and a throwaway
# AUTH_SECRET. Cleanup is `docker compose -p <that project> down -v`. A port
# already in use fails the run.
#
# Two modes, because the footer specs assume the default schema's tabs:
#   MODE=fixture (default)  fixture entities merged; runs mobile/e2e/entity-crud.spec.ts and
#                           mobile/e2e/relation-pickers.spec.ts
#   MODE=default            unmodified schema; runs every other spec in mobile/e2e/
#
# Usage: bash scripts/run_mobile_entity_playwright.sh
# Environment: GATE_KEEP_BUILD_DIR=1 keeps the copy; PORT_SLOT=<0-899> picks another port set; PW_ARGS='<playwright args>'
#              narrows the run (for example PW_ARGS='entity-crud.spec.ts').
# This is an optional check, not part of the mandatory gate.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

MODE="${MODE:-fixture}"
FIXTURE_DIR="code_generator/tests/fixtures/mobile_entity_e2e_gate"
BUILD_DIR="$REPO_ROOT/.generated-mobile-entity-pw"

HASH=$(printf '%s' "$REPO_ROOT" | cksum | cut -d' ' -f1)
SLOT=${PORT_SLOT:-$((HASH % 900))}
PROJECT="mobile_entity_pw_${HASH}"
APP_PORT=$((29000 + SLOT))
POSTGRES_PORT=$((30000 + SLOT))
REDIS_PORT=$((31000 + SLOT))
WEB_PORT=$((32000 + SLOT))
PROXY_PORT=$((33000 + SLOT))

compose_down() {
  if [ -f "$BUILD_DIR/docker-compose.test.yml" ]; then
    (cd "$BUILD_DIR" && docker compose -p "$PROJECT" -f docker-compose.test.yml down -v) >/dev/null 2>&1 || true
  fi
}
cleanup() {
  compose_down
  if [ "${GATE_KEEP_BUILD_DIR:-0}" != "1" ]; then
    rm -rf "$BUILD_DIR"
  fi
}
trap cleanup EXIT

echo "== mobile entity playwright (project $PROJECT, app=$APP_PORT web=$WEB_PORT proxy=$PROXY_PORT) =="
compose_down
rm -rf "$BUILD_DIR"

for port in "$APP_PORT" "$POSTGRES_PORT" "$REDIS_PORT" "$WEB_PORT" "$PROXY_PORT"; do
  if (exec 3<>"/dev/tcp/127.0.0.1/$port") 2>/dev/null; then
    echo "mobile-entity-playwright: port $port is already in use; not taking it over." >&2
    exit 1
  fi
done

echo "-- copying the working tree --"
mkdir -p "$BUILD_DIR"
git ls-files -z --cached --others --exclude-standard \
  | tar --null --ignore-failed-read -T - -cf - 2>/dev/null \
  | tar -xf - -C "$BUILD_DIR"
ln -s "$REPO_ROOT/node_modules" "$BUILD_DIR/node_modules"

if [ "$MODE" = "fixture" ]; then
  echo "-- merging the fixture schema into the copy --"
  python3 scripts/compose_child_datagrid_e2e_fixture.py "$FIXTURE_DIR" "$BUILD_DIR"
fi

echo "-- writing the copy's own environment --"
python3 - "$BUILD_DIR/.env.test" "$PROJECT" "$APP_PORT" "$POSTGRES_PORT" "$REDIS_PORT" <<'PY'
import re
import sys

path, project, app, pg, redis = sys.argv[1:]
values = {
    "PORT": app,
    "POSTGRES_PORT": pg,
    "REDIS_PORT": redis,
    "DATABASE_URL": f'"postgresql://postgres:postgres@localhost:{pg}/my_next_test"',
    "NEXTAUTH_URL": f'"http://localhost:{app}"',
    "REDIS_URL": f'"redis://localhost:{redis}"',
    "COMPOSE_PROJECT_NAME": project,
}
text = open(path, encoding="utf-8").read()
for key, value in values.items():
    line = f"{key}={value}"
    if re.search(rf"^{key}=.*$", text, re.M):
        text = re.sub(rf"^{key}=.*$", line, text, flags=re.M)
    else:
        text = text.rstrip("\n") + "\n" + line + "\n"
open(path, "w", encoding="utf-8").write(text)
PY
{
  echo "AUTH_SECRET=$(openssl rand -base64 32)"
  echo "MOCK_GOOGLE_OAUTH_TEST=true"
} > "$BUILD_DIR/.env.test.local"

cd "$BUILD_DIR"

echo "-- npm run test:e2e:build (docker up, generate-code, db:push, seed, next build) --"
NODE_ENV=test npm run test:e2e:build
NODE_ENV=test npm run db:grant-all-permissions

if [ "$MODE" = "fixture" ]; then
  echo "-- a record for the read-only entity (it has no create route) --"
  docker exec "${PROJECT}-postgres-test-1" psql -U postgres -d my_next_test -v ON_ERROR_STOP=1 -c \
    "INSERT INTO mobile_log (id, message, updated_at, creator_id, updater_id) SELECT 'log-seed-1', 'Seeded log entry', now(), id, id FROM \"user\" ORDER BY created_at LIMIT 1;" >/dev/null
  echo "-- records for the relation pickers --"
  # Two organizations: only the first has the test user (admin@example.com) as a member.
  docker exec -i "${PROJECT}-postgres-test-1" psql -U postgres -d my_next_test -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
WITH actor AS (SELECT id FROM "user" ORDER BY created_at LIMIT 1)
INSERT INTO mobile_group (id, name, updated_at, creator_id, updater_id)
SELECT v.id, v.name, now(), actor.id, actor.id FROM actor, (VALUES ('group-seed-1', 'Alpha Group'), ('group-seed-2', 'Beta Group')) AS v(id, name);
WITH actor AS (SELECT id FROM "user" ORDER BY created_at LIMIT 1)
INSERT INTO mobile_tag (id, name, updated_at, creator_id, updater_id)
SELECT v.id, v.name, now(), actor.id, actor.id FROM actor, (VALUES ('tag-seed-1', 'Red'), ('tag-seed-2', 'Green'), ('tag-seed-3', 'Blue')) AS v(id, name);
WITH actor AS (SELECT id FROM "user" ORDER BY created_at LIMIT 1)
INSERT INTO mobile_profile (id, name, updated_at, creator_id, updater_id)
SELECT v.id, v.name, now(), actor.id, actor.id FROM actor, (VALUES ('profile-seed-1', 'Profile One'), ('profile-seed-2', 'Profile Two'), ('profile-seed-3', 'Profile Three')) AS v(id, name);
WITH actor AS (SELECT id FROM "user" ORDER BY created_at LIMIT 1)
INSERT INTO organization (id, name, updated_at, creator_id, updater_id)
SELECT v.id, v.name, now(), actor.id, actor.id FROM actor, (VALUES ('org-own', 'Mobile Own Org'), ('org-foreign', 'Mobile Foreign Org')) AS v(id, name);
INSERT INTO "_UserOrganizations" ("A", "B") SELECT 'org-own', id FROM "user" WHERE email = 'admin@example.com';
SQL
  PW_TARGET="entity-crud.spec.ts relation-pickers.spec.ts"
  export MOBILE_PW_IGNORE=""
else
  PW_TARGET=""
  export MOBILE_PW_IGNORE="**/{entity-crud,relation-pickers}.spec.ts"
fi

echo "-- installing the Expo dependencies --"
(cd mobile && npm install --no-audit --no-fund >"$BUILD_DIR/mobile-install.log" 2>&1)

# start-server-and-test starts the two servers (the API; the Expo web bundle with its proxy), waits for each URL and stops
# them all when the specs finish.
echo "-- API + Expo web bundle + same-origin proxy, then playwright --"
set +e
NODE_ENV=test PAYMENT_FAKE_STRIPE=1 \
EXPO_WEB_URL="http://localhost:$PROXY_PORT" TEST_EMAIL=admin@example.com TEST_PASSWORD=password123 \
npx start-server-and-test \
  "npm run test:e2e:start" "http://localhost:$APP_PORT" \
  "cd mobile && EXPO_PUBLIC_API_BASE_URL=http://localhost:$PROXY_PORT WEB_PORT=$WEB_PORT PROXY_PORT=$PROXY_PORT API_PORT=$APP_PORT node scripts/serve-web-with-proxy.js" "http://localhost:$PROXY_PORT" \
  "mobile/node_modules/.bin/playwright test --config mobile/playwright.config.ts ${PW_TARGET} ${PW_ARGS:-}"
status=$?
set -e
echo "== mobile entity playwright: exit=$status =="
exit "$status"
