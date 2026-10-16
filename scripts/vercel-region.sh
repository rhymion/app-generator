#!/usr/bin/env bash
# Function Region reconcile helpers for scripts/vercel-setup.sh (Step 1.5).
# Source this file; it defines functions only and runs nothing.
#
# A consumer Vercel project whose Root Directory points at the app-generator
# submodule takes its `regions` from this repo's committed vercel.json, but a
# project created by `vercel project add` starts on the platform default
# (iad1) until something sets `serverlessFunctionRegion`. Nothing else reads
# that dashboard setting back, so a build that ran before Root Directory was
# set leaves the project on iad1 silently. See
# docs/knowledge/vercel-region-alignment.md.
#
# The token is handed to curl through a config on stdin (`-K -`) so it never
# appears in argv (visible to `ps`/`pgrep -af`) or in any echoed line.

# Print the first entry of the "regions" array in the given vercel.json, or
# nothing when the file, the key or a non-empty entry is missing.
vercel_committed_region() {
  local _file="$1"
  [[ -f "$_file" ]] || return 0
  python3 -c '
import json, sys
try:
    regions = json.load(open(sys.argv[1])).get("regions") or []
except (OSError, ValueError):
    regions = []
print(regions[0] if regions and isinstance(regions[0], str) else "")
' "$_file"
}

# curl against the Vercel Projects API with the bearer token supplied on stdin.
# Usage: _vercel_api_curl <VERCEL_TOKEN> <curl args...>
_vercel_api_curl() {
  local _token="$1"
  shift
  printf 'header = "Authorization: Bearer %s"\n' "$_token" | curl -sS -K - "$@"
}

_vercel_json_field() {
  python3 -c '
import json, sys
try:
    print(json.load(sys.stdin).get(sys.argv[1]) or "")
except ValueError:
    print("")
' "$1"
}

# Read serverlessFunctionRegion and PATCH it to <region> when it differs.
# Idempotent: a project already on <region> is left untouched. Exits the
# calling script (like the rootDirectory step) when the PATCH is not echoed
# back with the requested value.
# Usage: vercel_reconcile_function_region <VERCEL_TOKEN> <project api url with
#        optional ?teamId= query> <region>
vercel_reconcile_function_region() {
  local _token="$1" _url="$2" _region="$3" _current _out _patched
  _current=$(_vercel_api_curl "$_token" "$_url" | _vercel_json_field serverlessFunctionRegion)
  if [[ "$_current" == "$_region" ]]; then
    echo "[SKIP] serverlessFunctionRegion already set to '${_region}'"
    return 0
  fi
  _out=$(_vercel_api_curl "$_token" -X PATCH -H "Content-Type: application/json" \
    -d "{\"serverlessFunctionRegion\":\"${_region}\"}" "$_url")
  _patched=$(printf '%s' "$_out" | _vercel_json_field serverlessFunctionRegion)
  if [[ "$_patched" != "$_region" ]]; then
    echo "ERROR: failed to set serverlessFunctionRegion via Vercel API (response: ${_out})" >&2
    exit 1
  fi
  echo "  Set serverlessFunctionRegion: '${_current:-<unset>}' -> '${_region}'"
}
