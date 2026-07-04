#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/gcp-env.sh"

# ─────────────────────────────────────────────────────────────────────────────
# NOTE: The service runs on the DIRECT SOCKET path (DATABASE_URL + Cloud SQL
# socket), NOT Prisma Accelerate. Accelerate has never successfully reached this
# Cloud SQL instance — it returns P1001 "Can't reach database server" even though
# the DB is reachable and the connection string is correct (verified 2026-07-03).
# The PoC "working" state was always the socket path. The Accelerate wiring below
# is COMMENTED OUT (not deleted) so it can be revived if that link is ever fixed.
# To revive Accelerate: uncomment the guard, Step 0, and the PRISMA_DATABASE_URL
# entry in the Step 4 --set-secrets list.
# ─────────────────────────────────────────────────────────────────────────────
# # Guard: PRISMA_DATABASE_URL must be set (Accelerate path).
# if [[ -z "${PRISMA_DATABASE_URL:-}" ]]; then
#   echo "ERROR: PRISMA_DATABASE_URL is not set." >&2
#   echo "" >&2
#   echo "  Steps:" >&2
#   echo "  1. Run gcp-setup.sh to obtain DATABASE_URL_PUBLIC" >&2
#   echo "  2. Register the connection in Prisma Console (https://console.prisma.io)" >&2
#   echo "  3. Set the issued prisma://... URL as PRISMA_DATABASE_URL" >&2
#   echo "     in .env.production.local" >&2
#   echo "  4. Re-run gcp-deploy.sh" >&2
#   exit 1
# fi

DRY_RUN=${DRY_RUN:-false}

run() {
  if [[ "$DRY_RUN" == "true" ]]; then
    echo "[DRY-RUN] $*"
  else
    "$@"
  fi
}

# ─── Step 0: Register app-prisma-database-url secret (Accelerate — DISABLED) ──
# Commented out with the Accelerate path. Revive alongside the guard + Step 4 entry.
# echo "[Step 0] Registering app-prisma-database-url secret..."
# if gcloud secrets describe app-prisma-database-url \
#     --project="${PROJECT_ID}" 2>/dev/null; then
#   echo "${PRISMA_DATABASE_URL}" | \
#     run gcloud secrets versions add app-prisma-database-url \
#       --data-file=- --project="${PROJECT_ID}"
# else
#   echo "${PRISMA_DATABASE_URL}" | \
#     run gcloud secrets create app-prisma-database-url \
#       --data-file=- --replication-policy=automatic --project="${PROJECT_ID}"
# fi
# echo "  OK: app-prisma-database-url secret registered."

echo ""
echo "================================================================="
echo "  GCP deploy script (service + migrate: direct Cloud SQL socket)"
echo "================================================================="
echo "  PROJECT_ID   : ${PROJECT_ID}"
echo "  SERVICE_NAME : ${SERVICE_NAME}"
echo "  REGION       : ${REGION}"
echo "================================================================="
echo ""

# ─── Step 1: Build + push BOTH images from the one multi-stage Dockerfile ──────
# The service and the migration Job need different images out of the same build:
#   - service image : final "runner" stage — slim (Next.js standalone + `node server.js`).
#                     It does NOT contain the Prisma CLI or full node_modules.
#   - migrate image : "builder" stage — full node_modules + Prisma CLI + schema +
#                     prisma/migrations/. `prisma migrate deploy` REQUIRES this; the
#                     slim runner cannot run migrations.
# Both are tagged with the same timestamp so a deploy is traceable to one build.
echo "[Step 1] Building and pushing service + migrate images..."
BUILD_TS="$(date +%Y%m%d-%H%M%S)"
SERVICE_IMAGE_TAG="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO_NAME}/${SERVICE_NAME}:${BUILD_TS}"
MIGRATE_IMAGE_TAG="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO_NAME}/${SERVICE_NAME}-migrate:${BUILD_TS}"
echo "  SERVICE_IMAGE_TAG: ${SERVICE_IMAGE_TAG}"
echo "  MIGRATE_IMAGE_TAG: ${MIGRATE_IMAGE_TAG}"

gcloud auth configure-docker "${REGION}-docker.pkg.dev" --quiet

PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

# migrate image (builder stage) — carries prisma/migrations/* and the Prisma CLI
run docker build -f "${PROJECT_ROOT}/Dockerfile" --target builder \
  -t "${MIGRATE_IMAGE_TAG}" "${PROJECT_ROOT}"
run docker push "${MIGRATE_IMAGE_TAG}"

# service image (default final "runner" stage)
run docker build -f "${PROJECT_ROOT}/Dockerfile" \
  -t "${SERVICE_IMAGE_TAG}" "${PROJECT_ROOT}"
run docker push "${SERVICE_IMAGE_TAG}"

echo "  OK: Images pushed."

# ─── Step 2: Ensure the app-migrate Job exists, pointed at the migrate image ───
# Production migration strategy = `prisma migrate deploy`:
#   * forward-only; applies the committed migration files under prisma/migrations/
#   * NEVER drops data (unlike `db push --accept-data-loss`)
# Connects to Cloud SQL via DIRECT SOCKET (DATABASE_URL secret), NOT Accelerate —
# Accelerate cannot execute DDL. The Job is (re)configured on every deploy so its
# image/command stay in sync; `create` covers a first-ever deploy (was Gap 2 —
# nothing previously created this Job, so `jobs update` failed with NOT_FOUND).
echo ""
echo "[Step 2] Ensuring app-migrate Job (prisma migrate deploy, direct socket)..."
_MIGRATE_JOB_FLAGS=(
  --image="${MIGRATE_IMAGE_TAG}"
  --region="${REGION}"
  --service-account="${SA_EMAIL}"
  --set-cloudsql-instances="${CLOUD_SQL_CONNECTION_NAME}"
  --set-secrets="DATABASE_URL=app-database-url:latest"
  --command="npx"
  --args="prisma,migrate,deploy"
)
if gcloud run jobs describe app-migrate --region="${REGION}" &>/dev/null; then
  echo "  Updating existing app-migrate Job..."
  run gcloud run jobs update app-migrate "${_MIGRATE_JOB_FLAGS[@]}"
else
  echo "  Creating app-migrate Job..."
  run gcloud run jobs create app-migrate "${_MIGRATE_JOB_FLAGS[@]}"
fi
echo "  OK: app-migrate Job ready."

# ─── Step 3: Migrate the live DB BEFORE rolling out new code ──────────────────
# Ordering matters for a production DB that is serving traffic:
#   1. migrate deploy  (this step)  → schema is advanced while old revision runs
#   2. deploy service  (Step 4)     → new code goes live against the ready schema
# If the migration fails, `--wait` returns non-zero and `set -e` stops the script
# here, so the new revision is never rolled out onto an un-migrated DB.
#
# Write EXPAND-then-CONTRACT migrations: additive/backward-compatible changes only
# per deploy, so the currently-running revision keeps working against the new
# schema. Do destructive changes (drop column/table) in a LATER deploy, after the
# revisions that depended on them have drained.
echo ""
echo "[Step 3] Running prisma migrate deploy against Cloud SQL..."
run gcloud run jobs execute app-migrate --region="${REGION}" --wait
echo "  OK: Migration complete."

# ─── Step 4: Deploy Cloud Run service (direct Cloud SQL socket) ───────────────
echo ""
echo "[Step 4] Deploying Cloud Run service (direct Cloud SQL socket)..."
echo "  NOTE: AUTH_URL is excluded (AUTH_TRUST_HOST=true is sufficient)"

# The service connects via the mounted /cloudsql socket using DATABASE_URL.
# lib/prisma.ts takes the socket (else) branch when PRISMA_DATABASE_URL is absent.
# To revive Accelerate, add PRISMA_DATABASE_URL=app-prisma-database-url:latest back
# to the --set-secrets list below (and re-enable the guard + Step 0 above).
run gcloud run deploy "${SERVICE_NAME}" \
  --image="${SERVICE_IMAGE_TAG}" \
  --region="${REGION}" \
  --service-account="${SA_EMAIL}" \
  --add-cloudsql-instances="${PROJECT_ID}:${REGION}:${INSTANCE_NAME}" \
  --set-secrets=DATABASE_URL=app-database-url:latest,AUTH_SECRET=app-nextauth-secret:latest,GCS_BUCKET=app-gcs-bucket-name:latest,REDIS_URL=app-redis-url:latest \
  --set-env-vars=AUTH_TRUST_HOST=true,NODE_ENV=production \
  --no-invoker-iam-check \
  --min-instances=0 \
  --max-instances=10

echo "  OK: Cloud Run service deployed."

# ─── Step 5: Show SERVICE_URL ─────────────────────────────────────────────────
echo ""
echo "[Step 5] Retrieving service URL..."
SERVICE_URL=$(gcloud run services describe "${SERVICE_NAME}" \
  --region="${REGION}" \
  --format='value(status.url)')

echo ""
echo "================================================================="
echo "  Deploy complete"
echo "  SERVICE_URL: ${SERVICE_URL}"
echo "================================================================="
echo ""
