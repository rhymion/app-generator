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
  echo "  Copy .env.gcp.production.local.example to .env.production.local and fill in values." >&2
  exit 1
fi

# Defaults for optional config (override in .env.production.local if needed)
REGION="${REGION:-asia-northeast1}"
SERVICE_NAME="${SERVICE_NAME:-app}"
SA_NAME="${SA_NAME:-app-cloud-run-sa}"
REPO_NAME="${REPO_NAME:-app-generator}"

# PROJECT_ID: prefer .env.production.local, fall back to gcloud config.
# The fallback used to be silent, which let a stale ambient `gcloud config`
# project (left over from an unrelated earlier session) get used without any
# visible sign that PROJECT_ID had not actually been set here — see
# docs/knowledge/gcp-automation-design.md for the incident this caused.
if [[ -z "${PROJECT_ID:-}" ]]; then
  PROJECT_ID="$(gcloud config get-value project 2>/dev/null || true)"
  if [[ -n "$PROJECT_ID" ]]; then
    echo "WARNING: PROJECT_ID not set in .env.production.local — falling back to the ambient gcloud CLI project '${PROJECT_ID}'." >&2
    echo "  If this is not the project you intend to deploy to, set PROJECT_ID explicitly in .env.production.local, or run: gcloud config set project YOUR_PROJECT_ID" >&2
  fi
fi
gcloud config set project "${PROJECT_ID}" &>/dev/null || true

# Required variables — abort with a clear message if missing
: "${PROJECT_ID:?PROJECT_ID is required — set in .env.production.local or run: gcloud config set project YOUR_PROJECT_ID}"
# DATABASE_URL / DIRECT_URL: Neon connection strings. Reuse the values this
# repo's own scripts/vercel-setup.sh already wrote into this SAME
# .env.production.local (DATABASE_URL_PROD / DATABASE_URL_UNPOOLED_PROD) if a
# Vercel deployment for the same app was already set up — no manual Neon
# console lookup needed in that case. This script still does not provision
# Neon itself: if neither a manual value nor a prior Vercel setup exists,
# obtain both from the Neon console (or run scripts/vercel-setup.sh first to
# get-or-create the Neon project automatically). DATABASE_URL is the pooled
# (PgBouncer) endpoint for app runtime queries; DIRECT_URL is the unpooled
# endpoint required by the migrate Job's `prisma migrate deploy` — see
# docs/knowledge/prisma-direct-vs-pooled-connection.md for why a pooled
# connection must never run migrations.
DATABASE_URL="${DATABASE_URL:-${DATABASE_URL_PROD:-}}"
DIRECT_URL="${DIRECT_URL:-${DATABASE_URL_UNPOOLED_PROD:-}}"
: "${DATABASE_URL:?DATABASE_URL is required — set in .env.production.local (Neon pooled connection string), or run scripts/vercel-setup.sh first to derive DATABASE_URL_PROD automatically}"
: "${DIRECT_URL:?DIRECT_URL is required — set in .env.production.local (Neon direct/unpooled connection string, used by the app-migrate Job; see docs/knowledge/prisma-direct-vs-pooled-connection.md), or run scripts/vercel-setup.sh first to derive DATABASE_URL_UNPOOLED_PROD automatically}"

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
# SEED_ADMIN_EMAIL/PASSWORD: the bootstrap admin login scripts/gcp-seed.sh's
# app-migrate Job creates via `npm run db:seed-baseline` (NODE_ENV=production,
# baked into the Dockerfile). Required, not generated — these represent an
# operator's actual admin login, not a random secret — same as
# UPSTASH_EMAIL/UPSTASH_API_KEY above. Without this, seed-baseline.ts's own
# fail-fast guard (scripts/seed-baseline-credentials.ts) would reject every
# `gcp-seed.sh` run. See docs/knowledge/seed-baseline-credential-hardening.md.
: "${SEED_ADMIN_EMAIL:?SEED_ADMIN_EMAIL is required — set in .env.production.local (bootstrap admin login; see docs/knowledge/seed-baseline-credential-hardening.md)}"
: "${SEED_ADMIN_PASSWORD:?SEED_ADMIN_PASSWORD is required — set in .env.production.local (bootstrap admin login; see docs/knowledge/seed-baseline-credential-hardening.md)}"

# Optional: Prisma Accelerate retirement is a separate, unrelated concern —
# left as-is, out of scope for the Cloud SQL→Neon reconnection this file
# otherwise covers.
PRISMA_ACCELERATE_API_KEY="${PRISMA_ACCELERATE_API_KEY:-}"

# Upstash global DB primary region (Step 4.5). AWS-style region name; the DB is
# created as global tier. ap-northeast-1 (Tokyo) is closest to GCP asia-northeast1.
UPSTASH_PRIMARY_REGION="${UPSTASH_PRIMARY_REGION:-ap-northeast-1}"

# Derived variables (require a working gcloud pointing at PROJECT_ID)
SA_EMAIL="${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
GCS_BUCKET="${GCS_BUCKET:-${PROJECT_ID}-app-uploads}"
IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO_NAME}/${SERVICE_NAME}:latest"
MIGRATE_IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO_NAME}/${SERVICE_NAME}-migrate:latest"

# Populated in gcp-setup.sh Step 4.5 (Upstash Redis TLS URL)
REDIS_URL="${REDIS_URL:-}"

export PROJECT_ID REGION SERVICE_NAME
export SA_NAME SA_EMAIL REPO_NAME GCS_BUCKET
export IMAGE MIGRATE_IMAGE DATABASE_URL DIRECT_URL REDIS_URL
export AUTH_SECRET UPSTASH_EMAIL UPSTASH_API_KEY PRISMA_ACCELERATE_API_KEY
export SEED_ADMIN_EMAIL SEED_ADMIN_PASSWORD
export UPSTASH_PRIMARY_REGION
