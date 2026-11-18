#!/usr/bin/env bash
# Read-only check of a deployed Vercel app's environment configuration (Issue #1244). Run it after each deployment
# from the linked project directory (or with VERCEL_ORG_ID / VERCEL_PROJECT_ID set).
#
#   ./scripts/vercel-verify.sh
#
# It only reads: `vercel env ls`, which lists variable names and the environments each entry applies to; values are
# not shown by the CLI and are never requested (no `vercel env pull`). It never adds or removes anything and takes
# no credentials: it uses the Vercel CLI's existing sign-in (`vercel login`). Each line is PASS/FAIL with the name of
# the variable examined; the output contains no values and is safe to paste into an Issue.
#
# Checks, by name only (a secret's value cannot be compared without reading it):
#   - the variables Production needs exist for Production;
#   - when Preview is configured at all, it has its own entries for the per-target secrets
#     (scripts/vercel-env.sh injects them from NAME_STAGING);
#   - no secret is one entry shared by Production and Preview: vercel-env.sh adds a separate entry per target, so a
#     shared entry means the two environments use the same value.
# Exit status: 0 all passed, 1 a check failed, 2 usage or setup error.
set -euo pipefail

_VERIFY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=deploy-verify-common.sh
source "${_VERIFY_DIR}/deploy-verify-common.sh"

verify_require_cli vercel 'vercel login'

PRODUCTION_REQUIRED=(DATABASE_URL DIRECT_URL AUTH_SECRET CRON_SECRET REDIS_URL)
PREVIEW_OWN=(DATABASE_URL DIRECT_URL AUTH_SECRET CRON_SECRET)
SECRETS=(DATABASE_URL DIRECT_URL AUTH_SECRET CRON_SECRET REDIS_URL BLOB_READ_WRITE_TOKEN GOOGLE_CLIENT_SECRET)

if ! listing="$(vercel env ls 2>/dev/null)"; then
  echo "ERROR: 'vercel env ls' failed; run it from the linked project directory after 'vercel login'." >&2
  exit 2
fi

# One line per entry: NAME <tab> P|- <tab> V|- (Production, Preview). Only the name column and the environment
# names are kept; the value column ("Encrypted") is dropped.
entries="$(awk '
  $1 ~ /^[A-Z][A-Z0-9_]*$/ {
    printf "%s\t%s\t%s\n", $1, ($0 ~ /Production/ ? "P" : "-"), ($0 ~ /Preview/ ? "V" : "-")
  }' <<<"$listing")"

has_target() {  # has_target NAME P|V
  awk -F'\t' -v n="$1" -v t="$2" '$1 == n && ($2 == t || $3 == t) { found = 1 } END { exit !found }' <<<"$entries"
}

for name in "${PRODUCTION_REQUIRED[@]}"; do
  if has_target "$name" P; then
    verify_pass "production ${name} present"
  else
    verify_fail "production ${name}" "missing"
  fi
done

if awk -F'\t' '$3 == "V" { found = 1 } END { exit !found }' <<<"$entries"; then
  for name in "${PREVIEW_OWN[@]}"; do
    if has_target "$name" V; then
      verify_pass "preview ${name} present"
    else
      verify_fail "preview ${name}" "missing (set ${name/DIRECT_URL/DATABASE_URL_UNPOOLED}_STAGING and run scripts/vercel-env.sh inject preview)"
    fi
  done
else
  verify_info "preview has no variables; Preview checks skipped"
fi

for name in "${SECRETS[@]}"; do
  if awk -F'\t' -v n="$name" '$1 == n && $2 == "P" && $3 == "V" { found = 1 } END { exit !found }' <<<"$entries"; then
    verify_fail "${name} shared" "one entry applies to both Production and Preview; give Preview its own value"
  elif has_target "$name" P || has_target "$name" V; then
    verify_pass "${name} not shared between Production and Preview"
  fi
done

verify_finish
