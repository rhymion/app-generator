#!/bin/bash
# Security-matrix E2E gate fixture check.
#
# Builds and RUNS a whole app: the default schema plus a dedicated fixture schema
# (code_generator/tests/fixtures/security_matrix_e2e_gate/) with organization-scoped entities that
# refer to each other by foreign key, carry an assignee, and use invalidation, approval, attachments,
# comments, splitting and an `x-filter-values` view. The default schema has no entity that mixes
# these, so the generated security tests (permission denied, cross-organization) otherwise never
# ran against such an entity in the mandatory gate.
#
# After the build it checks that
#   * the security manifest lists the fixture entities with the operations that prove each feature
#     is generated (so the fixture cannot silently stop exercising a feature), then
#   * `npm run check:security-matrix` passes on the merged schema, then
#   * the generated API specs of the fixture entities pass against the running app.
#
# Isolation (the repository's own schema, generated output, database and other
# fixtures are never touched):
#   * everything happens in a disposable copy of the working tree,
#     .generated-security-matrix-e2e-gate/ (tracked + untracked-not-ignored
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
# Usage: bash scripts/check_security_matrix_e2e_gate_fixture.sh
# Environment: GATE_KEEP_BUILD_DIR=1 keeps the copy for inspection;
#              GATE_SPEC='<cypress spec glob>' narrows the specs (default: all of them).
# Exit code: 0 = pass, non-zero = fail (generation/build error or a failing spec).

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

FIXTURE_DIR="code_generator/tests/fixtures/security_matrix_e2e_gate"
BUILD_DIR="$REPO_ROOT/.generated-security-matrix-e2e-gate"

if [ ! -f "$FIXTURE_DIR/json_schema.yaml" ] || [ ! -f "$FIXTURE_DIR/schema_additions.prisma" ]; then
  echo "security-matrix-e2e-gate: fixture files not found under $FIXTURE_DIR" >&2
  exit 1
fi

# Names and ports derived from the absolute path of this checkout.
HASH=$(printf '%s' "$REPO_ROOT:security-matrix" | cksum | cut -d' ' -f1)
# Ports sit below the Linux ephemeral range (32768+) and apart from the 20000-27999
# band that per-worktree test environments commonly use.
SLOT=$((HASH % 900))
PROJECT="security_matrix_e2e_${HASH}"
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
# One run per checkout: take the lock before the cleanup trap exists, so a refused
# second run never tears down the first run's stack (scripts/gate_run_lock.sh).
source "$REPO_ROOT/scripts/gate_run_lock.sh"
gate_run_lock "$BUILD_DIR.lock" "security-matrix-e2e-gate"
trap cleanup EXIT

echo "== security-matrix-e2e-gate (project $PROJECT, ports app=$APP_PORT postgres=$POSTGRES_PORT redis=$REDIS_PORT) =="
t0=$(date +%s)

# A previous interrupted run of THIS checkout's project may still hold the ports.
compose_down
rm -rf "$BUILD_DIR"

for port in "$APP_PORT" "$POSTGRES_PORT" "$REDIS_PORT"; do
  if (exec 3<>"/dev/tcp/127.0.0.1/$port") 2>/dev/null; then
    echo "security-matrix-e2e-gate: port $port is already in use; not taking it over." >&2
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

echo "-- security manifest lists what the fixture is there to exercise --"
python3 - .security-manifest.json <<'PY'
import json
import sys

manifest = json.load(open(sys.argv[1], encoding="utf-8"))["entities"]
expected = {
    "sx_account": {"action_invalidate", "invalidate", "bulk_update", "options"},
    "sx_task": {"update", "delete", "bulk_delete", "action_update"},
    "sx_split": {"update", "bulk_update"},
    "sx_open_task": {"list", "detail"},
}
problems = []
for entity, operations in expected.items():
    if entity not in manifest:
        problems.append(f"{entity}: not in the manifest")
        continue
    cells = manifest[entity]["cells"]
    have = {c["operation"] for c in cells}
    if not operations <= have:
        problems.append(f"{entity}: missing operations {sorted(operations - have)}")
    if not any(c["case"] == "cross_org" for c in cells) and entity != "sx_open_task":
        problems.append(f"{entity}: no cross-organization cell")
if problems:
    print("security-matrix-e2e-gate: the fixture no longer exercises its features:", *problems, sep="\n  ", file=sys.stderr)
    sys.exit(1)
PY

echo "-- check:security-matrix on the merged schema (default allowlist plus the fixture's) --"
python3 code_generator/security_matrix.py check --manifest .security-manifest.json --tests cypress \
  --allowlist code_generator/security_matrix_allowlist.yaml "code_generator/tests/fixtures/security_matrix_e2e_gate/allowlist.yaml"

DEFAULT_SPEC="cypress/e2e/api/sx_*.cy.ts"

echo "-- cypress: fixture specs --"
set +e
NODE_ENV=test PAYMENT_FAKE_STRIPE=1 node scripts/run-e2e.js test:e2e:start \
  "cypress run --browser chromium --spec \"${GATE_SPEC:-$DEFAULT_SPEC}\""
status=$?
set -e

t1=$(date +%s)
echo "== security-matrix-e2e-gate: $((t1 - t0))s, cypress exit=$status =="
exit "$status"
