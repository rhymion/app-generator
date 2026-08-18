#!/bin/bash
# Required one-to-one selector fixture check (cmd_704 [2-a]).
#
# Runs a small, self-contained fixture entity pair (oto_gate_target, a
# selector target with its own pages, and oto_gate_item, whose FK to it is
# REQUIRED -- `type: one-to-one`, non-nullable) through the real
# build_user_schema.py -> generate.py -> tsc pipeline and type-checks the
# generated page_new.tsx (the file with the guard-block branch cmd_704
# fixed) plus getters.ts.
#
# Why this exists: this repo's own json_schema.yaml has zero entities with a
# required (non-nullable) one-to-one selector FK -- so `test:e2e:cy:api`'s
# mandatory gate (this repo's own generated output) never compiles this
# branch, and neither does any of the known consumer schemas (proj_c,
# inventory-app). The only currently-known live instance is the external
# consumer repo menlab-auto (pre_check.checkup_id / checkup_result.checkup_id),
# which happens to be pinned to a pre-defect generator commit -- "no consumer
# has hit this yet" is not the same as "this branch is safe," and without
# this fixture a regression here would pass every mandatory gate green
# (memory `silent-noop-defects-invisible-to-green-gates`). See
# docs/knowledge/mention-system.md "Fixture gate: how to grow it" for the
# general pattern this follows (adapted into a standalone fixture rather than
# folded into mention_gate -- see this fixture's own json_schema.yaml header
# for why).
#
# Scope (deliberately narrow): only the `required_relation_fields` /
# `selector_oto_rels` split in build_context.py and the `{{ f.init_var }}`
# reference in page_new.tsx.jinja2 it drives (cmd_704 [2-a]: the template
# used to always rebuild `initial{Target}s` from `target`, which is correct
# for parent_rels_raw but wrong for selector_oto_rels, which destructures as
# `initialAvailable{Target}s`). It does NOT cover page_edit.tsx (required OTO
# selectors render differently there -- no permission-denied guard block) or
# any other of this repo's many other `{% if %}` branches.
#
# Usage: bash scripts/check_oto_mandatory_gate_fixture.sh
# Exit code: 0 = pass, non-zero = fail (schema/generation error or a real
# tsc type error -- e.g. the `Cannot find name` failure this gate exists to
# catch).

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

FIXTURE_DIR="code_generator/tests/fixtures/oto_mandatory"
OUT_DIR="$REPO_ROOT/.generated-oto-mandatory-gate"

if [ ! -f "$FIXTURE_DIR/json_schema.yaml" ] || [ ! -f "$FIXTURE_DIR/schema.prisma" ]; then
  echo "oto-mandatory-gate fixture check: fixture files not found under $FIXTURE_DIR" >&2
  exit 1
fi

echo "== oto-mandatory-gate fixture check =="
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
npx prisma generate --schema="$OUT_DIR/prisma/schema.prisma" >/tmp/oto_mandatory_gate_prisma_generate.log 2>&1 \
  || { cat /tmp/oto_mandatory_gate_prisma_generate.log >&2; exit 1; }

# Fixture-only shims for stable, entity-independent shared libs that the
# generated files import. These are NOT copies of the real files' bodies --
# they re-declare just the public type/function signatures (see comments in
# each file) so this gate only ever asserts against the page_new.tsx/
# getters.ts call sites, never re-derives the real files' own correctness
# (that is covered by the main repo's own test:e2e:build/tsc gate already).
# Written fresh on every run so they can't silently drift from what's
# checked in -- see fixtures/oto_mandatory/shims/ for the source of truth.
cp "$FIXTURE_DIR/shims/prisma.ts" "$OUT_DIR/lib/prisma.ts"
cp "$FIXTURE_DIR/shims/authz.ts" "$OUT_DIR/lib/authz.ts"
cp "$FIXTURE_DIR/tsconfig.json" "$OUT_DIR/tsconfig.json"

echo "-- tsc --noEmit (page_new.tsx + getters.ts only) --"
set +e
npx tsc -p "$OUT_DIR/tsconfig.json"
tsc_status=$?
set -e

t1=$(date +%s.%N)
elapsed=$(echo "$t1 - $t0" | bc)
echo "== oto-mandatory-gate fixture check: $(printf '%.1f' "$elapsed")s, tsc exit=$tsc_status =="

if [ "$tsc_status" -ne 0 ]; then
  echo "oto-mandatory-gate fixture check FAILED — the required_relation_fields/" >&2
  echo "selector_oto_rels split in build_context.py / the {{ f.init_var }}" >&2
  echo "reference in page_new.tsx.jinja2 no longer produces a name that" >&2
  echo "actually exists in the destructured Promise.all result (cmd_704 [2-a])." >&2
  exit "$tsc_status"
fi

exit 0
