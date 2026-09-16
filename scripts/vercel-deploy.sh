#!/usr/bin/env bash
# Vercel CLI deploy for consumer apps generated from this repo (app-generator).
# Canonical copy — consumer repos reference this file via their app-generator
# submodule rather than keeping their own duplicate (cmd_711).
# Verifies the app-generator submodule is
# checked out BEFORE invoking `vercel deploy` (FS-1 — see
# docs/vercel-automation-design.md §2): .gitmodules is in Vercel CLI's
# ignored-files list, but the submodule directory CONTENTS are uploaded as
# regular files, so they must exist locally and be current before the CLI
# takes its upload snapshot.
#
# Usage:
#   ./scripts/vercel-deploy.sh              # preview deploy
#   ./scripts/vercel-deploy.sh --prod       # production deploy
#   DRY_RUN=true ./scripts/vercel-deploy.sh --prod
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/vercel-env.sh"

DRY_RUN="${DRY_RUN:-false}"

run() {
  if [[ "$DRY_RUN" == "true" ]]; then
    echo "[DRY-RUN] $*"
  else
    "$@"
  fi
}

echo ""
echo "================================================================="
echo "  Vercel CLI deploy: project=${VERCEL_PROJECT_NAME}"
echo "================================================================="
[[ "$DRY_RUN" == "true" ]] && echo "[DRY-RUN mode — write commands echoed, not executed]"
echo ""

# ── Step 1: Ensure submodule is checked out ─────────────────────────────────
echo "[Step 1] git submodule update --init --recursive..."
run git -C "${ROOT}" submodule update --init --recursive

# ── Step 2: Verify submodule checkout ───────────────────────────────────────
echo ""
echo "[Step 2] Verifying submodule checkout..."
if [[ "$DRY_RUN" != "true" ]]; then
  test -d "${ROOT}/app-generator/app" || { echo "ERROR: app-generator/app not found — submodule checkout failed." >&2; exit 1; }
else
  echo "[DRY-RUN] test -d ${ROOT}/app-generator/app"
fi
echo "  OK: submodule present."

# ── Step 3: Deploy ───────────────────────────────────────────────────────────
echo ""
echo "[Step 3] vercel deploy..."
_DEPLOY_ARGS=(deploy)
[[ "${1:-}" == "--prod" ]] && _DEPLOY_ARGS+=(--prod)
run vercel "${_DEPLOY_ARGS[@]}"

echo ""
echo "================================================================="
echo "  Deploy complete"
echo "================================================================="
echo ""
