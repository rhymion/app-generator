#!/bin/bash
# Chart-scalar-gate fixture check.
#
# Runs a small, self-contained fixture entity pair (chart_scalar_gate_row,
# the chart's row_by target, and chart_scalar_gate_item, which declares
# x-display.chart and carries a REQUIRED plain Int column, two REQUIRED
# DateTime columns other than start_time/end_time (one `format: date-time`,
# one `format: date`), and a REQUIRED Boolean column) through the real
# build_user_schema.py -> generate.py -> tsc pipeline, type-checks the
# generated chart-getters.ts and chart/page.tsx, and greps the generated
# interface to prove the excluded columns are actually absent (a green tsc
# run alone does not prove a column was dropped -- it would also pass if
# the column were silently kept and correctly typed).
#
# Why this exists: chart_context() (generators.py) used to silently drop a
# required plain Int/Float column from the chart projection entirely (no
# tooltip, no interface field, and no documented reason -- an asymmetry
# with a string column, which was projected), and separately assigned a
# required DateTime column straight off the raw Prisma row into a field
# the generated {Parent}ForChart interface types as `string` -- the same
# "raw Prisma value into a field typed `string`" TS2322 class PR#389 fixed
# for Decimal, just for a different type. That serialize-in-place fix
# (PR#390) only checked `format == 'date-time'`, so a required
# `format: date` column fell through to the plain-string branch and kept
# the exact same raw-Date-into-`string`-field bug -- never caught because
# no fixture combined x-display.chart with a `format: date` column. The
# generator now excludes every DateTime column (date-time/date/time alike)
# from the chart projection entirely: correct display needs client-side
# formatting (out of scope here), and start_field/end_field already carry
# the chart's time information. This fixture also carries a required
# Boolean column to prove it is deliberately excluded from the projection
# (no interface field, no tooltip reference) rather than silently
# type-checking into something wrong.
#
# Distinct from chart_decimal_gate (code_generator/tests/fixtures/
# chart_decimal_gate/), which exercises the chart's required-Decimal-column
# branch specifically (PR#389) -- this fixture exercises the other scalar
# branches chart_context() resolves and does not extend that fixture, to
# keep this fixture's build/type-check independent of chart_decimal_gate's
# own scope and history.
#
# Usage: bash scripts/check_chart_scalar_gate_fixture.sh
# Exit code: 0 = pass, non-zero = fail (schema/generation error or a real
# tsc type error).

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

FIXTURE_DIR="code_generator/tests/fixtures/chart_scalar_gate"
OUT_DIR="$REPO_ROOT/.generated-chart-scalar-gate"

if [ ! -f "$FIXTURE_DIR/json_schema.yaml" ] || [ ! -f "$FIXTURE_DIR/schema.prisma" ]; then
  echo "chart-scalar-gate fixture check: fixture files not found under $FIXTURE_DIR" >&2
  exit 1
fi

echo "== chart-scalar-gate fixture check =="
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
npx prisma generate --schema="$OUT_DIR/prisma/schema.prisma" >/tmp/chart_scalar_gate_prisma_generate.log 2>&1 \
  || { cat /tmp/chart_scalar_gate_prisma_generate.log >&2; exit 1; }

# Fixture-only shims for stable, entity-independent shared libs that the
# generated files import. These are NOT copies of the real files' bodies --
# they re-declare just the public type/function signatures so this gate
# only ever asserts against the chart-getters.ts/chart/page.tsx call
# sites, never re-derives the real files' own correctness (that is
# covered by the main repo's own test:e2e:build/tsc gate already). See
# fixtures/chart_scalar_gate/shims/ for the source of truth.
# `@/components/_standard/GanttChart` resolves through this tsconfig's
# `@/*` fallback straight to the real repo-root component (the same
# fallback chart_decimal_gate's tsconfig relies on) -- not shimmed, since
# it is a genuinely shared, entity-independent component.
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
echo "== chart-scalar-gate fixture check: $(printf '%.1f' "$elapsed")s, tsc exit=$tsc_status =="

if [ "$tsc_status" -ne 0 ]; then
  echo "chart-scalar-gate fixture check FAILED -- get{Parent}sForChart" >&2
  echo "(chart_getters.ts.jinja2) no longer handles a required Int/DateTime" >&2
  echo "column correctly in the generated {Parent}ForChart interface." >&2
  exit "$tsc_status"
fi

echo "-- asserting excluded columns are actually absent from the generated interface --"
GETTERS_FILE="$OUT_DIR/lib/chart_scalar_gate_item/chart-getters.ts"
if [ ! -f "$GETTERS_FILE" ]; then
  echo "chart-scalar-gate fixture check FAILED -- expected generated file not found: $GETTERS_FILE" >&2
  exit 1
fi
# A green tsc run alone does not prove logged_at/logged_date/is_flagged were
# dropped from the projection -- it would pass just as well if they were
# kept and correctly typed. Grep the generated output directly.
if grep -qE '\blogged_at\b|\blogged_date\b|\bis_flagged\b' "$GETTERS_FILE"; then
  echo "chart-scalar-gate fixture check FAILED -- $GETTERS_FILE still" >&2
  echo "references logged_at/logged_date/is_flagged; these must be" >&2
  echo "excluded from the chart projection entirely (DateTime regardless" >&2
  echo "of format, and Boolean)." >&2
  exit 1
fi
if ! grep -q 'item_count' "$GETTERS_FILE"; then
  echo "chart-scalar-gate fixture check FAILED -- $GETTERS_FILE does not" >&2
  echo "project the required plain Int column (item_count)." >&2
  exit 1
fi

exit 0
