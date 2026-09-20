#!/usr/bin/env bash
# GCP environment setup for the generated app (Cloud Run + Neon + Upstash).
# Provisions GCP APIs, Artifact Registry, the service account, Upstash Redis,
# Secret Manager, and the GCS bucket (Steps 1, 2, 4, 4.5, 5, 6 below; Step 3
# — Cloud SQL provisioning — was retired when the DB moved to Neon, see
# docs/knowledge/gcp-automation-design.md), each step idempotent (safe to
# re-run after a partial failure). Neon itself is not provisioned by this
# script — DATABASE_URL/DIRECT_URL are supplied via .env.production.local
# (see scripts/gcp-env.sh).
#
# Usage:
#   ./scripts/gcp-setup.sh             # live run
#   DRY_RUN=true ./scripts/gcp-setup.sh  # echo all write commands, no GCP changes
#
# Prerequisites: gcloud CLI, curl, docker
# Must run before: scripts/gcp-deploy.sh (this script creates the Artifact
# Registry repository that gcp-deploy.sh pushes images into)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/gcp-env.sh"

# Derive PROJECT_NUMBER from PROJECT_ID at runtime (do not store in .env)
PROJECT_NUMBER=$(gcloud projects describe "${PROJECT_ID}" --format='value(projectNumber)')
export PROJECT_NUMBER
echo "[INFO] PROJECT_NUMBER=${PROJECT_NUMBER}"

# ── DRY_RUN helper ──────────────────────────────────────────────────────────
DRY_RUN=${DRY_RUN:-false}
run() {
  if [[ "$DRY_RUN" == "true" ]]; then
    echo "[DRY-RUN] $*"
  else
    "$@"
  fi
}

# IAM is eventually consistent: a service account that was JUST created can be
# invisible to policy-binding checks on other APIs (Resource Manager, IAM Admin,
# Storage) for a few seconds up to ~1 minute, causing
# "INVALID_ARGUMENT: ... does not exist" even though creation already succeeded.
# This wrapper retries a gcloud command with exponential backoff ONLY when its
# stderr shows that specific propagation-lag error. When the service account
# already existed (idempotent re-run), no such error is ever produced, so the
# command succeeds on the first attempt and no wait is incurred.
IAM_RETRY_MAX_ATTEMPTS=6
run_iam_binding() {
  if [[ "$DRY_RUN" == "true" ]]; then
    echo "[DRY-RUN] $*"
    return 0
  fi
  local attempt=1 delay=2 stderr_file
  stderr_file="$(mktemp)"
  while true; do
    if "$@" 2>"$stderr_file"; then
      cat "$stderr_file" >&2
      rm -f "$stderr_file"
      return 0
    fi
    if grep -q "does not exist" "$stderr_file" && (( attempt < IAM_RETRY_MAX_ATTEMPTS )); then
      echo "  [IAM propagation lag] attempt ${attempt}/${IAM_RETRY_MAX_ATTEMPTS} failed, retrying in ${delay}s..." >&2
      cat "$stderr_file" >&2
      sleep "$delay"
      attempt=$((attempt + 1))
      delay=$((delay * 2))
      : > "$stderr_file"
      continue
    fi
    cat "$stderr_file" >&2
    rm -f "$stderr_file"
    echo "ERROR: gcloud command failed after ${attempt} attempt(s): $*" >&2
    return 1
  done
}

# Idempotent Secret Manager upsert: create if new, add version if existing.
upsert_secret() {
  local name="$1" value="$2"
  if gcloud secrets describe "$name" --quiet 2>/dev/null; then
    if [[ "$DRY_RUN" == "true" ]]; then
      echo "[DRY-RUN] gcloud secrets versions add ${name} --data-file=- (value prefix: ${value:0:20}...)"
    else
      printf '%s' "$value" | gcloud secrets versions add "$name" --data-file=-
      echo "  Updated secret: ${name}"
    fi
  else
    if [[ "$DRY_RUN" == "true" ]]; then
      echo "[DRY-RUN] gcloud secrets create ${name} --data-file=- (value prefix: ${value:0:20}...)"
    else
      printf '%s' "$value" | gcloud secrets create "$name" \
        --data-file=- --replication-policy=automatic
      echo "  Created secret: ${name}"
    fi
  fi
}

# ── Prerequisites check ──────────────────────────────────────────────────────
for _cmd in gcloud curl; do
  if ! command -v "$_cmd" &>/dev/null; then
    echo "ERROR: Required command not found: ${_cmd}" >&2
    exit 1
  fi
done

echo "=== GCP Setup: ${PROJECT_ID} / ${REGION} ==="
[[ "$DRY_RUN" == "true" ]] && echo "[DRY-RUN mode — write commands echoed, not executed]"
echo ""

# ── Step 1: Enable GCP APIs ──────────────────────────────────────────────────
echo "=== Step 1: Enable GCP APIs ==="
run gcloud services enable \
  run.googleapis.com \
  sqladmin.googleapis.com \
  secretmanager.googleapis.com \
  artifactregistry.googleapis.com \
  storage.googleapis.com \
  iamcredentials.googleapis.com \
  cloudresourcemanager.googleapis.com

# ── Step 2: Artifact Registry ────────────────────────────────────────────────
echo ""
echo "=== Step 2: Artifact Registry ==="
if gcloud artifacts repositories describe "$REPO_NAME" --location="$REGION" --quiet 2>/dev/null; then
  echo "[SKIP] Repository ${REPO_NAME} already exists"
else
  run gcloud artifacts repositories create "$REPO_NAME" \
    --repository-format=docker \
    --location="$REGION" \
    --description="App Generator Docker images"
fi
run gcloud auth configure-docker "${REGION}-docker.pkg.dev" --quiet

# ── Step 3: [retired] Cloud SQL provisioning ─────────────────────────────────
# The DB moved to Neon (DATABASE_URL/DIRECT_URL come from .env.production.local
# via gcp-env.sh) — there is no GCP-side database instance left to provision.
# See docs/knowledge/gcp-automation-design.md.

# ── Step 4: Service Account + IAM ────────────────────────────────────────────
echo ""
echo "=== Step 4: Service Account ==="
if gcloud iam service-accounts describe "$SA_EMAIL" --quiet 2>/dev/null; then
  echo "[SKIP] Service account ${SA_EMAIL} already exists"
else
  run gcloud iam service-accounts create "$SA_NAME" \
    --display-name="App Cloud Run SA"
fi

run_iam_binding gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${SA_EMAIL}" \
  --role="roles/cloudsql.client" \
  --condition=None

run_iam_binding gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${SA_EMAIL}" \
  --role="roles/secretmanager.secretAccessor" \
  --condition=None

# GCS objectAdmin at bucket level (avoids UBLA + condition mismatch issues)
# Bucket may not exist yet; this binding is re-applied after Step 6 as well.
# Self-impersonation required for V4 Signed URL (signBlob via IAM Credentials API)
run_iam_binding gcloud iam service-accounts add-iam-policy-binding "$SA_EMAIL" \
  --member="serviceAccount:${SA_EMAIL}" \
  --role="roles/iam.serviceAccountTokenCreator"

# ── Step 4.5: Upstash Redis DB (Upstash Management API, DP-4=A) ──────────────
echo ""
echo "=== Step 4.5: Upstash Redis ==="
_UPSTASH_DB_NAME="${SERVICE_NAME}-redis"
_UPSTASH_AUTH="Basic $(printf '%s:%s' "${UPSTASH_EMAIL}" "${UPSTASH_API_KEY}" | base64 -w0)"

# curl wrapper that SURFACES the API error instead of letting `curl -sf` swallow
# the body and abort silently under `set -e`. Prints the response body on 2xx;
# on any other status prints the HTTP code + body to stderr and returns 1.
# Usage: _upstash_api METHOD PATH [JSON_BODY]
_upstash_api() {
  local _method="$1" _path="$2" _body="${3:-}"
  local _curl=(curl -sS -X "$_method" -H "Authorization: ${_UPSTASH_AUTH}")
  [[ -n "$_body" ]] && _curl+=(-H "Content-Type: application/json" -d "$_body")
  local _out _code
  _out=$("${_curl[@]}" -w $'\n%{http_code}' "https://api.upstash.com${_path}") || {
    echo "ERROR: Upstash API ${_method} ${_path} — curl transport failure" >&2
    return 1
  }
  _code="${_out##*$'\n'}"   # last line = http_code
  _out="${_out%$'\n'*}"     # everything before it = body
  if [[ "$_code" != 2* ]]; then
    echo "ERROR: Upstash API ${_method} ${_path} failed (HTTP ${_code}):" >&2
    echo "       ${_out}" >&2
    return 1
  fi
  printf '%s' "$_out"
}

# Extract "password|endpoint|port" from a DB JSON object. password may be empty:
# create/reset-password responses include it; list/get responses omit it.
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
  _DB_PAYLOAD=$(printf '{"database_name":"%s","platform":"aws","primary_region":"%s","tls":true}' \
    "${_UPSTASH_DB_NAME}" "${UPSTASH_PRIMARY_REGION}")
  echo "[DRY-RUN] curl -X POST https://api.upstash.com/v2/redis/database -d '${_DB_PAYLOAD}'"
  REDIS_URL="rediss://<DRY_RUN_PLACEHOLDER>"
else
  # Locate an existing DB by name (list endpoint is PLURAL: /databases).
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
    # Create: POST /v2/redis/database (no /global suffix). Global tier is selected
    # by primary_region; keys are database_name/platform/primary_region. The create
    # response (unlike list/get) DOES include the password.
    _DB_PAYLOAD=$(printf '{"database_name":"%s","platform":"aws","primary_region":"%s","tls":true}' \
      "${_UPSTASH_DB_NAME}" "${UPSTASH_PRIMARY_REGION}")
    _DB_OBJ=$(_upstash_api POST /v2/redis/database "$_DB_PAYLOAD") || exit 1
    echo "  Created Upstash Redis DB: ${_UPSTASH_DB_NAME}"
  fi

  _DB_ID=$(printf '%s' "$_DB_OBJ" | python3 -c "import sys,json; print(json.load(sys.stdin).get('database_id',''))")
  _PARSED=$(printf '%s' "$_DB_OBJ" | _upstash_parse_db) || exit 1
  IFS='|' read -r _REDIS_PW _REDIS_EP _REDIS_PORT <<<"$_PARSED"

  # list/get omit the password. Reset it to obtain a usable credential — but only
  # when app-redis-url doesn't already hold one, so ordinary re-runs (e.g. re-running
  # setup to fix an unrelated step) don't rotate the live Redis password.
  _PRESERVE_SECRET=false
  if [[ -z "$_REDIS_PW" ]]; then
    if gcloud secrets describe "app-redis-url" --quiet 2>/dev/null; then
      echo "  Password not returned by list; app-redis-url secret already exists — preserving it."
      _PRESERVE_SECRET=true
    else
      echo "  Password not returned by list; resetting to obtain a credential..."
      [[ -z "$_DB_ID" ]] && { echo "ERROR: no database_id available to reset password" >&2; exit 1; }
      _RESET_OBJ=$(_upstash_api POST "/v2/redis/reset-password/${_DB_ID}") || exit 1
      _PARSED=$(printf '%s' "$_RESET_OBJ" | _upstash_parse_db) || exit 1
      IFS='|' read -r _REDIS_PW _REDIS_EP _REDIS_PORT <<<"$_PARSED"
    fi
  fi

  if [[ "$_PRESERVE_SECRET" == "true" ]]; then
    REDIS_URL=""   # leave the existing app-redis-url secret untouched in Step 5
  elif [[ -z "$_REDIS_PW" || -z "$_REDIS_EP" || -z "$_REDIS_PORT" ]]; then
    echo "ERROR: incomplete Upstash connection info (password/endpoint/port)." >&2
    echo "       DB object: ${_DB_OBJ}" >&2
    exit 1
  else
    REDIS_URL="rediss://:${_REDIS_PW}@${_REDIS_EP}:${_REDIS_PORT}"
    echo "  REDIS_URL set"
  fi
fi
export REDIS_URL

# ── Step 5: Secret Manager ────────────────────────────────────────────────────
echo ""
echo "=== Step 5: Secret Manager ==="

upsert_secret "app-database-url"        "$DATABASE_URL"
upsert_secret "app-direct-database-url" "$DIRECT_URL"
upsert_secret "app-nextauth-secret"     "$AUTH_SECRET"
upsert_secret "app-auth-secret"         "$AUTH_SECRET"
upsert_secret "app-gcs-bucket-name"     "$GCS_BUCKET"
upsert_secret "app-seed-admin-email"    "$SEED_ADMIN_EMAIL"
upsert_secret "app-seed-admin-password" "$SEED_ADMIN_PASSWORD"

if [[ -n "${REDIS_URL:-}" && "$REDIS_URL" != "rediss://<DRY_RUN_PLACEHOLDER>" ]]; then
  upsert_secret "app-redis-url" "$REDIS_URL"
else
  echo "  WARN: REDIS_URL not available — app-redis-url secret skipped (in-memory rate-limit fallback active)"
fi

# ── Step 6: GCS Bucket ────────────────────────────────────────────────────────
echo ""
echo "=== Step 6: GCS Bucket ==="
if gcloud storage buckets describe "gs://${GCS_BUCKET}" --quiet 2>/dev/null; then
  echo "[SKIP] GCS bucket gs://${GCS_BUCKET} already exists"
else
  # UBLA is enforced by org policy (constraints/storage.uniformBucketLevelAccess)
  # and required for production. Access is granted via bucket-level IAM below
  # (roles/storage.objectAdmin); uploads are served with V4 signed URLs, so no
  # object ACLs / public access are needed. Do NOT use --no-uniform-bucket-level-access.
  run gcloud storage buckets create "gs://${GCS_BUCKET}" \
    --location="$REGION" \
    --uniform-bucket-level-access
fi
# Always (re-)apply the IAM binding — idempotent. Also protected against IAM
# propagation lag: on a fast idempotent re-run (Steps 4.5/5 all hit their [SKIP]
# branches), only a few seconds elapse since SA creation in Step 4, which can
# still be inside the eventual-consistency window for the Storage API.
run_iam_binding gcloud storage buckets add-iam-policy-binding "gs://${GCS_BUCKET}" \
  --member="serviceAccount:${SA_EMAIL}" \
  --role=roles/storage.objectAdmin

# ── Done ──────────────────────────────────────────────────────────────────────
echo ""
echo "=== Infrastructure setup complete ==="
if [[ "$DRY_RUN" == "true" ]]; then
  echo "[DRY-RUN] Run without DRY_RUN=true to apply changes."
else
  echo ""
  echo "====================================================================="
  echo "  GCP infrastructure setup complete"
  echo "====================================================================="
  echo "  Next step: run gcp-deploy.sh to deploy the application."
  echo "====================================================================="
fi
