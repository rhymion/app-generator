#!/usr/bin/env bash
# Vercel project setup for consumer apps generated from this repo
# (app-generator) — control plane only. Canonical copy — consumer repos
# reference this file via their app-generator submodule rather than keeping
# their own duplicate (cmd_711).
# Verifies the
# app-generator submodule, provisions Neon/Upstash/Blob, links the Vercel
# project, and injects env vars for both production and preview (two-DB
# pattern). Does NOT run any database migration or seed — those are two
# separate, later stages:
#   scripts/vercel-deploy.sh [--prod]   — first deploy, creates the schema
#   scripts/vercel-seed.sh   [--prod]   — bootstrap tenant/admin data
# (cmd_691 — this script used to also run migrate:deploy/db:seed-tenant here,
# as Steps 3/4/5/5.5; removed because vercel-build already runs
# migrate:deploy on every deploy (see §18 of docs/vercel-automation-design.md),
# making a second, earlier owner here redundant, and because seeding before
# any deploy has ever run means seeding a database with no schema yet — see
# §19 of that doc for the corrected three-stage ordering.)
#
# Usage:
#   ./scripts/vercel-setup.sh              # live run
#   DRY_RUN=true ./scripts/vercel-setup.sh # echo all write commands, no Vercel/DB changes
#   ./scripts/vercel-setup.sh --status     # read-only diagnostic, no writes (see bottom of file)
#
# Prerequisites: vercel CLI, npm
# Must run after: git submodule update --init --recursive (or let Step 0 do it)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/vercel-env.sh"

# ── --status: read-only migration-state diagnostic, no writes ──────────────
# Compares production vs. staging `prisma migrate status` without touching
# either database's schema or data. Exits before any provisioning/injection
# logic below. See §19 of docs/vercel-automation-design.md.
if [[ "${1:-}" == "--status" ]]; then
  echo ""
  echo "================================================================="
  echo "  Vercel/Neon migration status (read-only)"
  echo "================================================================="
  echo ""
  for pair in "production:DATABASE_URL_UNPOOLED_PROD" "staging:DATABASE_URL_UNPOOLED_STAGING"; do
    _label="${pair%%:*}"
    _var="${pair#*:}"
    _url="${!_var:-}"
    echo "--- ${_label} (${_var}) ---"
    if [[ -z "$_url" ]]; then
      echo "  [SKIP] ${_var} is not set in .env.production.local — run vercel-setup.sh first."
    else
      # `npm --prefix <dir> exec` does not cd into <dir> the way `npm --prefix
      # <dir> run <script>` does — confirmed live: prisma then fails to find
      # prisma/schema.prisma relative to the caller's cwd. Neither `migrate:deploy`
      # nor any other package.json script exposes a bare `prisma <args>` passthrough,
      # so a subshell cd is used instead of adding a new script just for this.
      (cd "${ROOT}/app-generator" && DATABASE_URL="${_url}" npx prisma migrate status 2>&1) \
        | grep -v '^$' || true
    fi
    echo ""
  done
  echo "================================================================="
  echo "  End of status report — no changes made."
  echo "================================================================="
  exit 0
fi

DRY_RUN="${DRY_RUN:-false}"

run() {
  if [[ "$DRY_RUN" == "true" ]]; then
    echo "[DRY-RUN] $*"
  else
    "$@"
  fi
}

# `echo "KEY=val" >> file` silently concatenates onto the last line instead of
# starting a new one when the file doesn't already end in a newline (found
# live during this script's development — see report subtask_298a). Call this
# before any such append to _ENV_FILE.
_ensure_trailing_newline() {
  local _f="$1"
  [[ -s "$_f" ]] || return 0
  [[ "$(tail -c1 "$_f")" == "" ]] || printf '\n' >> "$_f"
}

echo ""
echo "================================================================="
echo "  Vercel setup: project=${VERCEL_PROJECT_NAME}"
echo "================================================================="
[[ "$DRY_RUN" == "true" ]] && echo "[DRY-RUN mode — write commands echoed, not executed]"
echo ""

# ── Step 0: Submodule check ─────────────────────────────────────────────────
echo "[Step 0] Verifying app-generator submodule is checked out..."
if [[ ! -d "${ROOT}/app-generator/app" ]]; then
  echo "  app-generator/app not found — running git submodule update --init --recursive..."
  run git -C "${ROOT}" submodule update --init --recursive
fi
if [[ "$DRY_RUN" != "true" ]]; then
  test -d "${ROOT}/app-generator/app" || { echo "ERROR: app-generator/app still not found after submodule checkout." >&2; exit 1; }
fi
echo "  OK: submodule present."

# ── Step A: Neon get-or-create (DC-1: API direct, DC-2: branch-per-env) ─────
# NEON_PROJECT_ID (persisted in .env.production.local) is the idempotency
# anchor. See docs/vercel-automation-design.md §13.
#
# Connection-string retrieval uses the Neon CLI (neonctl) instead of the raw
# REST `connection_uri` endpoint: a direct REST pooled-connection fetch failed
# in a live run, while neonctl succeeded. neonctl is installed as a pinned
# devDependency (package.json) rather than invoked via per-run `npx <pkg>@ver`
# fetch or a global install: a global install's behavior can't be guaranteed
# across environments (global-only entries reach shell PATH; local ones
# don't), so _neonctl() below calls the local binary
# (node_modules/.bin/neonctl) directly — deterministic resolution, no
# registry/network round-trip once `npm install` has run, and the version is
# pinned in package.json for reproducibility. Project get-or-create also runs
# on neonctl (cmd_301 — a direct REST POST /projects intermittently failed
# live; see get_or_create_neon_project below). Branch get-or-create (the
# staging-branch existence check/creation in get_neon_connection_strings)
# stays on REST — not implicated in any reported live failure, so left as-is
# to keep this fix scoped.
echo ""
echo "=== Step A: Neon get-or-create ==="
_NEON_AUTH="Authorization: Bearer ${NEON_API_KEY:-}"
_NEON_API="https://console.neon.tech/api/v2"

# aws-ap-northeast-1 is NOT an available Neon project-creation region for this
# account/org — confirmed live during cmd_301 both via `neonctl projects
# create --help` (not in the listed choices) and via an actual `projects
# create --region-id aws-ap-northeast-1` API call, which fails with "requested
# region not found" (available_regions did not include it either). Falls back
# to aws-ap-southeast-1 (Singapore) per the maintainer's ruling on cmd_301
# (2026-07-10) — geographically closest available region to the intended
# ap-northeast-1, ahead of the existing happy-path project's aws-us-east-1.
# Override with NEON_REGION_ID if a different region is later confirmed
# available.
NEON_REGION_ID="${NEON_REGION_ID:-aws-ap-southeast-1}"

# neonctl reads the Neon API key from the NEON_API_KEY env var (already
# exported by vercel-env.sh's `set -a` source of .env.production.local) —
# confirmed via a live call, so it is never passed as a CLI flag (would leak
# into `ps` output).
_neonctl() {
  if [[ ! -x "${ROOT}/node_modules/.bin/neonctl" ]]; then
    echo "ERROR: neonctl not found in node_modules — run 'npm install' in ${ROOT} first." >&2
    return 1
  fi
  "${ROOT}/node_modules/.bin/neonctl" "$@"
}

get_or_create_neon_project() {
  if [[ -n "${NEON_PROJECT_ID:-}" ]]; then
    echo "[SKIP] NEON_PROJECT_ID already set: ${NEON_PROJECT_ID}"
    return 0
  fi

  # `projects list -o json` output shape is non-deterministic — confirmed
  # live via repeated identical calls (same key, same env): sometimes a bare
  # JSON array of project objects, sometimes `{"projects": [...],
  # "shared_with_you": [...]}` (the REST API's native shape). Handle both.
  _EXISTING=$(_neonctl projects list -o json | python3 -c "
import sys, json
data = json.load(sys.stdin)
projects = data.get('projects', []) if isinstance(data, dict) else data
for p in projects:
    if p.get('name') == sys.argv[1]:
        print(json.dumps(p)); break
" "${NEON_PROJECT_NAME}")

  if [[ -n "$_EXISTING" ]]; then
    echo "[SKIP] Neon project ${NEON_PROJECT_NAME} already exists"
    NEON_PROJECT_ID=$(printf '%s' "$_EXISTING" | python3 -c \
      "import sys,json; print(json.load(sys.stdin)['id'])")
  else
    # No --pg-version flag exists on this neonctl version's `projects create`
    # (confirmed via --help) — Neon's current default pg_version is used.
    _NEW=$(_neonctl projects create --name "${NEON_PROJECT_NAME}" \
      --region-id "${NEON_REGION_ID}" -o json)
    NEON_PROJECT_ID=$(printf '%s' "$_NEW" | python3 -c \
      "import sys,json; print(json.load(sys.stdin)['project']['id'])")
    echo "  Created Neon project: ${NEON_PROJECT_NAME} (${NEON_PROJECT_ID})"
  fi

  _NEON_PROJECT_ID_ESCAPED="$(_shell_dquote_escape "${NEON_PROJECT_ID}")"
  if grep -q "^NEON_PROJECT_ID=" "${_ENV_FILE}" 2>/dev/null; then
    sed -i "s|^NEON_PROJECT_ID=.*|NEON_PROJECT_ID=\"$(_sed_replacement_escape "${_NEON_PROJECT_ID_ESCAPED}")\"|" "${_ENV_FILE}"
  else
    _ensure_trailing_newline "${_ENV_FILE}"
    echo "NEON_PROJECT_ID=\"${_NEON_PROJECT_ID_ESCAPED}\"" >> "${_ENV_FILE}"
  fi
  export NEON_PROJECT_ID
}

# ── E2: ensure the default branch is named "production" ────────────────────
# A brand-new Neon project's default branch is always named `main` — Neon has
# no create-time flag to name it anything else (confirmed live: `projects
# create` always yields a `main` default branch). The rest of this script
# (get_neon_connection_strings "production" ...) assumes a branch literally
# named `production` exists. Idempotent: a project whose default branch is
# already named `production` (e.g. the existing happy-path project, set up
# via the Neon Console) is a no-op.
ensure_production_branch() {
  _DEFAULT_NAME=$(_neonctl branches list --project-id "${NEON_PROJECT_ID}" -o json | python3 -c "
import sys, json
for b in json.load(sys.stdin):
    if b.get('default'):
        print(b['name']); break
")
  if [[ "$_DEFAULT_NAME" == "production" ]]; then
    echo "[SKIP] default branch already named 'production'"
  elif [[ -z "$_DEFAULT_NAME" ]]; then
    echo "ERROR: could not determine default branch for project ${NEON_PROJECT_ID}" >&2
    return 1
  else
    _neonctl branches rename "$_DEFAULT_NAME" production --project-id "${NEON_PROJECT_ID}" >/dev/null
    echo "  Renamed default branch '${_DEFAULT_NAME}' -> 'production'"
  fi
}

# ── E3: ensure a branch has an attached compute (endpoint) ──────────────────
# A branch created via the raw Neon REST API without an `endpoints` payload
# (see the staging-branch creation below) gets no compute, and
# `neonctl connection-string` then has nothing to resolve a connection
# through (confirmed live — per the maintainer's verification). This neonctl version has no
# dedicated `neonctl endpoints` command, so existence is checked via
# `neonctl api .../endpoints` (authenticated REST passthrough); a read-write
# compute is added only if none exists (idempotent).
ensure_branch_compute() {
  local branch_name="$1"
  local _branch_id _endpoint_count
  _branch_id=$(_neonctl branches get "$branch_name" --project-id "${NEON_PROJECT_ID}" -o json | python3 -c \
    "import sys,json; print(json.load(sys.stdin)['id'])")
  _endpoint_count=$(_neonctl api "/projects/${NEON_PROJECT_ID}/branches/${_branch_id}/endpoints" -o json | python3 -c \
    "import sys,json; print(len(json.load(sys.stdin).get('endpoints', [])))")
  if [[ "$_endpoint_count" -gt 0 ]]; then
    echo "[SKIP] branch '${branch_name}' already has a compute endpoint"
  else
    _neonctl branches add-compute "$_branch_id" --project-id "${NEON_PROJECT_ID}" --type read_write >/dev/null
    echo "  Added compute endpoint to branch '${branch_name}'"
  fi
}

get_neon_connection_strings() {
  # Get pooled (app runtime) and unpooled (migration) endpoints for one branch.
  local branch_name="$1" var_pooled="$2" var_unpooled="$3"

  if [[ "$branch_name" == "staging" ]]; then
    _BRANCHES=$(curl -sS -H "$_NEON_AUTH" "${_NEON_API}/projects/${NEON_PROJECT_ID}/branches")
    _STAGING_EXISTS=$(printf '%s' "$_BRANCHES" | python3 -c "
import sys, json
for b in json.load(sys.stdin).get('branches', []):
    if b.get('name') == 'staging': print('yes'); break
")
    if [[ "$_STAGING_EXISTS" != "yes" ]]; then
      curl -sS -X POST -H "$_NEON_AUTH" -H "Content-Type: application/json" \
        -d '{"branch":{"name":"staging"}}' \
        "${_NEON_API}/projects/${NEON_PROJECT_ID}/branches" > /dev/null
      echo "  Created Neon staging branch"
    else
      echo "[SKIP] Neon staging branch already exists"
    fi
  fi

  # E3: guarantee a compute is attached before asking for a connection string
  # (see ensure_branch_compute above) — applies to both branches, since the
  # maintainer's verification also called out checking production, not staging alone.
  ensure_branch_compute "$branch_name"

  # `-o table` (the default) is the actual raw connection string on stdout for
  # this command — confirmed live; `-o json` does NOT wrap it in JSON, so the
  # output is captured as-is, not parsed.
  local pooled_url direct_url
  pooled_url=$(_neonctl connection-string "$branch_name" \
    --project-id "${NEON_PROJECT_ID}" --pooled)
  direct_url=$(_neonctl connection-string "$branch_name" \
    --project-id "${NEON_PROJECT_ID}")

  for pair in "${var_pooled}=${pooled_url}" "${var_unpooled}=${direct_url}"; do
    key="${pair%%=*}"; val="${pair#*=}"
    # Neon connection strings contain `&` (e.g. `&channel_binding=require`),
    # which is why this value gets double-quoted before being written (see
    # _shell_dquote_escape in vercel-env.sh — protects against `set -a;
    # source` at vercel-env.sh L19+ misparsing an unquoted `&` as the
    # background-job control operator on the *next* run, truncating the var —
    # subtask_301a). Separately, sed's replacement text also treats a literal
    # `&` as "whole match" and needs its own escaping so the value is written
    # verbatim instead of re-embedding the match on every run (found live:
    # 16x accumulated duplication across repeated executions — report
    # subtask_298a CF-1). These are two distinct escaping passes for two
    # distinct consumers (source-time vs. sed-write-time) — both still
    # required, applied via _sed_replacement_escape on top of the already
    # shell-escaped value.
    val_shell_escaped="$(_shell_dquote_escape "${val}")"
    if grep -q "^${key}=" "${_ENV_FILE}" 2>/dev/null; then
      sed -i "s|^${key}=.*|${key}=\"$(_sed_replacement_escape "${val_shell_escaped}")\"|" "${_ENV_FILE}"
    else
      _ensure_trailing_newline "${_ENV_FILE}"
      echo "${key}=\"${val_shell_escaped}\"" >> "${_ENV_FILE}"
    fi
  done
  # Assign via `export NAME=value` (not `eval`) so `&` and other shell
  # metacharacters in the connection string are treated as a literal value,
  # not re-parsed as shell syntax (found live: eval turned the export into a
  # backgrounded subshell at `&channel_binding=require`, leaving the in-memory
  # var empty even though .env.production.local was written correctly — see
  # report subtask_299a CF-5).
  export "${var_pooled}=${pooled_url}"
  export "${var_unpooled}=${direct_url}"
  echo "  Set ${var_pooled} and ${var_unpooled}"
}

if [[ "$DRY_RUN" == "true" ]]; then
  echo "[DRY-RUN] Would get-or-create Neon project ${NEON_PROJECT_NAME:-<unset>}"
  DATABASE_URL_PROD="${DATABASE_URL_PROD:-<DRY_RUN_NEON_PROD>}"
  DATABASE_URL_STAGING="${DATABASE_URL_STAGING:-<DRY_RUN_NEON_STAGING>}"
  DATABASE_URL_UNPOOLED_PROD="${DATABASE_URL_UNPOOLED_PROD:-<DRY_RUN_NEON_UNPOOLED_PROD>}"
  DATABASE_URL_UNPOOLED_STAGING="${DATABASE_URL_UNPOOLED_STAGING:-<DRY_RUN_NEON_UNPOOLED_STAGING>}"
else
  : "${NEON_API_KEY:?NEON_API_KEY is required in .env.production.local}"
  : "${NEON_PROJECT_NAME:?NEON_PROJECT_NAME is required in .env.production.local}"
  get_or_create_neon_project
  ensure_production_branch
  get_neon_connection_strings "production" "DATABASE_URL_PROD" "DATABASE_URL_UNPOOLED_PROD"
  get_neon_connection_strings "staging" "DATABASE_URL_STAGING" "DATABASE_URL_UNPOOLED_STAGING"
fi
export DATABASE_URL_PROD DATABASE_URL_STAGING DATABASE_URL_UNPOOLED_PROD DATABASE_URL_UNPOOLED_STAGING

# ── Step B: Upstash Redis get-or-create (shared with GCP — DP-4=A symmetry) ──
# Same DB name as gcp-setup.sh Step 4.5 -> same Upstash instance, so REDIS_URL
# is identical between the GCP and Vercel deploy paths. See §14.
echo ""
echo "=== Step B: Upstash Redis get-or-create ==="
#_UPSTASH_DB_NAME="${VERCEL_PROJECT_NAME:-app-generator-sample}-redis"
_UPSTASH_DB_NAME="${UPSTASH_DB_NAME:-app-generator-sample-redis}"


_upstash_api() {
  local _method="$1" _path="$2" _body="${3:-}"
  local _auth="Basic $(printf '%s:%s' "${UPSTASH_EMAIL}" "${UPSTASH_API_KEY}" | base64 -w0)"
  local _curl=(curl -sS -X "$_method" -H "Authorization: ${_auth}")
  [[ -n "$_body" ]] && _curl+=(-H "Content-Type: application/json" -d "$_body")
  local _out _code
  _out=$("${_curl[@]}" -w $'\n%{http_code}' "https://api.upstash.com${_path}") || {
    echo "ERROR: Upstash API ${_method} ${_path} — curl transport failure" >&2
    return 1
  }
  _code="${_out##*$'\n'}"
  _out="${_out%$'\n'*}"
  if [[ "$_code" != 2* ]]; then
    echo "ERROR: Upstash API ${_method} ${_path} failed (HTTP ${_code}):" >&2
    echo "       ${_out}" >&2
    return 1
  fi
  printf '%s' "$_out"
}

# Extract "password|endpoint|port" from a DB JSON object (password may be
# empty — create/reset-password responses include it, list/get omit it).
_upstash_parse_db() {
  python3 -c "
import sys, json
db = json.load(sys.stdin)
if not isinstance(db, dict):
    sys.stderr.write('unexpected Upstash response (not a JSON object)\n'); sys.exit(2)
print('{}|{}|{}'.format(db.get('password',''), db.get('endpoint',''), db.get('port','')))
"
}

if [[ "$DRY_RUN" == "true" ]]; then
  echo "[DRY-RUN] Would get-or-create Upstash Redis DB ${_UPSTASH_DB_NAME}"
  REDIS_URL="${REDIS_URL:-<DRY_RUN_REDIS_URL>}"
else
  : "${UPSTASH_EMAIL:?UPSTASH_EMAIL is required in .env.production.local}"
  : "${UPSTASH_API_KEY:?UPSTASH_API_KEY is required in .env.production.local}"
  : "${UPSTASH_PRIMARY_REGION:?UPSTASH_PRIMARY_REGION is required in .env.production.local}"

  _EXISTING_DBS=$(_upstash_api GET /v2/redis/databases) || exit 1
  _DB_OBJ=$(printf '%s' "$_EXISTING_DBS" | python3 -c "
import sys, json
data = json.load(sys.stdin); dbs = data if isinstance(data, list) else []
for db in dbs:
    if db.get('database_name') == sys.argv[1]:
        print(json.dumps(db)); break
" "${_UPSTASH_DB_NAME}")

  if [[ -n "$_DB_OBJ" ]]; then
    echo "[SKIP] Upstash Redis DB ${_UPSTASH_DB_NAME} already exists"
  else
    _DB_PAYLOAD=$(printf '{"database_name":"%s","platform":"aws","primary_region":"%s","tls":true}' \
      "${_UPSTASH_DB_NAME}" "${UPSTASH_PRIMARY_REGION}")
    _DB_OBJ=$(_upstash_api POST /v2/redis/database "$_DB_PAYLOAD") || exit 1
    echo "  Created Upstash Redis DB: ${_UPSTASH_DB_NAME}"
  fi

  _DB_ID=$(printf '%s' "$_DB_OBJ" | python3 -c "import sys,json; print(json.load(sys.stdin).get('database_id',''))")
  _PARSED=$(printf '%s' "$_DB_OBJ" | _upstash_parse_db) || exit 1
  IFS='|' read -r _REDIS_PW _REDIS_EP _REDIS_PORT <<<"$_PARSED"

  # list/get responses omit the password. Reset only when we don't already have
  # a usable REDIS_URL persisted, so ordinary re-runs don't rotate the live
  # Redis password (mirrors gcp-setup.sh's Secret Manager preservation check).
  if [[ -z "$_REDIS_PW" ]]; then
    if [[ -n "${REDIS_URL:-}" ]]; then
      echo "  Password not returned by list; REDIS_URL already set in .env.production.local — preserving it."
    else
      echo "  Password not returned by list; resetting to obtain a credential..."
      [[ -z "$_DB_ID" ]] && { echo "ERROR: no database_id available to reset password" >&2; exit 1; }
      _RESET_OBJ=$(_upstash_api POST "/v2/redis/reset-password/${_DB_ID}") || exit 1
      _PARSED=$(printf '%s' "$_RESET_OBJ" | _upstash_parse_db) || exit 1
      IFS='|' read -r _REDIS_PW _REDIS_EP _REDIS_PORT <<<"$_PARSED"
    fi
  fi

  if [[ -n "$_REDIS_PW" && -n "$_REDIS_EP" && -n "$_REDIS_PORT" ]]; then
    REDIS_URL="rediss://:${_REDIS_PW}@${_REDIS_EP}:${_REDIS_PORT}"
    _REDIS_URL_ESCAPED="$(_shell_dquote_escape "${REDIS_URL}")"
    if grep -q "^REDIS_URL=" "${_ENV_FILE}" 2>/dev/null; then
      sed -i "s|^REDIS_URL=.*|REDIS_URL=\"$(_sed_replacement_escape "${_REDIS_URL_ESCAPED}")\"|" "${_ENV_FILE}"
    else
      _ensure_trailing_newline "${_ENV_FILE}"
      echo "REDIS_URL=\"${_REDIS_URL_ESCAPED}\"" >> "${_ENV_FILE}"
    fi
    echo "  REDIS_URL set"
  elif [[ -z "${REDIS_URL:-}" ]]; then
    echo "ERROR: incomplete Upstash connection info (password/endpoint/port) and no existing REDIS_URL." >&2
    echo "       DB object: ${_DB_OBJ}" >&2
    exit 1
  fi
fi
export REDIS_URL

# ── Step 1: Link project ────────────────────────────────────────────────────
# Runs before Step C (Blob) — Blob store creation/token retrieval below needs
# the project already linked with VERCEL_PROJECT_ID resolved (see note there).
echo ""
echo "[Step 1] Adding and Linking Vercel project..."
_ADD_ARGS=(project add "${VERCEL_PROJECT_NAME}")
[[ -n "$VERCEL_ORG_ID" ]] && _ADD_ARGS+=(--scope "${VERCEL_ORG_ID}")
run vercel "${_ADD_ARGS[@]}"
_LINK_ARGS=(link --yes --project "${VERCEL_PROJECT_NAME}")
[[ -n "$VERCEL_ORG_ID" ]] && _LINK_ARGS+=(--scope "${VERCEL_ORG_ID}")

# VERCEL_PROJECT_ID: once VERCEL_ORG_ID is present in the environment, the
# Vercel CLI requires VERCEL_PROJECT_ID to be present too, or commands like
# `vercel env ls/add/pull` fail with "You specified VERCEL_ORG_ID but you
# forgot to specify VERCEL_PROJECT_ID" (confirmed live — `link`/`project add`
# themselves are fine without it, since they take --project/--scope directly,
# but the env-var commands used below and in vercel_env_inject are not).
if [[ -n "${VERCEL_PROJECT_ID:-}" ]]; then
  # Idempotent re-run: VERCEL_PROJECT_ID is already known (persisted in
  # .env.production.local by a prior run, exported here via vercel-env.sh's
  # `set -a` source). Re-deriving it from .vercel/project.json is not just
  # unnecessary but actively harmful: with VERCEL_ORG_ID+VERCEL_PROJECT_ID
  # both already present in the environment, `vercel link` below resolves via
  # those env vars and DELETES .vercel/project.json instead of writing it
  # (confirmed live) — breaking the python3 read that used to run
  # unconditionally right after. Skip that read entirely and reuse the
  # existing value directly; the .env.production.local write is also skipped
  # since the persisted value is already correct.
  run vercel "${_LINK_ARGS[@]}"
  echo "  OK: project linked."
  echo "  [SKIP] VERCEL_PROJECT_ID already set: ${VERCEL_PROJECT_ID} (skipping project.json derivation)"
elif [[ "$DRY_RUN" == "true" ]]; then
  run vercel "${_LINK_ARGS[@]}"
  echo "  OK: project linked."
  VERCEL_PROJECT_ID="<DRY_RUN_VERCEL_PROJECT_ID>"
else
  # First run (VERCEL_PROJECT_ID not yet known): unset VERCEL_ORG_ID/
  # VERCEL_PROJECT_ID for this one `link` call only, so the CLI is forced
  # through the explicit --scope/--project args above and writes a fresh
  # .vercel/project.json (rather than silently deleting/skipping it) —
  # `link`/`project add` need only --project/--scope, never the env vars, so
  # unsetting them here is safe and does not reintroduce the "you specified
  # VERCEL_ORG_ID but forgot VERCEL_PROJECT_ID" error from cmd_298.
  run env -u VERCEL_ORG_ID -u VERCEL_PROJECT_ID vercel "${_LINK_ARGS[@]}"
  echo "  OK: project linked."
  # `vercel link` just wrote the resolved project ID to .vercel/project.json;
  # read it from there (authoritative — correct even when VERCEL_PROJECT_NAME
  # resolved to a pre-existing project) rather than re-deriving it another way.
  VERCEL_PROJECT_ID=$(python3 -c \
    "import json; print(json.load(open('${ROOT}/.vercel/project.json'))['projectId'])")
  _VERCEL_PROJECT_ID_ESCAPED="$(_shell_dquote_escape "${VERCEL_PROJECT_ID}")"
  if grep -q "^VERCEL_PROJECT_ID=" "${_ENV_FILE}" 2>/dev/null; then
    sed -i "s|^VERCEL_PROJECT_ID=.*|VERCEL_PROJECT_ID=\"$(_sed_replacement_escape "${_VERCEL_PROJECT_ID_ESCAPED}")\"|" "${_ENV_FILE}"
  else
    _ensure_trailing_newline "${_ENV_FILE}"
    echo "VERCEL_PROJECT_ID=\"${_VERCEL_PROJECT_ID_ESCAPED}\"" >> "${_ENV_FILE}"
  fi
fi
export VERCEL_PROJECT_ID

# ── Step 1.5: Ensure Vercel project Root Directory ──────────────────────────
# Root Directory has no vercel.json field — confirmed against the current
# Vercel REST API reference (Update an existing project /
# Find a project by id or name, docs.vercel.com/docs/rest-api/reference/
# endpoints/projects): it is exclusively a Vercel Projects API property, read
# via `GET /v9/projects/{idOrName}` and written via `PATCH
# /v9/projects/{idOrName}` with body `{"rootDirectory": "..."}` (Bearer token
# auth, same VERCEL_TOKEN used by the `vercel` CLI itself — see
# docs/vercel-automation-design.md §V-7 "env var only, never --token flag").
# A team-scoped token additionally needs `?teamId=` (or `?slug=`) on both
# calls, mirroring the `--scope` handling already used for the CLI above.
# Read-then-write keeps this idempotent: a project whose Root Directory is
# already correct is a no-op.
echo ""
echo "[Step 1.5] Ensuring Vercel project Root Directory..."
_VERCEL_ROOT_DIRECTORY="${VERCEL_ROOT_DIRECTORY:-app-generator}"
_VERCEL_PROJECTS_API="https://api.vercel.com/v9/projects/${VERCEL_PROJECT_ID}"
_VERCEL_TEAM_QS=""
[[ -n "$VERCEL_ORG_ID" ]] && _VERCEL_TEAM_QS="?teamId=${VERCEL_ORG_ID}"

if [[ "$DRY_RUN" == "true" ]]; then
  echo "[DRY-RUN] curl -H 'Authorization: Bearer <redacted>' \"${_VERCEL_PROJECTS_API}${_VERCEL_TEAM_QS}\" (read rootDirectory)"
  echo "[DRY-RUN] Would PATCH rootDirectory to '${_VERCEL_ROOT_DIRECTORY}' if not already set"
else
  : "${VERCEL_TOKEN:?VERCEL_TOKEN is required in .env.production.local}"
  _CURRENT_ROOT_DIRECTORY=$(curl -sS -H "Authorization: Bearer ${VERCEL_TOKEN}" \
    "${_VERCEL_PROJECTS_API}${_VERCEL_TEAM_QS}" | python3 -c \
    "import sys,json; print(json.load(sys.stdin).get('rootDirectory') or '')")
  if [[ "$_CURRENT_ROOT_DIRECTORY" == "$_VERCEL_ROOT_DIRECTORY" ]]; then
    echo "[SKIP] rootDirectory already set to '${_VERCEL_ROOT_DIRECTORY}'"
  else
    _ROOT_DIR_PATCH_OUT=$(curl -sS -X PATCH -H "Authorization: Bearer ${VERCEL_TOKEN}" \
      -H "Content-Type: application/json" \
      -d "{\"rootDirectory\":\"${_VERCEL_ROOT_DIRECTORY}\"}" \
      "${_VERCEL_PROJECTS_API}${_VERCEL_TEAM_QS}")
    _PATCHED_ROOT_DIRECTORY=$(printf '%s' "$_ROOT_DIR_PATCH_OUT" | python3 -c \
      "import sys,json; print(json.load(sys.stdin).get('rootDirectory') or '')")
    if [[ "$_PATCHED_ROOT_DIRECTORY" != "$_VERCEL_ROOT_DIRECTORY" ]]; then
      echo "ERROR: failed to set rootDirectory via Vercel API (response: ${_ROOT_DIR_PATCH_OUT})" >&2
      exit 1
    fi
    echo "  Set rootDirectory: '${_VERCEL_ROOT_DIRECTORY}'"
  fi
fi

# ── Helper: pull a live env-var value from Vercel (used for Blob token) ─────
# `vercel env ls` only shows metadata ("Encrypted") — pulling is the only way
# to get an actual decrypted value. The pulled file is written by `mktemp`
# (private, mode 600) and removed immediately after parsing; the value is
# returned via stdout capture only, never echoed to the terminal/log.
_vercel_pull_env_var() {
  local _var_name="$1" _target="$2" _tmp _val
  _tmp="$(mktemp)"
  if ! vercel env pull --environment "${_target}" --yes "${_tmp}" >/dev/null 2>&1; then
    rm -f "${_tmp}"
    return 1
  fi
  _val=$(python3 -c "
import sys
name = sys.argv[1]
with open(sys.argv[2]) as f:
    for line in f:
        line = line.rstrip('\n')
        if line.startswith(name + '='):
            v = line[len(name) + 1:]
            if len(v) >= 2 and v[0] == '\"' and v[-1] == '\"':
                v = v[1:-1]
            print(v)
            break
" "${_var_name}" "${_tmp}")
  rm -f "${_tmp}"
  [[ -n "$_val" ]] || return 1
  printf '%s' "${_val}"
}

# ── Step C: Vercel Blob get-or-create (DC-3: PD-4 superseded — CLI available) ──
# VERCEL_BLOB_STORE_ID (persisted in .env.production.local) is the idempotency
# anchor — `vercel blob get-store` takes a store ID, not a name. See §15.
#
# BLOB_READ_WRITE_TOKEN retrieval (PD-5 resolved): `vercel blob get-store` has
# no --output/--json flag at all (confirmed live) and never returns the RW
# token regardless of format, so parsing its output was never viable. Working
# path: `vercel blob create-store --environment <env>` connects the new store
# to the linked project, which auto-injects BLOB_READ_WRITE_TOKEN into that
# project env (confirmed live: `vercel env ls production` shows
# BLOB_READ_WRITE_TOKEN immediately after `create-store --environment
# production`) — then `_vercel_pull_env_var` above reads the live value back.
echo ""
echo "=== Step C: Vercel Blob get-or-create ==="
if [[ "$DRY_RUN" == "true" ]]; then
  echo "[DRY-RUN] Would get-or-create Blob store for ${VERCEL_PROJECT_NAME:-<unset>}"
  BLOB_READ_WRITE_TOKEN="${BLOB_READ_WRITE_TOKEN:-<DRY_RUN_BLOB_TOKEN>}"
else
  if [[ -n "${VERCEL_BLOB_STORE_ID:-}" ]]; then
    echo "[SKIP] VERCEL_BLOB_STORE_ID already set: ${VERCEL_BLOB_STORE_ID}"
    BLOB_READ_WRITE_TOKEN=$(_vercel_pull_env_var BLOB_READ_WRITE_TOKEN production) || BLOB_READ_WRITE_TOKEN=""
    if [[ -z "$BLOB_READ_WRITE_TOKEN" ]]; then
      echo "  WARNING: BLOB_READ_WRITE_TOKEN not found in production env for this store." >&2
      echo "  This happens if the store predates the --environment auto-connect flag" >&2
      echo "  below (existing stores are not retroactively connectable via CLI — no" >&2
      echo "  'vercel blob connect' subcommand exists, confirmed via --help)." >&2
      echo "  MANUAL FALLBACK: in the Vercel dashboard, open Storage ->" >&2
      echo "  ${VERCEL_BLOB_STORE_ID} -> Connect to Project, select" >&2
      echo "  ${VERCEL_PROJECT_NAME} (production + preview), then re-run this script." >&2
    fi
  else
    _STORE_NAME="${VERCEL_PROJECT_NAME:-app-generator-sample}-uploads"
    _STORE_JSON=$(vercel blob create-store "${_STORE_NAME}" --yes --access public \
      --environment production --environment preview 2>&1)
    VERCEL_BLOB_STORE_ID=$(printf '%s' "$_STORE_JSON" | python3 -c \
      "import sys,json; d=json.load(sys.stdin); print(d.get('storeId',''))" 2>/dev/null \
      || printf '%s' "$_STORE_JSON" | grep -oP 'store_\w+' | head -1)
    _VERCEL_BLOB_STORE_ID_ESCAPED="$(_shell_dquote_escape "${VERCEL_BLOB_STORE_ID}")"
    if grep -q "^VERCEL_BLOB_STORE_ID=" "${_ENV_FILE}" 2>/dev/null; then
      sed -i "s|^VERCEL_BLOB_STORE_ID=.*|VERCEL_BLOB_STORE_ID=\"$(_sed_replacement_escape "${_VERCEL_BLOB_STORE_ID_ESCAPED}")\"|" "${_ENV_FILE}"
    else
      _ensure_trailing_newline "${_ENV_FILE}"
      echo "VERCEL_BLOB_STORE_ID=\"${_VERCEL_BLOB_STORE_ID_ESCAPED}\"" >> "${_ENV_FILE}"
    fi
    export VERCEL_BLOB_STORE_ID
    echo "  Created Blob store: ${_STORE_NAME} (${VERCEL_BLOB_STORE_ID})"
    BLOB_READ_WRITE_TOKEN=$(_vercel_pull_env_var BLOB_READ_WRITE_TOKEN production) || BLOB_READ_WRITE_TOKEN=""
    if [[ -z "$BLOB_READ_WRITE_TOKEN" ]]; then
      echo "  WARNING: store created but BLOB_READ_WRITE_TOKEN not retrievable via env pull." >&2
      echo "  MANUAL FALLBACK: check Vercel dashboard Storage -> ${_STORE_NAME} -> confirm" >&2
      echo "  it is connected to ${VERCEL_PROJECT_NAME}, then set BLOB_READ_WRITE_TOKEN" >&2
      echo "  manually in .env.production.local." >&2
    fi
  fi
fi
export BLOB_READ_WRITE_TOKEN

# ── Step 2: Inject env vars (production + preview) ──────────────────────────
echo ""
echo "[Step 2] Injecting environment variables..."
vercel_env_inject production
vercel_env_inject preview

# Remove any stale PRISMA_DATABASE_URL (Accelerate era) from Vercel project env.
# Root cause (subtask_440a): a leftover .env.production.local PRISMA_DATABASE_URL
# forces lib/prisma.ts onto the dead Accelerate/db.prisma.io branch, hiding the
# Neon DATABASE_URL injected above. `.vercelignore` (subtask_440) stops new local
# files from being uploaded, but this cleanup is what removes an already-set
# Vercel project env var on repeated vercel-setup.sh runs — idempotent via
# `|| true` since `vercel env rm` errors when the var is already absent.
run vercel env rm PRISMA_DATABASE_URL production --yes 2>/dev/null || true
run vercel env rm PRISMA_DATABASE_URL preview --yes 2>/dev/null || true

# Migration and seeding are deliberately NOT run here (cmd_691 — see the file
# header and §19 of docs/vercel-automation-design.md). `vercel-build` already
# runs `migrate:deploy` on every deploy (§18), and seeding before any deploy
# has ever happened means seeding a database with no schema yet. Those two
# steps now live in scripts/vercel-deploy.sh and scripts/vercel-seed.sh,
# which must run in that order after this script.

echo ""
echo "================================================================="
echo "  Vercel setup complete (control plane only — no migration/seed run)"
echo "================================================================="
if [[ "$DRY_RUN" == "true" ]]; then
  echo "[DRY-RUN] Run without DRY_RUN=true to apply changes."
else
  echo "  Next:"
  echo "    1. First deploy (creates the schema):"
  echo "         staging:    git push (Git-provider auto-deploy) or bash scripts/vercel-deploy.sh"
  echo "         production: bash scripts/vercel-deploy.sh --prod"
  echo "    2. Seed (after step 1 has completed for each environment):"
  echo "         staging:    bash scripts/vercel-seed.sh"
  echo "         production: bash scripts/vercel-seed.sh --prod"
  echo "    Diagnostic (any time, read-only): bash scripts/vercel-setup.sh --status"
fi
echo ""
