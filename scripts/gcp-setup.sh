#!/usr/bin/env bash
# GCP environment setup for the generated app (Cloud Run + Cloud SQL + Accelerate + Upstash).
# Implements runbook §1-0.5 through §1-7 with idempotency on every step.
#
# Usage:
#   ./scripts/gcp-setup.sh             # live run
#   DRY_RUN=true ./scripts/gcp-setup.sh  # echo all write commands, no GCP changes
#
# Prerequisites: gcloud CLI, curl, docker
# Must run after: scripts/gcp-deploy.sh (builds and pushes Docker images)
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

# ── Step 3: Cloud SQL (PostgreSQL 16) ────────────────────────────────────────
echo ""
echo "=== Step 3: Cloud SQL ==="
if gcloud sql instances describe "$INSTANCE_NAME" --quiet 2>/dev/null; then
  echo "[SKIP] Cloud SQL instance ${INSTANCE_NAME} already exists"
else
  run gcloud sql instances create "$INSTANCE_NAME" \
    --database-version=POSTGRES_16 \
    --tier=db-f1-micro \
    --edition=ENTERPRISE \
    --region="$REGION" \
    --storage-type=SSD \
    --storage-size=10GB \
    --no-backup
fi

if gcloud sql databases describe "$DB_NAME" --instance="$INSTANCE_NAME" --quiet 2>/dev/null; then
  echo "[SKIP] Database ${DB_NAME} already exists"
else
  run gcloud sql databases create "$DB_NAME" --instance="$INSTANCE_NAME"
fi

run gcloud sql users set-password postgres \
  --instance="$INSTANCE_NAME" \
  --password="$DB_PASSWORD"

# Enable public IP + SSL so Prisma Accelerate can reach Cloud SQL externally (DP-2=A)
run gcloud sql instances patch "$INSTANCE_NAME" \
  --authorized-networks=0.0.0.0/0 \
  --ssl-mode=ENCRYPTED_ONLY

if [[ "$DRY_RUN" != "true" ]]; then
  CLOUD_SQL_PUBLIC_IP=$(gcloud sql instances describe "$INSTANCE_NAME" \
    --format="value(ipAddresses[0].ipAddress)")
  echo "Cloud SQL Public IP: ${CLOUD_SQL_PUBLIC_IP}"
  echo ""
  echo "  ⚠ Manual step required (runbook §1-3.5):"
  echo "    Go to https://console.prisma.io → New project → Accelerate"
  echo "    Connection string: postgresql://postgres:${DB_PASSWORD}@${CLOUD_SQL_PUBLIC_IP}:5432/${DB_NAME}?sslmode=require"
  echo "    Copy the API key and set PRISMA_ACCELERATE_API_KEY in .env.production.local, then re-run."
else
  echo "[DRY-RUN] Would retrieve Cloud SQL public IP and prompt for Prisma Accelerate setup"
fi

# ── Step 4: Service Account + IAM ────────────────────────────────────────────
echo ""
echo "=== Step 4: Service Account ==="
if gcloud iam service-accounts describe "$SA_EMAIL" --quiet 2>/dev/null; then
  echo "[SKIP] Service account ${SA_EMAIL} already exists"
else
  run gcloud iam service-accounts create "$SA_NAME" \
    --display-name="App Cloud Run SA"
fi

run gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${SA_EMAIL}" \
  --role="roles/cloudsql.client" \
  --condition=None

run gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${SA_EMAIL}" \
  --role="roles/secretmanager.secretAccessor" \
  --condition=None

# GCS objectAdmin at bucket level (avoids UBLA + condition mismatch issues)
# Bucket may not exist yet; this binding is re-applied after Step 6 as well.
# Self-impersonation required for V4 Signed URL (signBlob via IAM Credentials API)
run gcloud iam service-accounts add-iam-policy-binding "$SA_EMAIL" \
  --member="serviceAccount:${SA_EMAIL}" \
  --role="roles/iam.serviceAccountTokenCreator"

# ── Step 4.5: Upstash Redis DB (Upstash Management API, DP-4=A) ──────────────
echo ""
echo "=== Step 4.5: Upstash Redis ==="
_UPSTASH_DB_NAME="${SERVICE_NAME}-redis"
_UPSTASH_AUTH="Basic $(printf '%s:%s' "${UPSTASH_EMAIL}" "${UPSTASH_API_KEY}" | base64 -w0)"

_EXISTING_DBS=$(curl -sf \
  -H "Authorization: ${_UPSTASH_AUTH}" \
  "https://api.upstash.com/v2/redis/database" 2>/dev/null || echo '[]')

if echo "$_EXISTING_DBS" | python3 -c "
import sys, json
data = json.load(sys.stdin)
dbs = data if isinstance(data, list) else []
sys.exit(0 if any(db.get('database_name') == sys.argv[1] for db in dbs) else 1)
" "${_UPSTASH_DB_NAME}" 2>/dev/null; then
  echo "[SKIP] Upstash Redis DB ${_UPSTASH_DB_NAME} already exists"
  if [[ "$DRY_RUN" != "true" ]]; then
    REDIS_URL=$(echo "$_EXISTING_DBS" | python3 -c "
import sys, json
data = json.load(sys.stdin)
dbs = data if isinstance(data, list) else []
for db in dbs:
    if db.get('database_name') == sys.argv[1]:
        print('rediss://:{}@{}:{}'.format(db['password'], db['endpoint'], db['port']))
        break
" "${_UPSTASH_DB_NAME}")
    echo "  REDIS_URL retrieved from existing DB"
  fi
else
  _DB_PAYLOAD=$(printf '{"name":"%s","region":"global","tls":true}' "${_UPSTASH_DB_NAME}")
  if [[ "$DRY_RUN" == "true" ]]; then
    echo "[DRY-RUN] curl -X POST https://api.upstash.com/v2/redis/database/global -d '${_DB_PAYLOAD}'"
    REDIS_URL="rediss://<DRY_RUN_PLACEHOLDER>"
  else
    _UPSTASH_RESPONSE=$(curl -sf -X POST \
      -H "Authorization: ${_UPSTASH_AUTH}" \
      -H "Content-Type: application/json" \
      -d "$_DB_PAYLOAD" \
      "https://api.upstash.com/v2/redis/database/global")
    REDIS_URL=$(echo "$_UPSTASH_RESPONSE" | python3 -c "
import sys, json
db = json.load(sys.stdin)
print('rediss://:{}@{}:{}'.format(db['password'], db['endpoint'], db['port']))
")
    echo "  Created Upstash Redis DB: ${_UPSTASH_DB_NAME}"
    echo "  REDIS_URL set"
  fi
fi
export REDIS_URL

# ── Step 5: Secret Manager ────────────────────────────────────────────────────
echo ""
echo "=== Step 5: Secret Manager ==="

upsert_secret "app-database-url"        "$DATABASE_URL"
upsert_secret "app-nextauth-secret"     "$AUTH_SECRET"
upsert_secret "app-auth-secret"         "$AUTH_SECRET"
upsert_secret "app-gcs-bucket-name"     "$GCS_BUCKET"

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
  run gcloud storage buckets create "gs://${GCS_BUCKET}" \
    --location="$REGION" \
    --no-uniform-bucket-level-access
fi
# Always (re-)apply the IAM binding — idempotent
run gcloud storage buckets add-iam-policy-binding "gs://${GCS_BUCKET}" \
  --member="serviceAccount:${SA_EMAIL}" \
  --role=roles/storage.objectAdmin

# ── Done ──────────────────────────────────────────────────────────────────────
echo ""
echo "=== Infrastructure setup complete ==="
if [[ "$DRY_RUN" == "true" ]]; then
  echo "[DRY-RUN] Run without DRY_RUN=true to apply changes."
fi

# ── Next steps: manual Prisma Console break ──────────────────────────────────
if [[ "$DRY_RUN" != "true" ]]; then
  echo ""
  echo "====================================================================="
  echo "  GCP infrastructure setup complete"
  echo "====================================================================="
  echo ""
  echo "  Next steps (manual): Obtain Prisma Accelerate URL"
  echo ""
  echo "  1. Register the following DATABASE_URL_PUBLIC in Prisma Console:"
  echo "     https://console.prisma.io"
  echo ""
  DATABASE_URL_PUBLIC="postgresql://postgres:${DB_PASSWORD}@${CLOUD_SQL_PUBLIC_IP}/${DB_NAME}"
  echo "     DATABASE_URL_PUBLIC=${DATABASE_URL_PUBLIC}"
  echo ""
  echo "  2. Verify the connection in Prisma Console, then set the issued"
  echo "     prisma+postgres://... URL as PRISMA_DATABASE_URL in .env.production.local"
  echo ""
  echo "  3. Run gcp-deploy.sh to deploy the application"
  echo "====================================================================="
fi
