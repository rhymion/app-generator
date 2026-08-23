#!/bin/bash
# Uri-kind-gate fixture check (cmd_792).
#
# Runs a small, self-contained fixture parent/child pair (uri_kind_gate_wrapper
# / uri_kind_gate_item) through the real build_user_schema.py -> generate.py
# -> tsc pipeline and type-checks the two generated files that carry the
# uri-kind-specific branches this repo's own json_schema.yaml never compiles:
# app/uri_kind_gate_wrapper/page.tsx (page_list_context's list-page
# ResponsiveListClient/DataGridClient uriKind wiring, cmd_792 path (ii)) and
# components/uri_kind_gate_wrapper/column_def.tsx (column_def_context's
# editable child DataGrid, cmd_792 path (iii), which has no uri/image branch
# at all -- both uri kinds fall through to a plain editable text cell, a
# deliberate cmd_792 decision, not an oversight).
#
# Why this exists: this repo's own json_schema.yaml has two format:uri
# fields (user.image, attachment.path), but neither is ever listed in an
# x-display.table column set nor embedded as a one-to-many child's column,
# so test:e2e:build's own tsc pass never compiles either branch. Mirrors
# scripts/check_decimal_gate_fixture.sh's structure and rationale.
#
# Usage: bash scripts/check_uri_kind_gate_fixture.sh
# Exit code: 0 = pass, non-zero = fail (schema/generation error or a real
# tsc type error).

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

FIXTURE_DIR="code_generator/tests/fixtures/uri_kind_gate"
OUT_DIR="$REPO_ROOT/.generated-uri-kind-gate"

if [ ! -f "$FIXTURE_DIR/json_schema.yaml" ] || [ ! -f "$FIXTURE_DIR/schema.prisma" ]; then
  echo "uri-kind-gate fixture check: fixture files not found under $FIXTURE_DIR" >&2
  exit 1
fi

echo "== uri-kind-gate fixture check =="
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
npx prisma generate --schema="$OUT_DIR/prisma/schema.prisma" >/tmp/uri_kind_gate_prisma_generate.log 2>&1 \
  || { cat /tmp/uri_kind_gate_prisma_generate.log >&2; exit 1; }

# Fixture-only shims for stable, entity-independent shared libs that the
# generated files import -- see fixtures/uri_kind_gate/shims/ for the source
# of truth and why these exist rather than the real files.
cp "$FIXTURE_DIR/shims/prisma.ts" "$OUT_DIR/lib/prisma.ts"
cp "$FIXTURE_DIR/shims/authz.ts" "$OUT_DIR/lib/authz.ts"
cp "$FIXTURE_DIR/shims/api-auth.ts" "$OUT_DIR/lib/api-auth.ts"
cp "$FIXTURE_DIR/tsconfig.json" "$OUT_DIR/tsconfig.json"

echo "-- tsc --noEmit (page.tsx + column_def.tsx + getters.ts) --"
set +e
npx tsc -p "$OUT_DIR/tsconfig.json"
tsc_status=$?
set -e

t1=$(date +%s.%N)
elapsed=$(echo "$t1 - $t0" | bc)
echo "== uri-kind-gate fixture check: $(printf '%.1f' "$elapsed")s, tsc exit=$tsc_status =="

if [ "$tsc_status" -ne 0 ]; then
  echo "uri-kind-gate fixture check FAILED -- the list-page or editable" >&2
  echo "child-DataGrid uri-kind branch (see scripts/check_uri_kind_gate_fixture.sh" >&2
  echo "header for the list) no longer type-checks." >&2
  exit "$tsc_status"
fi

exit 0
