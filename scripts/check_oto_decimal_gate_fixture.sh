#!/bin/bash
# OTO-selector Decimal-gate fixture check (cmd_754[2]).
#
# Runs a small, self-contained fixture entity pair (oto_decimal_gate_target,
# a one-to-one selector target carrying a Decimal column, and
# oto_decimal_gate_item, whose FK to it is a nullable `type: one-to-one`
# selector) through the real build_user_schema.py -> generate.py -> tsc
# pipeline and type-checks the generated page_new.tsx / page_edit.tsx (the
# files that pass `getAvailable{Target}sFor{Parent}`'s return value straight
# to FormUpsert as `initialAvailable{Target}s`) plus both entities'
# getters.ts.
#
# Why this exists: `getAvailable{Target}sFor{Parent}` (getters.ts.jinja2)
# used to return raw `prisma.{target}.findMany(...)` rows unconditionally --
# unlike search{Parent}Options (decimal_display_columns .toString()
# override) and relationship_mapping (deepStringifyDecimals wrap for an
# embedded relation), it never stringified the target's own Decimal
# columns. A one-to-one selector whose target carries a Decimal column hit
# TS2322 at build time (the generated FormUpsert prop type expects Decimal
# as string) -- discovered by a real end-to-end schema-generation run
# against develop (cmd_754, defect 2, 2026-08-19). Neither decimal_gate
# (own-column/m2o-embed serialization) nor oto_mandatory (required-selector
# init-var naming, an unrelated branch) compiles this specific
# getAvailable... code path, and this repo's own json_schema.yaml has no
# one-to-one selector FK at all, so test:e2e:build never compiles it
# either.
#
# Usage: bash scripts/check_oto_decimal_gate_fixture.sh
# Exit code: 0 = pass, non-zero = fail (schema/generation error or a real
# tsc type error -- e.g. the TS2322 failure this gate exists to catch).

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

FIXTURE_DIR="code_generator/tests/fixtures/oto_decimal_gate"
OUT_DIR="$REPO_ROOT/.generated-oto-decimal-gate"

if [ ! -f "$FIXTURE_DIR/json_schema.yaml" ] || [ ! -f "$FIXTURE_DIR/schema.prisma" ]; then
  echo "oto-decimal-gate fixture check: fixture files not found under $FIXTURE_DIR" >&2
  exit 1
fi

echo "== oto-decimal-gate fixture check =="
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
npx prisma generate --schema="$OUT_DIR/prisma/schema.prisma" >/tmp/oto_decimal_gate_prisma_generate.log 2>&1 \
  || { cat /tmp/oto_decimal_gate_prisma_generate.log >&2; exit 1; }

# Fixture-only shims for stable, entity-independent shared libs that the
# generated files import. These are NOT copies of the real files' bodies --
# they re-declare just the public type/function signatures (see comments in
# each file) so this gate only ever asserts against the page_new.tsx/
# page_edit.tsx/getters.ts call sites, never re-derives the real files' own
# correctness (that is covered by the main repo's own test:e2e:build/tsc
# gate already). See fixtures/oto_decimal_gate/shims/ for the source of
# truth.
cp "$FIXTURE_DIR/shims/prisma.ts" "$OUT_DIR/lib/prisma.ts"
cp "$FIXTURE_DIR/shims/authz.ts" "$OUT_DIR/lib/authz.ts"
cp "$FIXTURE_DIR/tsconfig.json" "$OUT_DIR/tsconfig.json"

echo "-- tsc --noEmit (page_new.tsx + page_edit.tsx + getters.ts) --"
set +e
npx tsc -p "$OUT_DIR/tsconfig.json"
tsc_status=$?
set -e

t1=$(date +%s.%N)
elapsed=$(echo "$t1 - $t0" | bc)
echo "== oto-decimal-gate fixture check: $(printf '%.1f' "$elapsed")s, tsc exit=$tsc_status =="

if [ "$tsc_status" -ne 0 ]; then
  echo "oto-decimal-gate fixture check FAILED -- a one-to-one selector's" >&2
  echo "getAvailable{Target}sFor{Parent} getter (getters.ts.jinja2) no" >&2
  echo "longer stringifies the target entity's Decimal columns before" >&2
  echo "handing rows to a Client Component prop typed against the" >&2
  echo "generated (Decimal-as-string) interface." >&2
  exit "$tsc_status"
fi

exit 0
