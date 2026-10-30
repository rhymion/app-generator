#!/bin/bash
# Leak canary E2E gate fixture check.
#
# Puts a unique marker value into every secret-bearing field (password hash, API key, MFA secret,
# recovery code hash, refresh-token hash, encrypted original file name, a write-only field, a record of
# a foreign organization) and into the secret environment variables (AUTH_SECRET, TEST_RESET_TOKEN),
# builds and RUNS a whole app, crawls every GET route behind a recording proxy and fails when a marker
# appears where it must not. What is checked is declared as data in code_generator/leak_canary.yaml; the
# checker is code_generator/leak_canary.py (see docs/knowledge/leak-canary-test.md).
#
# Outputs searched:
#   * every response (status line, headers, body), the export routes, download names (Content-Disposition)
#     and redirect targets (Location), through the proxy that fronts the app;
#   * the server's stdout and stderr for the whole run;
#   * the client bundle (.next/static) and any source map, for the secret environment variables.
#
# Isolation (the repository's own schema, generated output, database and other fixtures are never
# touched): the same disposable copy, own docker project and derived ports as
# scripts/check_comment_rest_e2e_gate_fixture.sh; docker cleanup is `docker compose -p <that project>
# down -v`, scoped to the project name; a port that is already in use fails the run.
#
# Usage: bash scripts/check_leak_canary_gate_fixture.sh
# Environment: LEAK_CANARY_PORT_SLOT=<0-899> picks the port slot instead of the path-derived one;
#              GATE_KEEP_BUILD_DIR=1 keeps the copy for inspection;
#              GATE_SPEC='<cypress spec glob>' narrows the specs (default: the crawl spec).
# Exit code: 0 = pass, non-zero = fail (generation/build error, a failing spec or a marker hit).

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

FIXTURE_DIR="code_generator/tests/fixtures/leak_canary_gate"
BUILD_DIR="$REPO_ROOT/.generated-leak-canary-gate"

if [ ! -f "$FIXTURE_DIR/json_schema.yaml" ] || [ ! -f "$FIXTURE_DIR/schema_additions.prisma" ]; then
  echo "leak-canary-gate: fixture files not found under $FIXTURE_DIR" >&2
  exit 1
fi

# Names and ports derived from the absolute path of this checkout.
HASH=$(printf '%s' "$REPO_ROOT:leak-canary" | cksum | cut -d' ' -f1)
# Ports sit below the Linux ephemeral range (32768+) and apart from the 20000-27999
# band that per-worktree test environments commonly use.
SLOT=$((${LEAK_CANARY_PORT_SLOT:-$((HASH % 900))}))
PROJECT="leak_canary_gate_${HASH}"
APP_PORT=$((29000 + SLOT))
POSTGRES_PORT=$((30000 + SLOT))
REDIS_PORT=$((31000 + SLOT))
# The recording proxy fronts the app: the browser, Cypress and NEXTAUTH_URL all use this port.
PROXY_PORT=$((28000 + SLOT))

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
# One run per checkout: take the lock before the cleanup trap exists, so a refused
# second run never tears down the first run's stack (scripts/gate_run_lock.sh).
source "$REPO_ROOT/scripts/gate_run_lock.sh"
gate_run_lock "$BUILD_DIR.lock" "leak-canary-gate"
trap cleanup EXIT

echo "== leak-canary-gate (project $PROJECT, ports proxy=$PROXY_PORT app=$APP_PORT postgres=$POSTGRES_PORT redis=$REDIS_PORT) =="
t0=$(date +%s)

# A previous interrupted run of THIS checkout's project may still hold the ports.
compose_down
rm -rf "$BUILD_DIR"

for port in "$PROXY_PORT" "$APP_PORT" "$POSTGRES_PORT" "$REDIS_PORT"; do
  if (exec 3<>"/dev/tcp/127.0.0.1/$port") 2>/dev/null; then
    echo "leak-canary-gate: port $port is already in use; not taking it over." >&2
    exit 1
  fi
done

echo "-- copying the working tree --"
mkdir -p "$BUILD_DIR"
git ls-files -z --cached --others --exclude-standard \
  | tar --null --ignore-failed-read -T - -cf - 2>/dev/null \
  | tar -xf - -C "$BUILD_DIR"
# Next/Turbopack needs node_modules inside the project root it infers, so this checkout
# must hold a real node_modules directory (not a symlink to another checkout).
ln -s "$REPO_ROOT/node_modules" "$BUILD_DIR/node_modules"

echo "-- merging the fixture schema into the copy --"
python3 scripts/compose_child_datagrid_e2e_fixture.py "$FIXTURE_DIR" "$BUILD_DIR"
mkdir -p "$BUILD_DIR/cypress/e2e/leak_canary_gate"
cp -r "$FIXTURE_DIR/cypress/e2e/." "$BUILD_DIR/cypress/e2e/leak_canary_gate/"
mkdir -p "$BUILD_DIR/components/lk_vault"
cp "$FIXTURE_DIR/components/lk_vault/secret_note.tsx" "$BUILD_DIR/components/lk_vault/secret_note.tsx"
cp "$FIXTURE_DIR/cypress/support/project-tasks.ts" "$BUILD_DIR/cypress/support/project-tasks.ts"

echo "-- planning the markers --"
mkdir -p "$BUILD_DIR/.leak-canary"
python3 code_generator/leak_canary.py plan --out "$BUILD_DIR/.leak-canary/plan.json"

echo "-- writing the copy's own environment --"
python3 - "$BUILD_DIR/.env.test" "$PROJECT" "$APP_PORT" "$POSTGRES_PORT" "$REDIS_PORT" "$PROXY_PORT" <<'PY'
import re
import sys

path, project, app, pg, redis, proxy = sys.argv[1:]
values = {
    "PORT": app,
    "POSTGRES_PORT": pg,
    "REDIS_PORT": redis,
    "DATABASE_URL": f'"postgresql://postgres:postgres@localhost:{pg}/my_next_test"',
    "NEXTAUTH_URL": f'"http://localhost:{proxy}"',
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
# The secret environment variables hold their markers: the build and the running app use them.
python3 - "$BUILD_DIR/.leak-canary/plan.json" >> "$BUILD_DIR/.env.test.local" <<'PY'
import json
import sys

for canary in json.load(open(sys.argv[1], encoding="utf-8")).values():
    if canary["kind"] == "env":
        print(f'{canary["name"]}={canary["value"]}')
PY
echo "MOCK_GOOGLE_OAUTH_TEST=true" >> "$BUILD_DIR/.env.test.local"

cd "$BUILD_DIR"

echo "-- npm run test:e2e:build (docker up, generate-code, db:push, seed, next build) --"
NODE_ENV=test npm run test:e2e:build

HITS="$BUILD_DIR/.leak-canary/hits.jsonl"
SERVER_LOG="$BUILD_DIR/.leak-canary/server.log"
: > "$HITS"
CANARY="python3 $REPO_ROOT/code_generator/leak_canary.py"

echo "-- scanning the build: client bundle and source maps --"
$CANARY scan --plan .leak-canary/plan.json --surface client_bundle --hits "$HITS" .next/static
MAPS=$(find .next -name '*.map' 2>/dev/null || true)
# shellcheck disable=SC2086
$CANARY scan --plan .leak-canary/plan.json --surface source_map --hits "$HITS" ${MAPS:-/nonexistent}

echo "-- starting the app and the recording proxy --"
APP_PID=""
PROXY_PID=""
stop_children() {
  # The app runs in its own session (setsid), so one signal to its group reaches npx, next and the server.
  [ -n "$PROXY_PID" ] && { kill "$PROXY_PID" 2>/dev/null || true; }
  [ -n "$APP_PID" ] && { kill -- "-$APP_PID" 2>/dev/null || true; }
  # Runs again from the EXIT trap with empty PIDs: a false test as the last command would fail the script under set -e.
  return 0
}
trap 'stop_children; cleanup' EXIT
NODE_ENV=test setsid node scripts/run-next-start.js > "$SERVER_LOG" 2>&1 &
APP_PID=$!
$CANARY proxy --plan .leak-canary/plan.json --upstream "http://127.0.0.1:$APP_PORT" --port "$PROXY_PORT" --hits "$HITS" &
PROXY_PID=$!
for _ in $(seq 1 120); do
  if curl -s -o /dev/null "http://127.0.0.1:$PROXY_PORT/api/openapi.json"; then break; fi
  sleep 1
done

echo "-- cypress: crawl spec --"
set +e
NODE_ENV=test npx cypress run --browser chromium \
  --config "baseUrl=http://localhost:$PROXY_PORT" \
  --spec "${GATE_SPEC:-cypress/e2e/leak_canary_gate/**/*.cy.ts}"
status=$?
set -e
stop_children
APP_PID=""
PROXY_PID=""

echo "-- scanning the server output --"
$CANARY scan --plan .leak-canary/plan.json --surface server_log --hits "$HITS" "$SERVER_LOG"
set +e
$CANARY verdict --hits "$HITS" --min-requests "${LEAK_CANARY_MIN_REQUESTS:-20}"
verdict_status=$?
set -e
if [ "$status" -eq 0 ]; then status=$verdict_status; fi
t1=$(date +%s)
echo "== leak-canary-gate: $((t1 - t0))s, exit=$status =="
exit "$status"
