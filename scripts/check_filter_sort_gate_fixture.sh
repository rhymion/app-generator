#!/bin/bash
# Filter-sort-gate fixture check (app-generator cmd_1200(c)).
#
# Runs a small, self-contained fixture entity carrying every
# ColumnFilterKind lib/_pagination.ts dispatches on at once (enum/boolean/
# number/decimal/date/date-time/time/string) through the real
# build_user_schema.py -> generate.py -> tsc pipeline and type-checks
# getters.ts (FIELD_KINDS/ENUM_MEMBERS/DECIMAL_SCALES const declarations),
# form_validation.ts/service_validation.ts, and FormUpsert.tsx.
#
# Why this exists: this repo's own json_schema.yaml has zero enum/boolean/
# decimal/date-kind columns among its own (api:true, test:true, list:true)
# entities (confirmed empirically -- see cmd_1200(b)'s generated
# cypress/e2e/api/_filter_sort_matrix_gen.cy.ts header), so test:e2e:build's
# own tsc pass never compiles the above branches with every kind coexisting
# on one entity. Mirrors scripts/check_decimal_gate_fixture.sh's structure.
#
# Usage: bash scripts/check_filter_sort_gate_fixture.sh
# Exit code: 0 = pass, non-zero = fail (schema/generation error or a real
# tsc type error).

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

FIXTURE_DIR="code_generator/tests/fixtures/filter_sort_gate"
OUT_DIR="$REPO_ROOT/.generated-filter-sort-gate"

if [ ! -f "$FIXTURE_DIR/json_schema.yaml" ] || [ ! -f "$FIXTURE_DIR/schema.prisma" ]; then
  echo "filter-sort-gate fixture check: fixture files not found under $FIXTURE_DIR" >&2
  exit 1
fi

echo "== filter-sort-gate fixture check =="
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
npx prisma generate --schema="$OUT_DIR/prisma/schema.prisma" >/tmp/filter_sort_gate_prisma_generate.log 2>&1 \
  || { cat /tmp/filter_sort_gate_prisma_generate.log >&2; exit 1; }

# Fixture-only shims for stable, entity-independent shared libs that the
# generated files import -- see fixtures/filter_sort_gate/shims/ for the
# source of truth and why these exist rather than the real files.
cp "$FIXTURE_DIR/shims/prisma.ts" "$OUT_DIR/lib/prisma.ts"
cp "$FIXTURE_DIR/shims/authz.ts" "$OUT_DIR/lib/authz.ts"
cp "$FIXTURE_DIR/shims/api-auth.ts" "$OUT_DIR/lib/api-auth.ts"
cp "$FIXTURE_DIR/shims/idempotency.ts" "$OUT_DIR/lib/idempotency.ts"
cp "$FIXTURE_DIR/tsconfig.json" "$OUT_DIR/tsconfig.json"

echo "-- tsc --noEmit (getters.ts + FormUpsert.tsx + validation) --"
set +e
npx tsc -p "$OUT_DIR/tsconfig.json"
tsc_status=$?
set -e

t1=$(date +%s.%N)
elapsed=$(echo "$t1 - $t0" | bc)
echo "== filter-sort-gate fixture check: $(printf '%.1f' "$elapsed")s, tsc exit=$tsc_status =="

if [ "$tsc_status" -ne 0 ]; then
  echo "filter-sort-gate fixture check FAILED -- an enum/boolean/decimal/date" >&2
  echo "column-kind branch (FIELD_KINDS/ENUM_MEMBERS/DECIMAL_SCALES in" >&2
  echo "getters.ts.jinja2, or FormUpsert.tsx/form_validation.ts/" >&2
  echo "service_validation.ts) no longer type-checks with every kind" >&2
  echo "coexisting on one entity. See scripts/check_filter_sort_gate_fixture.sh" >&2
  echo "header." >&2
  exit "$tsc_status"
fi

exit 0
