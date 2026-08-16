#!/usr/bin/env bash
# Vercel project teardown for consumer apps generated from this repo
# (app-generator). Canonical copy — consumer repos reference this file via
# their app-generator submodule rather than keeping their own duplicate
# (cmd_711).
# Removes all env vars injected by
# vercel-env.sh (production + preview) and unlinks the local Vercel project.
#
# Usage:
#   ./scripts/vercel-teardown.sh
#   DRY_RUN=true ./scripts/vercel-teardown.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
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

_VARS=(PRISMA_DATABASE_URL AUTH_SECRET REDIS_URL GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET AUTH_TRUST_HOST USE_NEON_ADAPTER NODE_ENV)

echo ""
echo "================================================================="
echo "  Vercel Project Teardown Script"
echo "================================================================="
echo "  Target project: ${VERCEL_PROJECT_NAME}"
echo "================================================================="
echo ""

# ─── Safety Guard: deletion confirmation (yes/no, twice) ─────────────────────
if [[ "$DRY_RUN" != "true" ]]; then
  read -rp "Are you sure you want to remove all Vercel env vars for '${VERCEL_PROJECT_NAME}'? (yes/no): " confirm
  if [[ "${confirm}" != "yes" ]]; then
    echo "Cancelled. Exiting."
    exit 0
  fi
  read -rp "Enter the Vercel project name to confirm: " confirm_name
  if [[ "${confirm_name}" != "${VERCEL_PROJECT_NAME}" ]]; then
    echo "ERROR: Input does not match. Aborting."
    exit 1
  fi
else
  echo "[DRY-RUN] Skipping interactive confirmation prompts."
fi

# ─── Remove env vars per environment ──────────────────────────────────────────
for target in production preview; do
  echo ""
  echo "[Removing env vars: target=${target}]"
  for name in "${_VARS[@]}"; do
    if [[ "$DRY_RUN" == "true" ]]; then
      echo "[DRY-RUN] vercel env rm ${name} ${target} --yes"
    else
      vercel env rm "$name" "$target" --yes 2>/dev/null || echo "  [SKIP] ${name} (${target}): not found"
    fi
  done
done

# ─── Unlink ────────────────────────────────────────────────────────────────────
echo ""
echo "[Unlinking Vercel project]"
run vercel unlink

echo ""
echo "================================================================="
echo "  Vercel teardown complete"
echo "================================================================="
echo ""
echo "[Manual action required]"
echo "  1. Delete the Vercel project from the dashboard (or via Vercel API) if no longer needed."
echo "  2. Delete the Prisma Postgres databases (prod + staging) from https://console.prisma.io"
echo "     (Safe to leave if no billing is incurred.)"
echo ""
