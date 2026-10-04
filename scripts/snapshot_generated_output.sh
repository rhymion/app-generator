#!/bin/bash
# Snapshot the code generator's output tree for a schema, so the output of two
# generator revisions can be diffed (`diff -ru <snapshot A> <snapshot B>`).
#
# Usage: bash scripts/snapshot_generated_output.sh <src_tree> <out_dir> [fixture_dir]
#   src_tree     a checkout of the generator revision to measure (it is only read)
#   out_dir      must not exist; receives the generated tree (node_modules and .git
#                excluded) plus MANIFEST.sha256 (one hash per file)
#   fixture_dir  optional fixture (json_schema.yaml, schema_additions.prisma,
#                schema_relations.json) merged into the default schema first, using
#                scripts/compose_child_datagrid_e2e_fixture.py from THIS checkout
#
# The default schema is generated the same way `npm run generate-code` does
# (build_user_schema.py, then generate.py). Nothing in src_tree is modified.

set -euo pipefail

if [ "$#" -lt 2 ] || [ "$#" -gt 3 ]; then
  sed -n '2,15p' "$0" >&2
  exit 2
fi

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$(cd "$1" && pwd)"
OUT="$2"
FIXTURE="${3:-}"

if [ -e "$OUT" ]; then
  echo "snapshot: $OUT already exists" >&2
  exit 1
fi
mkdir -p "$OUT"

(cd "$SRC" && git ls-files -z --cached --others --exclude-standard) \
  | tar -C "$SRC" --null --ignore-failed-read -T - -cf - 2>/dev/null \
  | tar -xf - -C "$OUT"

if [ -n "$FIXTURE" ]; then
  python3 "$HERE/scripts/compose_child_datagrid_e2e_fixture.py" "$(cd "$FIXTURE" && pwd)" "$OUT"
fi

(
  cd "$OUT"
  python3 code_generator/build_user_schema.py code_generator/json_schema.yaml prisma/schema.prisma \
    --out code_generator/.generated/json_schema.yaml
  python3 code_generator/generate.py code_generator/.generated/json_schema.yaml ./
  find . -type f -not -path './.git/*' -not -path './node_modules/*' -not -path './code_generator/__pycache__/*' -print0 \
    | sort -z | xargs -0 sha256sum > MANIFEST.sha256
)
echo "snapshot: $(wc -l < "$OUT/MANIFEST.sha256") files, manifest at $OUT/MANIFEST.sha256"
