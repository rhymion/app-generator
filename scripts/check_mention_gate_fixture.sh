#!/bin/bash
# Mention-gate fixture check (cmd_535, following on cmd_532).
#
# Runs a small, self-contained fixture entity (commentable + comment +
# x-mention: true) through the real build_user_schema.py -> generate.py
# pipeline and type-checks the two generated files that carry the
# `named_constants and has_commentable` branch (getters.ts.jinja2's
# get<Parent>DetailPageData(), api_detail_route.ts.jinja2's GET handler) --
# the exact branch cmd_532 found broken (c.creator_id read off a comment
# type that only ever declares c.creator?.id).
#
# Why this exists: this repo's own json_schema.yaml never wires an entity to
# `commentable`, so `test:e2e:build`'s tsc pass (this repo's own generated
# output) never compiles this branch -- the break only ever surfaces in a
# downstream consumer schema, late. See docs/knowledge/mention-system.md
# "cmd_532: creator include fix and gate-blind-spot confirmation" and
# "Fixture gate: how to grow it" for the full design rationale, what this
# fixture covers, and how to extend it to a new dark branch.
#
# Scope (deliberately narrow, cmd_535): only the `named_constants and
# has_commentable` branch. It does NOT cover the sibling `children_raw`
# `output_type == 'comments'` branch (a second, direct-child comment path)
# or any other of this repo's ~700 `{% if %}`/228 single-identifier-condition
# branches -- see mention-system.md for the honest accounting of what is
# still dark.
#
# Usage: bash scripts/check_mention_gate_fixture.sh
# Exit code: 0 = pass, non-zero = fail (schema/generation error or a real
# tsc type error -- e.g. the branch this gate exists to catch).

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

FIXTURE_DIR="code_generator/tests/fixtures/mention_gate"
OUT_DIR="$REPO_ROOT/.generated-mention-gate"

if [ ! -f "$FIXTURE_DIR/json_schema.yaml" ] || [ ! -f "$FIXTURE_DIR/schema.prisma" ]; then
  echo "mention-gate fixture check: fixture files not found under $FIXTURE_DIR" >&2
  exit 1
fi

echo "== mention-gate fixture check =="
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
npx prisma generate --schema="$OUT_DIR/prisma/schema.prisma" >/tmp/mention_gate_prisma_generate.log 2>&1 \
  || { cat /tmp/mention_gate_prisma_generate.log >&2; exit 1; }

# Fixture-only shims for stable, entity-independent shared libs that the
# generated files import. These are NOT copies of the real files' bodies --
# they re-declare just the public type/function signatures (see comments in
# each file) so this gate only ever asserts against the getters.ts/route.ts
# call sites, never re-derives the real files' own correctness (that is
# covered by the main repo's own test:e2e:build/tsc gate already). Written
# fresh on every run so they can't silently drift from what's checked in --
# see fixtures/mention_gate/shims/ for the source of truth.
cp "$FIXTURE_DIR/shims/prisma.ts" "$OUT_DIR/lib/prisma.ts"
cp "$FIXTURE_DIR/shims/authz.ts" "$OUT_DIR/lib/authz.ts"
cp "$FIXTURE_DIR/shims/api-auth.ts" "$OUT_DIR/lib/api-auth.ts"
cp "$FIXTURE_DIR/shims/_notifier.ts" "$OUT_DIR/lib/_notifier.ts"
mkdir -p "$OUT_DIR/lib/organization"
cp "$FIXTURE_DIR/shims/organization_getters_associated.ts" "$OUT_DIR/lib/organization/getters_associated.ts"
cp "$FIXTURE_DIR/tsconfig.json" "$OUT_DIR/tsconfig.json"

echo "-- tsc --noEmit (getters.ts + api route only) --"
set +e
npx tsc -p "$OUT_DIR/tsconfig.json"
tsc_status=$?
set -e

t1=$(date +%s.%N)
elapsed=$(echo "$t1 - $t0" | bc)
echo "== mention-gate fixture check: $(printf '%.1f' "$elapsed")s, tsc exit=$tsc_status =="

if [ "$tsc_status" -ne 0 ]; then
  echo "mention-gate fixture check FAILED — the named_constants/has_commentable" >&2
  echo "branch in getters.ts.jinja2 / api_detail_route.ts.jinja2 no longer" >&2
  echo "type-checks against the comment type declared in types.ts.jinja2." >&2
  echo "See docs/knowledge/mention-system.md 'cmd_532' section." >&2
  exit "$tsc_status"
fi

exit 0
