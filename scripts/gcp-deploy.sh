#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/gcp-env.sh"

# Guard: PRISMA_DATABASE_URL must be set (complete the manual Prisma Console step first)
if [[ -z "${PRISMA_DATABASE_URL:-}" ]]; then
  echo "ERROR: PRISMA_DATABASE_URL is not set." >&2
  echo "" >&2
  echo "  Steps:" >&2
  echo "  1. Run gcp-setup.sh to obtain DATABASE_URL_PUBLIC" >&2
  echo "  2. Register the connection in Prisma Console (https://console.prisma.io)" >&2
  echo "  3. Set the issued prisma+postgres://... URL as PRISMA_DATABASE_URL" >&2
  echo "     in .env.production.local" >&2
  echo "  4. Re-run gcp-deploy.sh" >&2
  exit 1
fi

DRY_RUN=${DRY_RUN:-false}

run() {
  if [[ "$DRY_RUN" == "true" ]]; then
    echo "[DRY-RUN] $*"
  else
    "$@"
  fi
}

# ─── Step 0: Register app-prisma-database-url secret ─────────────────────────
echo "[Step 0] Registering app-prisma-database-url secret..."
if gcloud secrets describe app-prisma-database-url \
    --project="${PROJECT_ID}" 2>/dev/null; then
  echo "${PRISMA_DATABASE_URL}" | \
    run gcloud secrets versions add app-prisma-database-url \
      --data-file=- --project="${PROJECT_ID}"
else
  echo "${PRISMA_DATABASE_URL}" | \
    run gcloud secrets create app-prisma-database-url \
      --data-file=- --replication-policy=automatic --project="${PROJECT_ID}"
fi
echo "  OK: app-prisma-database-url secret registered."

echo ""
echo "================================================================="
echo "  GCP re-deploy script (Accelerate path)"
echo "================================================================="
echo "  PROJECT_ID   : ${PROJECT_ID}"
echo "  SERVICE_NAME : ${SERVICE_NAME}"
echo "  REGION       : ${REGION}"
echo "================================================================="
echo ""

# ─── Step 1: docker build + push ──────────────────────────────────────────────
echo "[Step 1] Building and pushing Docker image..."

IMAGE_TAG="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO_NAME}/${SERVICE_NAME}:$(date +%Y%m%d-%H%M%S)"
echo "  IMAGE_TAG: ${IMAGE_TAG}"

gcloud auth configure-docker "${REGION}-docker.pkg.dev" --quiet

PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
run docker build -f "${PROJECT_ROOT}/Dockerfile" -t "${IMAGE_TAG}" "${PROJECT_ROOT}"
run docker push "${IMAGE_TAG}"

echo "  OK: Image pushed."

# ─── Step 2: Cloud Run deploy ─────────────────────────────────────────────────
echo ""
echo "[Step 2] Deploying Cloud Run service (Accelerate path)..."
echo "  NOTE: AUTH_URL is excluded (AUTH_TRUST_HOST=true is sufficient)"

run gcloud run deploy "${SERVICE_NAME}" \
  --image="${IMAGE_TAG}" \
  --region="${REGION}" \
  --service-account="${SA_EMAIL}" \
  --add-cloudsql-instances="${PROJECT_ID}:${REGION}:${INSTANCE_NAME}" \
  --set-secrets=PRISMA_DATABASE_URL=app-prisma-database-url:latest,DATABASE_URL=app-database-url:latest,AUTH_SECRET=app-nextauth-secret:latest,GCS_BUCKET=app-gcs-bucket-name:latest,REDIS_URL=app-redis-url:latest \
  --set-env-vars=AUTH_TRUST_HOST=true,NODE_ENV=production \
  --no-invoker-iam-check \
  --min-instances=0 \
  --max-instances=10

echo "  OK: Cloud Run service deployed."

# ─── Step 3: Update and execute migrate Job ───────────────────────────────────
echo ""
echo "[Step 3] Updating and executing migrate Job..."

run gcloud run jobs update app-migrate \
  --image="${IMAGE_TAG}" \
  --region="${REGION}"

run gcloud run jobs execute app-migrate \
  --region="${REGION}" \
  --wait

echo "  OK: Migration complete."

# ─── Step 4: Show SERVICE_URL ─────────────────────────────────────────────────
echo ""
echo "[Step 4] Retrieving service URL..."
SERVICE_URL=$(gcloud run services describe "${SERVICE_NAME}" \
  --region="${REGION}" \
  --format='value(status.url)')

echo ""
echo "================================================================="
echo "  Deploy complete"
echo "  SERVICE_URL: ${SERVICE_URL}"
echo "================================================================="
echo ""
