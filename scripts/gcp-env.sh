#!/usr/bin/env bash
# Source this file to set all GCP variables needed by gcp-setup.sh and gcp-deploy.sh.
# Usage: source "$(dirname "${BASH_SOURCE[0]}")/gcp-env.sh"
set -euo pipefail

_SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
_ENV_FILE="${_SCRIPT_DIR}/../.env.production.local"

if [[ -f "$_ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$_ENV_FILE"
  set +a
else
  echo "ERROR: .env.production.local not found at ${_ENV_FILE}" >&2
  echo "  Copy .env.production.local.example to .env.production.local and fill in values." >&2
  exit 1
fi

# Defaults for optional config (override in .env.production.local if needed)
REGION="${REGION:-asia-northeast1}"
SERVICE_NAME="${SERVICE_NAME:-app}"
INSTANCE_NAME="${INSTANCE_NAME:-app-pg16}"
DB_NAME="${DB_NAME:-appdb}"
SA_NAME="${SA_NAME:-app-cloud-run-sa}"
REPO_NAME="${REPO_NAME:-app-generator}"

# PROJECT_ID: prefer .env.production.local, fall back to gcloud config
PROJECT_ID="${PROJECT_ID:-$(gcloud config get-value project 2>/dev/null || true)}"
gcloud config set project "${PROJECT_ID}" &>/dev/null || true

# Required variables — abort with a clear message if missing
: "${PROJECT_ID:?PROJECT_ID is required — set in .env.production.local or run: gcloud config set project YOUR_PROJECT_ID}"
# DB_PASSWORD: generate-once-persist (if unset, generates and writes back to .env.production.local)
if [[ -z "${DB_PASSWORD:-}" ]]; then
  if [[ "${DRY_RUN:-false}" == "true" ]]; then
    echo "[DRY-RUN] DB_PASSWORD not set — will generate with openssl rand -hex 16 and save to .env.production.local at runtime"
    DB_PASSWORD="<DRY_RUN_DB_PASSWORD>"
  else
    DB_PASSWORD=$(openssl rand -hex 16)
    if grep -q "^DB_PASSWORD=" "${_ENV_FILE}" 2>/dev/null; then
      sed -i "s|^DB_PASSWORD=.*|DB_PASSWORD=${DB_PASSWORD}|" "${_ENV_FILE}"
    else
      echo "DB_PASSWORD=${DB_PASSWORD}" >> "${_ENV_FILE}"
    fi
    echo "[INFO] DB_PASSWORD generated and saved to .env.production.local"
  fi
  export DB_PASSWORD
fi

# AUTH_SECRET: generate-once-persist (if unset, generates and writes back to .env.production.local)
if [[ -z "${AUTH_SECRET:-}" ]]; then
  if [[ "${DRY_RUN:-false}" == "true" ]]; then
    echo "[DRY-RUN] AUTH_SECRET not set — will generate with openssl rand -base64 32 and save to .env.production.local at runtime"
    AUTH_SECRET="<DRY_RUN_AUTH_SECRET>"
  else
    AUTH_SECRET=$(openssl rand -base64 32)
    if grep -q "^AUTH_SECRET=" "${_ENV_FILE}" 2>/dev/null; then
      sed -i "s|^AUTH_SECRET=.*|AUTH_SECRET=${AUTH_SECRET}|" "${_ENV_FILE}"
    else
      echo "AUTH_SECRET=${AUTH_SECRET}" >> "${_ENV_FILE}"
    fi
    echo "[INFO] AUTH_SECRET generated and saved to .env.production.local"
  fi
  export AUTH_SECRET
fi
: "${UPSTASH_EMAIL:?UPSTASH_EMAIL is required — set in .env.production.local}"
: "${UPSTASH_API_KEY:?UPSTASH_API_KEY is required — set in .env.production.local}"

# Optional: needed for Step 5 Accelerate secret (obtained via the manual
# Prisma Accelerate step printed by gcp-setup.sh Step 3, if used)
PRISMA_ACCELERATE_API_KEY="${PRISMA_ACCELERATE_API_KEY:-}"

# Cloud SQL authorized networks (Step 3). Default 0.0.0.0/0 is open-to-internet —
# acceptable for PoC (guarded by ENCRYPTED_ONLY SSL + strong password), NOT for
# production with real customer data.
#
# Production hardening (do this before customer launch):
#   1. Upgrade Prisma to Pro/Business and enable "Static IP" on the Accelerate
#      environment (Network restrictions). Note: Static IP cannot be toggled on an
#      existing env — create a new Accelerate env with the same DB URL, which
#      rotates PRISMA_ACCELERATE_API_KEY / PRISMA_DATABASE_URL.
#   2. Prisma provides a fixed list of egress IPs. Set them here, e.g.:
#      SQL_AUTHORIZED_NETWORKS="203.0.113.10/32,203.0.113.11/32"
# Comma-separated CIDR list; passed verbatim to `gcloud sql instances patch`.
SQL_AUTHORIZED_NETWORKS="${SQL_AUTHORIZED_NETWORKS:-0.0.0.0/0}"

# Upstash global DB primary region (Step 4.5). AWS-style region name; the DB is
# created as global tier. ap-northeast-1 (Tokyo) is closest to GCP asia-northeast1.
UPSTASH_PRIMARY_REGION="${UPSTASH_PRIMARY_REGION:-ap-northeast-1}"

# Derived variables (require a working gcloud pointing at PROJECT_ID)
SA_EMAIL="${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
GCS_BUCKET="${GCS_BUCKET:-${PROJECT_ID}-app-uploads}"
CLOUD_SQL_CONNECTION_NAME="${PROJECT_ID}:${REGION}:${INSTANCE_NAME}"
IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO_NAME}/${SERVICE_NAME}:latest"
MIGRATE_IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO_NAME}/${SERVICE_NAME}-migrate:latest"

# Direct socket URL for migrate/seed Jobs (Cloud Run Auth Proxy)
DATABASE_URL="postgresql://postgres:${DB_PASSWORD}@localhost/${DB_NAME}?host=/cloudsql/${CLOUD_SQL_CONNECTION_NAME}"

# Populated in gcp-setup.sh Step 3 (Cloud SQL public IP for Accelerate registration prompt)
CLOUD_SQL_PUBLIC_IP="${CLOUD_SQL_PUBLIC_IP:-}"
# Populated in gcp-setup.sh Step 4.5 (Upstash Redis TLS URL)
REDIS_URL="${REDIS_URL:-}"

export PROJECT_ID REGION SERVICE_NAME INSTANCE_NAME DB_NAME DB_PASSWORD
export SA_NAME SA_EMAIL REPO_NAME GCS_BUCKET CLOUD_SQL_CONNECTION_NAME
export IMAGE MIGRATE_IMAGE DATABASE_URL CLOUD_SQL_PUBLIC_IP REDIS_URL
export AUTH_SECRET UPSTASH_EMAIL UPSTASH_API_KEY PRISMA_ACCELERATE_API_KEY
export SQL_AUTHORIZED_NETWORKS UPSTASH_PRIMARY_REGION
