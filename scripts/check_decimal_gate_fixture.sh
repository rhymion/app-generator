#!/bin/bash
# Decimal-gate fixture check (subtask_705a / cmd_705).
#
# Runs a small, self-contained fixture entity (a required + a nullable
# Decimal column, each with an explicit @db.Decimal(p, s) scale) through the
# real build_user_schema.py -> generate.py -> tsc pipeline and type-checks
# the generated files that carry the Decimal-specific branches: getters.ts
# (decimal_display_columns .toString() serialization), FormUpsert.tsx
# (decimal_props AppFieldText rendering), form_validation.ts /
# service_validation.ts (DECIMAL_FIELDS numeric-format check), and the CSV
# import route (api_import_route.ts.jinja2's 'decimal' ts_type coercion).
#
# Why this exists: this repo's own json_schema.yaml has zero Decimal-typed
# fields, so test:e2e:build's own tsc pass (this repo's own generated
# output) never compiles any of the above branches -- a regression in any of
# them would only ever surface in a downstream consumer schema, late.
# Mirrors scripts/check_mention_gate_fixture.sh's structure and rationale.
#
# Usage: bash scripts/check_decimal_gate_fixture.sh
# Exit code: 0 = pass, non-zero = fail (schema/generation error or a real
# tsc type error).

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

FIXTURE_DIR="code_generator/tests/fixtures/decimal_gate"
OUT_DIR="$REPO_ROOT/.generated-decimal-gate"

if [ ! -f "$FIXTURE_DIR/json_schema.yaml" ] || [ ! -f "$FIXTURE_DIR/schema.prisma" ]; then
  echo "decimal-gate fixture check: fixture files not found under $FIXTURE_DIR" >&2
  exit 1
fi

echo "== decimal-gate fixture check =="
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
npx prisma generate --schema="$OUT_DIR/prisma/schema.prisma" >/tmp/decimal_gate_prisma_generate.log 2>&1 \
  || { cat /tmp/decimal_gate_prisma_generate.log >&2; exit 1; }

# Fixture-only shims for stable, entity-independent shared libs that the
# generated files import -- see fixtures/decimal_gate/shims/ for the source
# of truth and why these exist rather than the real files.
cp "$FIXTURE_DIR/shims/prisma.ts" "$OUT_DIR/lib/prisma.ts"
cp "$FIXTURE_DIR/shims/authz.ts" "$OUT_DIR/lib/authz.ts"
cp "$FIXTURE_DIR/shims/api-auth.ts" "$OUT_DIR/lib/api-auth.ts"
cp "$FIXTURE_DIR/tsconfig.json" "$OUT_DIR/tsconfig.json"

echo "-- tsc --noEmit (getters.ts + FormUpsert.tsx + validation + import route) --"
set +e
npx tsc -p "$OUT_DIR/tsconfig.json"
tsc_status=$?
set -e

t1=$(date +%s.%N)
elapsed=$(echo "$t1 - $t0" | bc)
echo "== decimal-gate fixture check: $(printf '%.1f' "$elapsed")s, tsc exit=$tsc_status =="

if [ "$tsc_status" -ne 0 ]; then
  echo "decimal-gate fixture check FAILED -- a Decimal-specific branch (see" >&2
  echo "scripts/check_decimal_gate_fixture.sh header for the list) no longer" >&2
  echo "type-checks." >&2
  exit "$tsc_status"
fi

exit 0
