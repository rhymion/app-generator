#!/bin/bash
# Direct-attachment FK fixture check (cmd_788).
#
# Runs a small, self-contained fixture entity (direct_attachment_gate_item,
# with a nullable and a REQUIRED x-relationship: { target: attachment, type:
# direct } FK field) through the real build_user_schema.py -> generate.py ->
# tsc pipeline and type-checks the generated new/edit page (FormUpsert.tsx's
# SingleAttachmentUpload interactive widget), view page (FormView.tsx's
# SingleAttachmentDisplay readonly rendering), and getters.ts (the
# decrypt/strip pass for encrypted_original_name/name_iv -- the
# direct-attachment analogue of the existing has_attachable treatment).
#
# Why this exists: this repo's own json_schema.yaml declares zero fields
# with x-relationship.type: direct (the feature is brand new, cmd_788), so
# test:e2e:build (this repo's own generate-code + tsc build) never compiles
# any of these branches, and neither does any currently known consumer
# schema. Without this fixture a regression here would pass every mandatory
# gate green. See docs/knowledge/mention-system.md "Fixture gate: how to
# grow it" for the general pattern this follows.
#
# Scope (deliberately narrow): FormUpsert.tsx / FormView.tsx / getters.ts /
# types.ts's direct-attachment branches only. It does NOT cover DataGrid
# child-cell rendering of a direct-attachment field (an open design question
# tracked separately -- see this task's own report for the coordination
# note) or the x-uri-kind: file branch (covered by... TODO if a separate
# file_uri fixture is added later; SingleAttachmentUpload/
# SingleAttachmentDisplay's mode='url' path is exercised transitively by
# this fixture's mode='fk' path importing the same two components, but not
# type-checked against a mode='url' call site specifically).
#
# Usage: bash scripts/check_direct_attachment_gate_fixture.sh
# Exit code: 0 = pass, non-zero = fail (schema/generation error or a real
# tsc type error).

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

FIXTURE_DIR="code_generator/tests/fixtures/direct_attachment_gate"
OUT_DIR="$REPO_ROOT/.generated-direct-attachment-gate"

if [ ! -f "$FIXTURE_DIR/json_schema.yaml" ] || [ ! -f "$FIXTURE_DIR/schema.prisma" ]; then
  echo "direct-attachment-gate fixture check: fixture files not found under $FIXTURE_DIR" >&2
  exit 1
fi

echo "== direct-attachment-gate fixture check =="
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
npx prisma generate --schema="$OUT_DIR/prisma/schema.prisma" >/tmp/direct_attachment_gate_prisma_generate.log 2>&1 \
  || { cat /tmp/direct_attachment_gate_prisma_generate.log >&2; exit 1; }

# Fixture-only shims for stable, entity-independent shared libs that the
# generated files import. See fixtures/direct_attachment_gate/shims/ for the
# source of truth. lib/attachment/direct_actions.ts is NOT shimmed --
# generate.py always emits it (unconditionally, like bridge_actions.ts), so
# this run's own output at $OUT_DIR/lib/attachment/direct_actions.ts is the
# real thing the fixture's tsconfig.json paths entry points at.
cp "$FIXTURE_DIR/shims/prisma.ts" "$OUT_DIR/lib/prisma.ts"
cp "$FIXTURE_DIR/shims/authz.ts" "$OUT_DIR/lib/authz.ts"
cp "$FIXTURE_DIR/tsconfig.json" "$OUT_DIR/tsconfig.json"

echo "-- tsc --noEmit (new/edit/view pages + getters.ts) --"
set +e
npx tsc -p "$OUT_DIR/tsconfig.json"
tsc_status=$?
set -e

t1=$(date +%s.%N)
elapsed=$(echo "$t1 - $t0" | bc)
echo "== direct-attachment-gate fixture check: $(printf '%.1f' "$elapsed")s, tsc exit=$tsc_status =="

if [ "$tsc_status" -ne 0 ]; then
  echo "direct-attachment-gate fixture check FAILED — the x-relationship" >&2
  echo "type:direct branch (SingleAttachmentUpload/SingleAttachmentDisplay" >&2
  echo "wiring in build_context.py/generators.py/getters.ts.jinja2/" >&2
  echo "types.ts.jinja2) no longer generates code that type-checks (cmd_788)." >&2
  exit "$tsc_status"
fi

exit 0
