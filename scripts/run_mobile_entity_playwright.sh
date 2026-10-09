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
# Three modes, because the footer specs assume the default schema's tabs:
#   MODE=fixture (default)  fixture entities merged; runs mobile/e2e/entity-crud.spec.ts,
#                           mobile/e2e/relation-pickers.spec.ts, mobile/e2e/inline-create-checkout.spec.ts,
#                           mobile/e2e/list-capabilities.spec.ts, mobile/e2e/comments.spec.ts,
#                           mobile/e2e/approval-actions.spec.ts and mobile/e2e/split-action.spec.ts
#   MODE=default            unmodified schema; runs every other spec in mobile/e2e/
#   MODE=scheduled          the scheduled-task-e2e-gate fixture (three scheduled tasks) merged and the
#                           test user made a ScheduledTaskRunner; runs mobile/e2e/scheduled-task.spec.ts
#
# Usage: bash scripts/run_mobile_entity_playwright.sh
# Environment: GATE_KEEP_BUILD_DIR=1 keeps the copy; PORT_SLOT=<0-899> picks another port set; PW_ARGS='<playwright args>'
#              narrows the run (for example PW_ARGS='entity-crud.spec.ts').
# Every mode sets x-generator.mobile.enabled: true in the copy and fails closed if mobile/ is not generated.
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
elif [ "$MODE" = "scheduled" ]; then
  echo "-- merging the scheduled-task fixture schema into the copy --"
  python3 scripts/compose_child_datagrid_e2e_fixture.py code_generator/tests/fixtures/scheduled_task_e2e_gate "$BUILD_DIR"
fi

echo "-- opting the copy's schema in to mobile generation (x-generator.mobile.enabled) --"
# The default schema leaves the Expo app off and the fixture merge adds entities only, so every mode needs this.
python3 - "$BUILD_DIR/code_generator/json_schema.yaml" <<'PY'
import sys

path = sys.argv[1]
text = open(path, encoding="utf-8").read()
if "x-generator:\n" not in text:
    sys.exit("mobile-entity-playwright: no top-level x-generator block to enable mobile in")
text = text.replace("x-generator:\n", "x-generator:\n  mobile:\n    enabled: true\n", 1)
open(path, "w", encoding="utf-8").write(text)
PY

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
# Fail closed: without mobile/ every spec would fail confusingly or be skipped.
if [ ! -f mobile/lib/entity-registry.ts ]; then
  echo "mobile-entity-playwright: mobile/ was not generated (is x-generator.mobile.enabled true?); refusing to run." >&2
  exit 1
fi
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
  echo "-- records for the approval section --"
  # Three roles: the test administrator holds "Mobile Approver" and "Mobile Second Approver", not the other one.
  # flow-own is theirs to decide; flow-other is not; flow-second is theirs but comes after flow-other.
  docker exec -i "${PROJECT}-postgres-test-1" psql -U postgres -d my_next_test -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
WITH actor AS (SELECT id FROM "user" WHERE email = 'admin@example.com')
INSERT INTO role (id, name, updated_at, creator_id, updater_id)
SELECT v.id, v.name, now(), actor.id, actor.id FROM actor, (VALUES ('role-approver', 'Mobile Approver'), ('role-second', 'Mobile Second Approver'), ('role-other', 'Mobile Other Approver')) AS v(id, name);
INSERT INTO "_UserRoles" ("A", "B") SELECT r.id, u.id FROM "user" u, (VALUES ('role-approver'), ('role-second')) AS r(id) WHERE u.email = 'admin@example.com';
WITH actor AS (SELECT id FROM "user" WHERE email = 'admin@example.com')
INSERT INTO approval_flow (id, entity_name, approver_role_id, updated_at, creator_id, updater_id)
SELECT v.id, 'mobile_request', v.role_id, now(), actor.id, actor.id FROM actor,
  (VALUES ('flow-own', 'role-approver'), ('flow-other', 'role-other'), ('flow-second', 'role-second')) AS v(id, role_id);
-- flow-second is preceded by flow-other (implicit many-to-many "_ApprovalFlowOrder": A = followed_by side, B = preceded_by side)
INSERT INTO "_ApprovalFlowOrder" ("A", "B") VALUES ('flow-other', 'flow-second');
-- (record id, title, record status, approvable creator is the administrator, [request id, flow, request status]...)
WITH actor AS (SELECT id FROM "user" WHERE email = 'admin@example.com')
INSERT INTO approvable (id, creator_id)
SELECT v.id, CASE WHEN v.mine THEN actor.id END FROM actor,
  (VALUES ('ap-approve', false), ('ap-reject', false), ('ap-withdraw', true), ('ap-stranger', false), ('ap-decided', false), ('ap-staged', false)) AS v(id, mine);
INSERT INTO approval_request (id, approvable_id, approval_flow_id, status, round_id, updated_at) VALUES
  ('ar-approve', 'ap-approve', 'flow-own', 'pending', 'round-approve', now()),
  ('ar-reject', 'ap-reject', 'flow-own', 'pending', 'round-reject', now()),
  ('ar-withdraw', 'ap-withdraw', 'flow-other', 'pending', 'round-withdraw', now()),
  ('ar-stranger', 'ap-stranger', 'flow-other', 'pending', 'round-stranger', now()),
  ('ar-decided', 'ap-decided', 'flow-own', 'approved', 'round-decided', now()),
  ('ar-staged-1', 'ap-staged', 'flow-other', 'pending', 'round-staged', now()),
  ('ar-staged-2', 'ap-staged', 'flow-second', 'pending', 'round-staged', now());
WITH actor AS (SELECT id FROM "user" WHERE email = 'admin@example.com')
INSERT INTO mobile_request (id, title, status, approvable_id, updated_at, creator_id, updater_id)
SELECT v.id, v.title, v.status::"MobileRequestStatus", v.approvable_id, now(), actor.id, actor.id FROM actor,
  (VALUES ('req-approve', 'Approve me', 'submitted', 'ap-approve'),
          ('req-reject', 'Reject me', 'submitted', 'ap-reject'),
          ('req-withdraw', 'Withdraw me', 'submitted', 'ap-withdraw'),
          ('req-stranger', 'Not mine to decide', 'draft', 'ap-stranger'),
          ('req-decided', 'Already decided', 'approved', 'ap-decided'),
          ('req-staged', 'Two stages', 'submitted', 'ap-staged')) AS v(id, title, status, approvable_id);
-- the split action: a flow for mobile_shipment (a role the administrator does not hold) and three shipments of 10
WITH actor AS (SELECT id FROM "user" WHERE email = 'admin@example.com')
INSERT INTO approval_flow (id, entity_name, approver_role_id, updated_at, creator_id, updater_id)
SELECT 'flow-ship', 'mobile_shipment', 'role-other', now(), actor.id, actor.id FROM actor;
INSERT INTO approvable (id, approved_at) VALUES ('ap-ship-rule', NULL), ('ap-ship-split', NULL), ('ap-ship-approved', now());
INSERT INTO approval_request (id, approvable_id, approval_flow_id, status, round_id, updated_at) VALUES
  ('ar-ship-rule', 'ap-ship-rule', 'flow-ship', 'pending', 'round-ship-rule', now()),
  ('ar-ship-split', 'ap-ship-split', 'flow-ship', 'pending', 'round-ship-split', now()),
  ('ar-ship-approved', 'ap-ship-approved', 'flow-ship', 'approved', 'round-ship-approved', now());
WITH actor AS (SELECT id FROM "user" WHERE email = 'admin@example.com')
INSERT INTO mobile_shipment (id, title, quantity, status, mobile_group_id, approvable_id, updated_at, creator_id, updater_id)
SELECT v.id, v.title, 10, v.status::"MobileShipmentStatus", 'group-seed-1', v.approvable_id, now(), actor.id, actor.id FROM actor,
  (VALUES ('ship-rule', 'Rule shipment', 'pending', 'ap-ship-rule'),
          ('ship-split', 'Split shipment', 'pending', 'ap-ship-split'),
          ('ship-approved', 'Approved shipment', 'approved', 'ap-ship-approved')) AS v(id, title, status, approvable_id);
SQL
  echo "-- a commentable record with comments, a mention and a reaction --"
  docker exec -i "${PROJECT}-postgres-test-1" psql -U postgres -d my_next_test -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
INSERT INTO commentable (id) VALUES ('thread-commentable-1'), ('thread-commentable-2');
WITH actor AS (SELECT id FROM "user" ORDER BY created_at LIMIT 1)
INSERT INTO mobile_thread (id, title, commentable_id, updated_at, creator_id, updater_id)
SELECT v.id, v.title, v.commentable_id, now(), actor.id, actor.id
FROM actor, (VALUES ('thread-seed-1', 'Thread with comments', 'thread-commentable-1'), ('thread-seed-2', 'Thread without comments', 'thread-commentable-2')) AS v(id, title, commentable_id);
WITH actor AS (SELECT id FROM "user" ORDER BY created_at LIMIT 1)
INSERT INTO comment (id, message, commentable_id, updated_at, creator_id)
SELECT v.id, replace(v.message, '@ACTOR@', actor.id), 'thread-commentable-1', now(), actor.id
FROM actor, (VALUES ('comment-seed-1', 'First comment'), ('comment-seed-2', 'Second comment, cc @[user_id:@ACTOR@] please look')) AS v(id, message);
INSERT INTO reaction (id, type, user_id, comment_id, updated_at)
SELECT 'reaction-seed-1', 'like', id, 'comment-seed-1', now() FROM "user" ORDER BY created_at LIMIT 1;
SQL
  PW_TARGET="entity-crud.spec.ts relation-pickers.spec.ts list-capabilities.spec.ts inline-create-checkout.spec.ts comments.spec.ts approval-actions.spec.ts split-action.spec.ts"
  export MOBILE_PW_IGNORE=""
elif [ "$MODE" = "scheduled" ]; then
  echo "-- the test user holds the ScheduledTaskRunner role --"
  docker exec -i "${PROJECT}-postgres-test-1" psql -U postgres -d my_next_test -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
INSERT INTO role (id, name, updated_at, creator_id, updater_id)
SELECT 'role-scheduled-runner', 'ScheduledTaskRunner', now(), id, id FROM "user" ORDER BY created_at LIMIT 1;
INSERT INTO "_UserRoles" ("A", "B") SELECT 'role-scheduled-runner', id FROM "user" WHERE email = 'admin@example.com';
SQL
  PW_TARGET="scheduled-task.spec.ts"
  export MOBILE_PW_IGNORE=""
else
  PW_TARGET=""
  export MOBILE_PW_IGNORE="**/{entity-crud,relation-pickers,list-capabilities,inline-create-checkout,comments,approval-actions,split-action,scheduled-task}.spec.ts"
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
