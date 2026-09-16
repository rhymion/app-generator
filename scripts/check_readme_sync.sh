#!/bin/bash
# Fail-closed gate: if a branch's diff touches README.md relative to its
# base, README_ja.md must be touched too (and vice versa). One language
# changing without the other has previously landed on develop unnoticed,
# with the missing translation only caught and added by hand after merge.
#
# This only proves BOTH files were touched, not that their content actually
# agrees -- content parity is not machine-checkable and is instead a task
# completion step (bring the other language's README up to date before
# finishing any task that edits README.md or README_ja.md). Deliberately
# local-only, with no CI dependency.
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT" || { echo "not inside a git work tree -- failing closed" >&2; exit 1; }

BASE_REF="${1:-origin/develop}"

if ! git rev-parse --verify --quiet "${BASE_REF}^{commit}" >/dev/null; then
  echo "check_readme_sync: base ref '$BASE_REF' not found locally." >&2
  echo "Run 'git fetch origin' first, or pass an explicit base: bash scripts/check_readme_sync.sh <ref>" >&2
  exit 1
fi

MERGE_BASE="$(git merge-base HEAD "$BASE_REF")"

readme_changed=0
readme_ja_changed=0

git diff --quiet "$MERGE_BASE" -- README.md || readme_changed=1
git diff --quiet "$MERGE_BASE" -- README_ja.md || readme_ja_changed=1

if [ "$readme_changed" -ne "$readme_ja_changed" ]; then
  echo "check_readme_sync FAILED: README.md and README_ja.md are not both touched relative to $BASE_REF." >&2
  if [ "$readme_changed" -eq 1 ]; then
    echo "  README.md differs, README_ja.md does not." >&2
  else
    echo "  README_ja.md differs, README.md does not." >&2
  fi
  echo "  Bring the other language's README up to date before completing this task." >&2
  exit 1
fi

echo "check_readme_sync: OK (README.md/README_ja.md diff status against $BASE_REF matches: changed=$readme_changed)"
