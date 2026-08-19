#!/bin/bash
# Chart-decimal-gate fixture check (cmd_755[1]).
#
# Runs a small, self-contained fixture entity pair (chart_decimal_gate_row,
# the chart's row_by target, and chart_decimal_gate_item, which declares
# x-display.chart and carries a REQUIRED Decimal column) through the real
# build_user_schema.py -> generate.py -> tsc pipeline and type-checks the
# generated chart-getters.ts and chart/page.tsx.
#
# Why this exists: get{Parent}sForChart (chart_getters.ts.jinja2) used to
# assign a required Decimal column straight off the raw Prisma row
# (`{{ field }}: item.{{ field }},`) into a field the generated
# {Parent}ForChart interface types as `string` (chart_context() in
# generators.py resolves a Decimal column's JSON-schema type as `string`
# per cmd_705's `_prisma_decimal_type` marker, but the raw row value is a
# Prisma.Decimal instance) -- a TS2322 at build time (cmd_755, defect 1,
# 2026-08-19: a real consumer schema had marked two Decimal columns
# nullable specifically to work around this defect, which read from the
# outside as a business rule rather than a generator limitation). Neither
# decimal_gate (an entity's own columns via getters.ts's
# decimal_display_columns, or an embedded relation's Decimal columns via
# relationship_mapping) nor oto_decimal_gate (a one-to-one selector's
# separate getAvailable{Target}sFor{Parent} getter) compiles this
# chart-specific getter, and this repo's own json_schema.yaml has no
# entity combining x-display.chart with a required Decimal column, so
# test:e2e:build never compiles it either.
#
# Usage: bash scripts/check_chart_decimal_gate_fixture.sh
# Exit code: 0 = pass, non-zero = fail (schema/generation error or a real
# tsc type error -- e.g. the TS2322 failure this gate exists to catch).

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

FIXTURE_DIR="code_generator/tests/fixtures/chart_decimal_gate"
OUT_DIR="$REPO_ROOT/.generated-chart-decimal-gate"

if [ ! -f "$FIXTURE_DIR/json_schema.yaml" ] || [ ! -f "$FIXTURE_DIR/schema.prisma" ]; then
  echo "chart-decimal-gate fixture check: fixture files not found under $FIXTURE_DIR" >&2
  exit 1
fi

echo "== chart-decimal-gate fixture check =="
t0=$(date +%s.%N)

rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR/prisma" "$OUT_DIR/lib"
cp "$FIXTURE_DIR/schema.prisma" "$OUT_DIR/prisma/schema.prisma"

echo "-- build_user_schema.py (Stage 4 -> intermediate) --"
python3 code_generator/build_user_schema.py \
  "$FIXTURE_DIR/json_schema.yaml" \
  "$OUT_DIR/prisma/schema.prisma" \
  --out "$OUT_DIR/generated_json_schema.yaml"

echo "-- generate.py (intermediate -> TS) --"
python3 code_generator/generate.py "$OUT_DIR/generated_json_schema.yaml" "$OUT_DIR"

echo "-- prisma generate (fixture-only client, isolated output) --"
npx prisma generate --schema="$OUT_DIR/prisma/schema.prisma" >/tmp/chart_decimal_gate_prisma_generate.log 2>&1 \
  || { cat /tmp/chart_decimal_gate_prisma_generate.log >&2; exit 1; }

# Fixture-only shims for stable, entity-independent shared libs that the
# generated files import. These are NOT copies of the real files' bodies --
# they re-declare just the public type/function signatures (see comments in
# each file) so this gate only ever asserts against the chart-getters.ts/
# chart/page.tsx call sites, never re-derives the real files' own
# correctness (that is covered by the main repo's own test:e2e:build/tsc
# gate already). See fixtures/chart_decimal_gate/shims/ for the source of
# truth. `@/components/_standard/GanttChart` resolves through this
# tsconfig's `@/*` fallback straight to the real repo-root component (the
# same fallback decimal_gate's FormUpsert.tsx already relies on) -- not
# shimmed, since it is a genuinely shared, entity-independent component.
cp "$FIXTURE_DIR/shims/prisma.ts" "$OUT_DIR/lib/prisma.ts"
cp "$FIXTURE_DIR/shims/authz.ts" "$OUT_DIR/lib/authz.ts"
cp "$FIXTURE_DIR/tsconfig.json" "$OUT_DIR/tsconfig.json"

echo "-- tsc --noEmit (chart-getters.ts + chart/page.tsx) --"
set +e
npx tsc -p "$OUT_DIR/tsconfig.json"
tsc_status=$?
set -e

t1=$(date +%s.%N)
elapsed=$(echo "$t1 - $t0" | bc)
echo "== chart-decimal-gate fixture check: $(printf '%.1f' "$elapsed")s, tsc exit=$tsc_status =="

if [ "$tsc_status" -ne 0 ]; then
  echo "chart-decimal-gate fixture check FAILED -- get{Parent}sForChart" >&2
  echo "(chart_getters.ts.jinja2) no longer stringifies a required Decimal" >&2
  echo "column before assigning it into the generated (Decimal-as-string)" >&2
  echo "{Parent}ForChart interface." >&2
  exit "$tsc_status"
fi

exit 0
