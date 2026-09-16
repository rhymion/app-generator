#!/bin/bash
# Mention-gate plain-image fixture check (cmd_803).
#
# Sibling of check_mention_gate_fixture.sh: runs the same commentable +
# comment + x-mention:true shape through build_user_schema.py -> generate.py
# -> tsc, except this fixture's `user.image` stays a plain `format: uri`
# string column instead of a direct-attachment FK (`image_id`). The original
# mention_gate fixture's `user.image_id` is FK-shaped, so it only ever
# type-checked one of the two Prisma select shapes build_context.py's
# comment/mention creator avatar select can produce
# (`image: { select: { path: true } } }` vs plain `image: true`) -- a
# consumer schema that declares `x-mention: true` while never having adopted
# the FK shape for `user.image` is equally valid and was, until this fixture
# existed, never exercised by this repo's own gates. See
# docs/knowledge/schema-yaml-configuration.md "user.image and the
# comment/mention creator avatar" for the full writeup.
#
# Usage: bash scripts/check_mention_gate_plain_image_fixture.sh
# Exit code: 0 = pass, non-zero = fail (schema/generation error or a real
# tsc type error).

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

FIXTURE_DIR="code_generator/tests/fixtures/mention_gate_plain_image"
OUT_DIR="$REPO_ROOT/.generated-mention-gate-plain-image"

if [ ! -f "$FIXTURE_DIR/json_schema.yaml" ] || [ ! -f "$FIXTURE_DIR/schema.prisma" ]; then
  echo "mention-gate-plain-image fixture check: fixture files not found under $FIXTURE_DIR" >&2
  exit 1
fi

echo "== mention-gate-plain-image fixture check =="
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
npx prisma generate --schema="$OUT_DIR/prisma/schema.prisma" >/tmp/mention_gate_plain_image_prisma_generate.log 2>&1 \
  || { cat /tmp/mention_gate_plain_image_prisma_generate.log >&2; exit 1; }

# Fixture-only shims -- see check_mention_gate_fixture.sh's equivalent
# comment for why these are re-declared signatures, not real file copies.
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
echo "== mention-gate-plain-image fixture check: $(printf '%.1f' "$elapsed")s, tsc exit=$tsc_status =="

if [ "$tsc_status" -ne 0 ]; then
  echo "mention-gate-plain-image fixture check FAILED — a consumer schema" >&2
  echo "with x-mention:true and a plain-string user.image column no longer" >&2
  echo "type-checks. See docs/knowledge/schema-yaml-configuration.md" >&2
  echo "'user.image and the comment/mention creator avatar'." >&2
  exit "$tsc_status"
fi

exit 0
