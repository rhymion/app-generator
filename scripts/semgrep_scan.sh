#!/usr/bin/env bash
# Semgrep CE scan of the repository sources and of a freshly generated app.
#
#   bash scripts/semgrep_scan.sh [--registry] [--out-dir DIR]
#
# Always runs the project-owned rules in .semgrep/rules.yml (blocking: any
# finding fails the script). With --registry it also runs the registry packs for
# TypeScript, Next.js and the OWASP Top Ten (report-only: findings are written
# to SARIF files and never change the exit status).
#
# The generated app is built in a scratch copy of the tree, so the working tree
# is not touched. Requires: semgrep, python3 with the packages in
# requirements.txt, network access when --registry is given.
set -euo pipefail

registry=0
out_dir="${SEMGREP_OUT_DIR:-semgrep-results}"
while [ $# -gt 0 ]; do
  case "$1" in
    --registry) registry=1 ;;
    --out-dir) out_dir="$2"; shift ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
  shift
done

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
mkdir -p "$out_dir"
out_dir="$(cd "$out_dir" && pwd)"
export SEMGREP_SEND_METRICS=off

# 1. Sources: tracked files of this repository.
own_rc=0
(cd "$repo" && semgrep scan --metrics=off --config .semgrep/rules.yml --exclude .semgrep \
  --sarif --output "$out_dir/own-sources.sarif" --error .) || own_rc=$?

# 2. Generated app: generate into a scratch copy (no .git, so semgrep scans every
#    file it can read rather than only tracked ones).
scratch="$(mktemp -d)"
trap 'rm -rf "$scratch"' EXIT
tar -C "$repo" --exclude=.git --exclude=node_modules --exclude=.next -cf - . | tar -C "$scratch" -xf -
(cd "$scratch" && npm run --silent generate-code >"$out_dir/generate-code.log" 2>&1)
gen_rc=0
(cd "$scratch" && semgrep scan --metrics=off --config .semgrep/rules.yml --exclude .semgrep \
  --sarif --output "$out_dir/own-generated.sarif" --error .) || gen_rc=$?

# 3. Registry packs, report-only.
if [ "$registry" = 1 ]; then
  packs=(--config p/typescript --config p/nextjs --config p/owasp-top-ten)
  (cd "$repo" && semgrep scan --metrics=off "${packs[@]}" --exclude .semgrep \
    --sarif --output "$out_dir/registry-sources.sarif" .) || echo "registry scan of sources did not complete (report-only)" >&2
  (cd "$scratch" && semgrep scan --metrics=off "${packs[@]}" --exclude .semgrep \
    --sarif --output "$out_dir/registry-generated.sarif" .) || echo "registry scan of the generated app did not complete (report-only)" >&2
fi

if [ "$own_rc" != 0 ] || [ "$gen_rc" != 0 ]; then
  echo "project-owned Semgrep rules reported findings (sources rc=$own_rc, generated rc=$gen_rc)" >&2
  exit 1
fi
echo "project-owned Semgrep rules: no findings. Results in $out_dir"
