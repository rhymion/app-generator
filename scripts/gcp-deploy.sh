#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/gcp-env.sh"

# ─────────────────────────────────────────────────────────────────────────────
# NOTE: The service runs against Neon (DATABASE_URL = pooled endpoint for app
# runtime queries, DIRECT_URL = unpooled endpoint for the migrate Job), NOT
# Prisma Accelerate and NOT the retired Cloud SQL direct-socket path — see
# docs/knowledge/gcp-automation-design.md. The Accelerate wiring below is
# COMMENTED OUT (not deleted) so it can be revived if that link is ever fixed.
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
echo "  GCP deploy script (service + migrate: Neon)"
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
# Connects to Neon via DIRECT_URL (unpooled) — prisma.config.ts prefers
# DIRECT_URL over DATABASE_URL for the Prisma CLI, so `prisma migrate deploy`
# never runs through the pooled connection. See
# docs/knowledge/prisma-direct-vs-pooled-connection.md for why that matters
# (a transaction-mode pooler does not guarantee migration lock/DDL statements
# land on the same backend connection). DIRECT_URL MUST stay in this Job's
# --set-secrets list — dropping it would silently put migrations back on the
# pooled connection. The Job is (re)configured on every deploy so its
# image/command stay in sync; `create` covers a first-ever deploy (was Gap 2 —
# nothing previously created this Job, so `jobs update` failed with NOT_FOUND).
echo ""
echo "[Step 2] Ensuring app-migrate Job (prisma migrate deploy, Neon direct connection)..."
_MIGRATE_JOB_FLAGS=(
  --image="${MIGRATE_IMAGE_TAG}"
  --region="${REGION}"
  --service-account="${SA_EMAIL}"
  # SEED_ADMIN_EMAIL/PASSWORD are only read when this Job is temporarily
  # repointed at `npm run db:seed-baseline` by scripts/gcp-seed.sh — harmless
  # while the Job runs its normal `prisma migrate deploy` command. Attached
  # here (not in gcp-seed.sh) so the Job's env/secrets stay fully declared
  # by this one deploy step. See docs/knowledge/seed-baseline-credential-hardening.md.
  --set-secrets="DATABASE_URL=app-database-url:latest,DIRECT_URL=app-direct-database-url:latest,SEED_ADMIN_EMAIL=app-seed-admin-email:latest,SEED_ADMIN_PASSWORD=app-seed-admin-password:latest"
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
echo "[Step 3] Running prisma migrate deploy against Neon..."
run gcloud run jobs execute app-migrate --region="${REGION}" --wait
echo "  OK: Migration complete."

# ─── Step 4: Deploy Cloud Run service (Neon) ──────────────────────────────────
echo ""
echo "[Step 4] Deploying Cloud Run service (Neon)..."
# NOTE: AUTH_URL can't be set here — the service's URL isn't known until
# after this first deploy creates/updates it (Step 5 discovers it). Step 5.5
# below sets AUTH_URL once SERVICE_URL is known. AUTH_TRUST_HOST=true alone
# is NOT sufficient on Cloud Run (see Step 5.5's comment) — this used to say
# it was; that was wrong (cmd_1114).

# The service connects to Neon's pooled endpoint via DATABASE_URL.
# lib/prisma.ts takes the pooled (else) branch when PRISMA_DATABASE_URL is absent.
# To revive Accelerate, add PRISMA_DATABASE_URL=app-prisma-database-url:latest back
# to the --set-secrets list below (and re-enable the guard + Step 0 above).

# PRISMA_POOL_MAX forwarding: unset by default, which is correct for this
# script's own target (Neon's pooled endpoint) — lib/prisma-pool.ts's own
# default (5) is already sized for that shape, and forwarding nothing here
# leaves that default in effect. Only set PRISMA_POOL_MAX in
# .env.production.local (see gcp-env.sh) if DATABASE_URL above has been
# pointed at a direct/unpooled connection instead (e.g. a self-managed Cloud
# SQL instance) — without this forwarding, that env var would be set locally
# but silently never reach the deployed container, risking exceeding that
# instance's own max_connections. See docs/knowledge/prisma-pool-max-tuning.md.
_DEPLOY_ENV_VARS="AUTH_TRUST_HOST=true,NODE_ENV=production"
if [[ -n "${PRISMA_POOL_MAX:-}" ]]; then
  _DEPLOY_ENV_VARS="${_DEPLOY_ENV_VARS},PRISMA_POOL_MAX=${PRISMA_POOL_MAX}"
fi

run gcloud run deploy "${SERVICE_NAME}" \
  --image="${SERVICE_IMAGE_TAG}" \
  --region="${REGION}" \
  --service-account="${SA_EMAIL}" \
  --set-secrets=DATABASE_URL=app-database-url:latest,AUTH_SECRET=app-nextauth-secret:latest,GCS_BUCKET=app-gcs-bucket-name:latest,REDIS_URL=app-redis-url:latest \
  --set-env-vars="${_DEPLOY_ENV_VARS}" \
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
echo "  SERVICE_URL:  ${SERVICE_URL}"
# The bare origin above 404s: i18n middleware requires a locale-prefixed
# path (see proxy.ts) and there is no content at "/". Print a URL that
# actually resolves, same as the Vercel path already redirects to
# (verified: app-generator-sample.vercel.app/ -> 307 -> /en/login).
echo "  Login page:   ${SERVICE_URL}/en/login  (or /ja/login for Japanese)"
echo "================================================================="
echo ""

# ─── Step 5.5: Set AUTH_URL now that the service's stable URL is known ────────
# Confirmed by curling a live Cloud Run deployment (cmd_1114): Cloud Run's
# front end forwards the container's internal listening port (e.g. ":8080")
# in the Host header even on the public HTTPS (443) connection. proxy.ts's
# buildExternalUrl/normalizeIntlRedirect now correct for this on page-level
# redirects, but Auth.js's own /api/auth/* redirects (sign-out, etc.) build
# their URLs from AUTH_TRUST_HOST-driven header inference (x-forwarded-host
# ?? host), which inherits the exact same leak — AUTH_TRUST_HOST=true alone
# does not fix it. Setting AUTH_URL removes that header dependency entirely
# for Auth.js's own redirects, since AUTH_URL takes precedence over header
# inference in Auth.js core.
#
# The service's URL is stable across redeploys of the same service (it only
# changes if the service itself is deleted and recreated), so this update is
# idempotent and safe to run on every deploy — including right after Step 4
# creates the service for the very first time, once SERVICE_URL becomes
# knowable here in Step 5.
echo "[Step 5.5] Setting AUTH_URL=${SERVICE_URL}..."
run gcloud run services update "${SERVICE_NAME}" \
  --region="${REGION}" \
  --update-env-vars=AUTH_URL="${SERVICE_URL}"
echo "  OK: AUTH_URL set."
echo ""
