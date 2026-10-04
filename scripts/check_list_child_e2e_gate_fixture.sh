#!/bin/bash
# List-child E2E gate fixture check.
#
# Like the child-datagrid-e2e-gate, this builds and RUNS a whole app: it
# generates an app from the default schema plus a dedicated fixture schema,
# builds it, starts it against its own database and runs the Cypress specs in
# code_generator/tests/fixtures/list_child_e2e_gate/. They cover what a generated
# type check cannot: a child embedded with `x-outputType: list` shown on the
# parent's screens (no child page; editable child page with a nullable link, a
# second FK to the parent's own model and a sibling child; many-to-many;
# self-reference), the child's label built from that second FK, and from the
# parent screen adding an existing child to the list and removing one from it
# without deleting the child record.
#
# Isolation (the repository's own schema, generated output, database and other
# fixtures are never touched):
#   * everything happens in a disposable copy of the working tree,
#     .generated-list-child-e2e-gate/ (tracked + untracked-not-ignored
#     files, node_modules symlinked), into which the fixture entities are merged
#     (scripts/compose_child_datagrid_e2e_fixture.py, which merges any fixture dir);
#   * the copy gets its own .env.test (docker compose project name and three
#     ports derived from the repository's absolute path, so two checkouts never
#     collide) and a throwaway .env.test.local with a random AUTH_SECRET;
#   * docker cleanup is `docker compose -p <that project> down -v`, scoped to
#     the project name above; no other project, container or volume is touched;
#   * a port that is already in use fails the run instead of taking it over.
#
# Reuses the repository's own e2e machinery inside the copy:
# `npm run test:e2e:build` (docker up, generate-code, db:push, seed, next build)
# and scripts/run-e2e.js (start-server-and-test + cypress).
#
# Usage: bash scripts/check_list_child_e2e_gate_fixture.sh
# Environment: GATE_KEEP_BUILD_DIR=1 keeps the copy for inspection;
#              GATE_SPEC='<cypress spec glob>' narrows the specs (default: all of them).
# Exit code: 0 = pass, non-zero = fail (generation/build error or a failing spec).

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

FIXTURE_DIR="code_generator/tests/fixtures/list_child_e2e_gate"
BUILD_DIR="$REPO_ROOT/.generated-list-child-e2e-gate"

if [ ! -f "$FIXTURE_DIR/json_schema.yaml" ] || [ ! -f "$FIXTURE_DIR/schema_additions.prisma" ]; then
  echo "list-child-e2e-gate: fixture files not found under $FIXTURE_DIR" >&2
  exit 1
fi

# Names and ports derived from the absolute path of this checkout.
HASH=$(printf '%s' "$REPO_ROOT:list-child" | cksum | cut -d' ' -f1)
# Ports sit below the Linux ephemeral range (32768+) and apart from the 20000-27999
# band that per-worktree test environments commonly use.
SLOT=$((HASH % 900))
PROJECT="list_child_e2e_${HASH}"
APP_PORT=$((29000 + SLOT))
POSTGRES_PORT=$((30000 + SLOT))
REDIS_PORT=$((31000 + SLOT))

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

echo "== list-child-e2e-gate (project $PROJECT, ports app=$APP_PORT postgres=$POSTGRES_PORT redis=$REDIS_PORT) =="
t0=$(date +%s)

# A previous interrupted run of THIS checkout's project may still hold the ports.
compose_down
rm -rf "$BUILD_DIR"

for port in "$APP_PORT" "$POSTGRES_PORT" "$REDIS_PORT"; do
  if (exec 3<>"/dev/tcp/127.0.0.1/$port") 2>/dev/null; then
    echo "list-child-e2e-gate: port $port is already in use; not taking it over." >&2
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
mkdir -p "$BUILD_DIR/cypress/e2e/list_child_e2e_gate"
cp -r "$FIXTURE_DIR/cypress/e2e/." "$BUILD_DIR/cypress/e2e/list_child_e2e_gate/"

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

echo "-- cypress: fixture specs --"
set +e
NODE_ENV=test PAYMENT_FAKE_STRIPE=1 node scripts/run-e2e.js test:e2e:start \
  "cypress run --browser chromium --spec \"${GATE_SPEC:-cypress/e2e/list_child_e2e_gate/**/*.cy.ts}\""
status=$?
set -e

t1=$(date +%s)
echo "== list-child-e2e-gate: $((t1 - t0))s, cypress exit=$status =="
exit "$status"
