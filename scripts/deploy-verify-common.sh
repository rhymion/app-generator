#!/usr/bin/env bash
# Shared helpers for the read-only post-deployment checks (Issue #1244):
# scripts/gcp-verify.sh and scripts/vercel-verify.sh. Source it; do not run it.
#
# Every result is one line `PASS <setting>` or `FAIL <setting>: <reason>`. A line names the setting it examined and
# never a value: secrets are checked for presence by name only, and nothing read from .env.production.local or from
# the platform is printed. The summary line and the exit status (1 when any check failed) come from verify_finish.

_VERIFY_FAILED=0
_VERIFY_PASSED=0

verify_pass() {
  echo "PASS $1"
  _VERIFY_PASSED=$((_VERIFY_PASSED + 1))
}

verify_fail() {
  echo "FAIL $1: $2"
  _VERIFY_FAILED=$((_VERIFY_FAILED + 1))
}

verify_info() {
  echo "INFO $1"
}

verify_finish() {
  echo "${_VERIFY_PASSED} passed, ${_VERIFY_FAILED} failed"
  [[ "$_VERIFY_FAILED" -eq 0 ]]
}

# verify_env_value NAME: print NAME's value from the environment, else from .env.production.local, without sourcing
# the file (sourcing would run it as shell and export every secret). Only non-secret names (project id, bucket
# names, service names) are read this way.
verify_env_value() {
  local name="$1" file="${VERIFY_ENV_FILE:-${_VERIFY_DIR}/../.env.production.local}" line value
  if [[ -n "${!name:-}" ]]; then
    printf '%s' "${!name}"
    return 0
  fi
  [[ -f "$file" ]] || return 0
  line="$(grep -E "^[[:space:]]*(export[[:space:]]+)?${name}=" "$file" | tail -n 1 || true)"
  value="${line#*=}"
  value="${value%\"}"; value="${value#\"}"
  value="${value%\'}"; value="${value#\'}"
  printf '%s' "$value"
}

verify_require_cli() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "ERROR: the $1 CLI is not installed or not on PATH; sign in with it first ($2)." >&2
    exit 2
  fi
}
