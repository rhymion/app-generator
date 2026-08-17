#!/bin/bash
# Approval-lockdown-gate fixture check (cmd_732).
#
# Runs a small, self-contained fixture entity (a nativeEnum status field
# with x-approval.on_approved/on_rejected.set_fields declared on it)
# through the real build_user_schema.py -> generate.py -> tsc pipeline and
# type-checks the generated files that carry the value-lockdown-specific
# branches: form_upsert_context's disabled-option rendering (FormUpsert.tsx),
# service_validation.ts (APPROVAL_LOCKED_FIELDS create/update check, shared
# by the REST API route and the Server Action write path), and
# api_import_route.ts.jinja2 (the CSV-side duplicate of the same check,
# since CSV import bypasses the service layer entirely).
#
# Why this exists: this repo's own json_schema.yaml declares no x-approval
# entity, so test:e2e:build's own tsc pass never compiles any of the above
# branches -- a regression in any of them would only ever surface in a
# downstream consumer schema, late. Mirrors scripts/check_decimal_gate_fixture.sh's
# structure and rationale.
#
# Usage: bash scripts/check_approval_lockdown_gate_fixture.sh
# Exit code: 0 = pass, non-zero = fail (schema/generation error or a real
# tsc type error).

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

FIXTURE_DIR="code_generator/tests/fixtures/approval_lockdown_gate"
OUT_DIR="$REPO_ROOT/.generated-approval-lockdown-gate"

if [ ! -f "$FIXTURE_DIR/json_schema.yaml" ] || [ ! -f "$FIXTURE_DIR/schema.prisma" ]; then
  echo "approval-lockdown-gate fixture check: fixture files not found under $FIXTURE_DIR" >&2
  exit 1
fi

echo "== approval-lockdown-gate fixture check =="
t0=$(date +%s.%N)

rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR/prisma" "$OUT_DIR/lib" "$OUT_DIR/app/api"
cp "$FIXTURE_DIR/schema.prisma" "$OUT_DIR/prisma/schema.prisma"

echo "-- build_user_schema.py (Stage 4 -> intermediate) --"
python3 code_generator/build_user_schema.py \
  "$FIXTURE_DIR/json_schema.yaml" \
  "$OUT_DIR/prisma/schema.prisma" \
  --out "$OUT_DIR/generated_json_schema.yaml"

echo "-- generate.py (intermediate -> TS) --"
python3 code_generator/generate.py "$OUT_DIR/generated_json_schema.yaml" "$OUT_DIR"

echo "-- prisma generate (fixture-only client, isolated output) --"
npx prisma generate --schema="$OUT_DIR/prisma/schema.prisma" >/tmp/approval_lockdown_gate_prisma_generate.log 2>&1 \
  || { cat /tmp/approval_lockdown_gate_prisma_generate.log >&2; exit 1; }

# Fixture-only shims for stable, entity-independent shared libs that the
# generated files import -- see fixtures/approval_lockdown_gate/shims/ for
# the source of truth and why these exist rather than the real files.
cp "$FIXTURE_DIR/shims/prisma.ts" "$OUT_DIR/lib/prisma.ts"
cp "$FIXTURE_DIR/shims/authz.ts" "$OUT_DIR/lib/authz.ts"
cp "$FIXTURE_DIR/shims/api-auth.ts" "$OUT_DIR/lib/api-auth.ts"
cp "$FIXTURE_DIR/tsconfig.json" "$OUT_DIR/tsconfig.json"

echo "-- tsc --noEmit (FormUpsert.tsx + service_validation.ts + import route) --"
set +e
npx tsc -p "$OUT_DIR/tsconfig.json"
tsc_status=$?
set -e

# Content assertions -- tsc only proves the emitted code TYPE-CHECKS, not
# that the value-lockdown branches actually rendered (an entity with no
# locked values would type-check too, silently proving nothing). Assert the
# expected markers are present in the generated output.
echo "-- content checks (locked-value markers actually rendered) --"
content_status=0
_SV="$OUT_DIR/lib/approval_lockdown_gate_item/service_validation.ts"
_IMPORT_ROUTE="$OUT_DIR/app/api/approval_lockdown_gate_item/import/route.ts"
_FORM="$OUT_DIR/components/approval_lockdown_gate_item/FormUpsert.tsx"

for f in "$_SV" "$_IMPORT_ROUTE" "$_FORM"; do
  if [ ! -f "$f" ]; then
    echo "approval-lockdown-gate fixture check FAILED: expected generated file missing: $f" >&2
    content_status=1
  fi
done

if [ "$content_status" -eq 0 ]; then
  grep -q "APPROVAL_LOCKED_FIELDS" "$_SV" || { echo "FAILED: $_SV missing APPROVAL_LOCKED_FIELDS" >&2; content_status=1; }
  grep -q '"active"' "$_SV" || { echo "FAILED: $_SV missing locked value 'active'" >&2; content_status=1; }
  grep -q "APPROVAL_LOCKED_VALUE" "$_IMPORT_ROUTE" || { echo "FAILED: $_IMPORT_ROUTE missing APPROVAL_LOCKED_VALUE" >&2; content_status=1; }
  grep -q "disabled: true" "$_FORM" || { echo "FAILED: $_FORM missing disabled: true option" >&2; content_status=1; }
fi

t1=$(date +%s.%N)
elapsed=$(echo "$t1 - $t0" | bc)
echo "== approval-lockdown-gate fixture check: $(printf '%.1f' "$elapsed")s, tsc exit=$tsc_status, content exit=$content_status =="

if [ "$tsc_status" -ne 0 ]; then
  echo "approval-lockdown-gate fixture check FAILED -- a value-lockdown branch (see" >&2
  echo "scripts/check_approval_lockdown_gate_fixture.sh header for the list) no" >&2
  echo "longer type-checks." >&2
  exit "$tsc_status"
fi

if [ "$content_status" -ne 0 ]; then
  exit "$content_status"
fi

exit 0
