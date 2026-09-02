#!/usr/bin/env bash
# Demo-only setup for Vercel-connected deployments: seeding a demo dataset
# and/or applying a non-standard permission configuration, layered on top
# of the baseline scripts/vercel-seed.sh already provides. Canonical copy —
# consumer repos reference this file via their app-generator submodule
# rather than keeping their own duplicate (cmd_711).
#
# Distinct from vercel-seed.sh (do NOT edit that file): vercel-seed.sh owns
# the minimum idempotent bootstrap (default tenant, admin user,
# Administrator role, full-CRUD permissions) every deployment needs to
# function at all. This script is for optional demo extras layered on top
# of that baseline, run manually and only when a given demo actually needs
# them.
#
# Scope (cmd_906): only the plumbing is implemented here — argument
# parsing, env-var injection reuse, and the pre-write safety gate. Neither
# the demo dataset's content nor the non-standard permission shape has been
# specified yet, so both features are wired as explicit placeholders that
# report "not yet specified" and stop rather than guessing at content.
#
# Usage:
#   ./scripts/vercel-demo-setup.sh --data-file <path>   [--staging|--prod]
#   ./scripts/vercel-demo-setup.sh --role-config <path> [--staging|--prod]
#   ./scripts/vercel-demo-setup.sh                        # reports both as unspecified
#   DRY_RUN=false ./scripts/vercel-demo-setup.sh --data-file demo/data.json --prod
#
# Safety (all three mandatory, none optional):
#   - DRY_RUN defaults to true. Only an explicit DRY_RUN=false performs a
#     real write.
#   - Target defaults to staging (preview). --prod must be passed
#     explicitly to touch production.
#   - Before any real write, the target DB is named by env var name + host
#     only (never the credential / full connection string), and a yes/no
#     confirmation is required.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Must be set before sourcing vercel-env.sh: that file's own default
# (DRY_RUN="${DRY_RUN:-false}") only fires when DRY_RUN is still unset, so
# setting the safe default here first makes this script default to
# DRY_RUN=true even though vercel-env.sh itself defaults to false.
DRY_RUN="${DRY_RUN:-true}"

# shellcheck disable=SC1091
source "${SCRIPT_DIR}/vercel-env.sh"

_DATA_FILE=""
_ROLE_CONFIG=""
_TARGET="staging"

_usage() {
  echo "Usage: $(basename "$0") [--data-file <path>] [--role-config <path>] [--staging|--prod]"
  echo "  --data-file <path>    Demo dataset definition file (format: not yet specified)"
  echo "  --role-config <path>  Non-standard role/permission definition file (format: not yet specified)"
  echo "  --staging             Target the preview/staging DB (default)"
  echo "  --prod                Target the production DB (must be explicit)"
  echo "  DRY_RUN=true is the default; set DRY_RUN=false to perform a real write."
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --data-file)
      _DATA_FILE="${2:?--data-file requires a path}"; shift 2 ;;
    --role-config)
      _ROLE_CONFIG="${2:?--role-config requires a path}"; shift 2 ;;
    --prod)
      _TARGET="prod"; shift ;;
    --staging)
      _TARGET="staging"; shift ;;
    -h|--help)
      _usage; exit 0 ;;
    *)
      echo "ERROR: unknown argument '$1'" >&2; _usage; exit 1 ;;
  esac
done

# ── Resolve target DB (mirrors vercel-seed.sh's guard/fallback pattern) ─────
if [[ "$DRY_RUN" != "true" ]]; then
  if [[ "$_TARGET" == "prod" ]]; then
    : "${DATABASE_URL_UNPOOLED_PROD:?DATABASE_URL_UNPOOLED_PROD is required in .env.production.local for target=production}"
  else
    : "${DATABASE_URL_UNPOOLED_STAGING:?DATABASE_URL_UNPOOLED_STAGING is required in .env.production.local for target=staging}"
  fi
fi

if [[ "$_TARGET" == "prod" ]]; then
  _DB_VAR="DATABASE_URL_UNPOOLED_PROD"
  _DB_URL="${DATABASE_URL_UNPOOLED_PROD:-<DRY_RUN_DATABASE_URL_UNPOOLED_PROD>}"
  _ENV_LABEL="production"
  _VERCEL_ENV_TARGET="production"
else
  _DB_VAR="DATABASE_URL_UNPOOLED_STAGING"
  _DB_URL="${DATABASE_URL_UNPOOLED_STAGING:-<DRY_RUN_DATABASE_URL_UNPOOLED_STAGING>}"
  _ENV_LABEL="staging"
  _VERCEL_ENV_TARGET="preview"
fi

# ── redacted target display: env var name + host only, never the credential ─
_target_host() {
  local url="$1"
  if [[ -z "$url" ]]; then
    echo "(unset)"
    return
  fi
  # postgres://user:pass@host:port/db?... -> host:port/db (strip credentials
  # and any query string before ever printing this to the terminal).
  echo "$url" | sed -E 's#^[a-zA-Z0-9+]+://[^@]*@##; s#\?.*$##'
}

echo "================================================================="
echo "  Vercel Demo Setup Script"
echo "================================================================="
echo "  Target : ${_ENV_LABEL}"
echo "  DB var : ${_DB_VAR}"
echo "  DB host: $(_target_host "$_DB_URL")"
echo "  DRY_RUN: ${DRY_RUN}"
echo "================================================================="
echo ""

if [[ -z "$_DATA_FILE" && -z "$_ROLE_CONFIG" ]]; then
  echo "No demo data definition file specified — waiting on further instruction (cmd_906)."
  echo "  Pass --data-file <path> once the demo dataset format is defined."
  echo "No permission configuration file specified — waiting on further instruction (cmd_906)."
  echo "  Pass --role-config <path> once the role/permission shape is defined."
  exit 0
fi

# ── Fail closed on a missing input file before any write is attempted ──────
if [[ -n "$_DATA_FILE" && ! -f "$_DATA_FILE" ]]; then
  echo "ERROR: --data-file '${_DATA_FILE}' not found." >&2
  exit 1
fi
if [[ -n "$_ROLE_CONFIG" && ! -f "$_ROLE_CONFIG" ]]; then
  echo "ERROR: --role-config '${_ROLE_CONFIG}' not found." >&2
  exit 1
fi

# ── Safety gate: name the target DB and require confirmation before ANY
#    real (non-DRY_RUN) write below — including the env-injection reuse
#    step, which is itself a real write to Vercel once DRY_RUN=false.
#    Mirrors vercel-teardown.sh's confirm pattern. Runs once, up front,
#    rather than per-action, so nothing downstream can slip past it.
_ACTIONS="inject Vercel env vars for target=${_VERCEL_ENV_TARGET}"
[[ -n "$_DATA_FILE" ]] && _ACTIONS="${_ACTIONS}; seed demo data from '${_DATA_FILE}'"
[[ -n "$_ROLE_CONFIG" ]] && _ACTIONS="${_ACTIONS}; apply role/permission config from '${_ROLE_CONFIG}'"

echo "About to perform REAL write(s): ${_ACTIONS}"
echo "  Target DB var : ${_DB_VAR}"
echo "  Target DB host: $(_target_host "$_DB_URL")"
if [[ "$DRY_RUN" == "true" ]]; then
  echo "[DRY-RUN] Skipping interactive confirmation (no real write will occur)."
else
  read -rp "Proceed with these writes against ${_ENV_LABEL}? (yes/no): " _confirm
  if [[ "${_confirm}" != "yes" ]]; then
    echo "Cancelled. Exiting."
    exit 0
  fi
fi
echo ""

# Reuse vercel-env.sh's injection function to make sure the target Vercel
# environment's env vars are current before running any demo-specific
# action below — the same step vercel-setup.sh performs, not a new
# mechanism (task requirement: reuse vercel_env_inject, do not reinvent it).
echo "[Step] Ensuring Vercel env vars are current for target=${_VERCEL_ENV_TARGET} (vercel_env_inject)..."
vercel_env_inject "$_VERCEL_ENV_TARGET"
echo ""

# ── Demo data placeholder (cmd_906) ─────────────────────────────────────────
# The dataset's shape/content is not yet specified. This function is the
# hook: once a data-file format is defined, its loader goes here. Do not
# guess at content — only report the missing specification and stop.
_seed_demo_data() {
  local file="$1"
  echo "[STUB] Demo data definition format is not yet specified — waiting on further instruction (cmd_906)."
  echo "        File received: ${file}"
  echo "        No data was written."
}

# ── Non-standard permission placeholder (cmd_906) ───────────────────────────
# Role+permission is this project's established authorization model. The
# concrete role names and permission shape are not yet specified — this is
# only the call skeleton for the existing role/permission API (see
# scripts/grant-all-permissions.ts for the Role.findFirst + Permission.upsert
# pattern this would follow).
_apply_role_config() {
  local file="$1"
  echo "[STUB] Role/permission configuration format is not yet specified — waiting on further instruction (cmd_906)."
  echo "        File received: ${file}"
  echo "        No role or permission change was written."
  echo "        (Would call into the existing role+permission API, in the shape of"
  echo "        scripts/grant-all-permissions.ts, once the config format is specified.)"
}

if [[ -n "$_DATA_FILE" ]]; then
  _seed_demo_data "$_DATA_FILE"
  echo ""
fi

if [[ -n "$_ROLE_CONFIG" ]]; then
  _apply_role_config "$_ROLE_CONFIG"
  echo ""
fi

echo "================================================================="
echo "  Vercel Demo Setup: done"
echo "================================================================="
