#!/usr/bin/env bash
# One-time database seeding via the existing app-migrate Cloud Run Job.
#
# Sequence (runbook §1-7 "db:seed-tenant"):
#   1. Repoint app-migrate to `npm run db:seed-tenant`
#   2. Execute the Job and wait
#   3. Restore app-migrate to its normal command `npx prisma migrate deploy`
#      (NOT `db push` — the production strategy is migrate deploy)
#
# The Job is reused because its builder-stage image already carries tsx + the
# seed script, and its DATABASE_URL (direct socket) wiring. Step 3 runs via an
# EXIT trap so the Job is always restored, even if seeding fails.
#
# Prerequisite: gcp-deploy.sh has run at least once (it creates the app-migrate
# Job with the socket DATABASE_URL secret and Cloud SQL instance attached).
#
# Seeds (idempotent): pg_trgm extension, default tenant (id/slug=default),
# admin user admin@example.com / password123. Required once before signup works,
# otherwise signup fails with a user_tenant_id_fkey FK violation.
#
# Usage:
#   ./scripts/gcp-seed.sh              # live run
#   DRY_RUN=true ./scripts/gcp-seed.sh # echo write commands, no changes
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/gcp-env.sh"

DRY_RUN=${DRY_RUN:-false}
run() {
  if [[ "$DRY_RUN" == "true" ]]; then
    echo "[DRY-RUN] $*"
  else
    "$@"
  fi
}

JOB=app-migrate

# Guard: the Job must already exist (created by gcp-deploy.sh). Skipped in DRY_RUN
# so the plan can be previewed without credentials.
if [[ "$DRY_RUN" != "true" ]] && ! gcloud run jobs describe "$JOB" --region="${REGION}" &>/dev/null; then
  echo "ERROR: Cloud Run Job '${JOB}' not found in ${REGION}." >&2
  echo "  Run scripts/gcp-deploy.sh first — it creates the Job and its DB wiring." >&2
  exit 1
fi

# Always restore the Job to its normal migrate-deploy command on exit — even if
# seeding fails — so the Job is never left stuck on the seed command.
restore_migrate_command() {
  echo ""
  echo "[Step 3] Restoring ${JOB} to 'npx prisma migrate deploy'..."
  run gcloud run jobs update "$JOB" \
    --region="${REGION}" \
    --command="npx" \
    --args="prisma,migrate,deploy"
  echo "  OK: ${JOB} restored."
}
trap restore_migrate_command EXIT

echo "=== Database seeding via the ${JOB} Job ==="
echo "  REGION: ${REGION}"
echo ""

# Step 1: repoint the Job to the seed command.
echo "[Step 1] Updating ${JOB} to 'npm run db:seed-tenant'..."
run gcloud run jobs update "$JOB" \
  --region="${REGION}" \
  --command="npm" \
  --args="run,db:seed-tenant"
echo "  OK: ${JOB} set to seed command."

# Step 2: execute and wait. On failure, --wait returns non-zero and the EXIT trap
# still restores the migrate-deploy command before the script exits.
echo ""
echo "[Step 2] Executing seed Job (this creates tenant + admin user)..."
run gcloud run jobs execute "$JOB" --region="${REGION}" --wait
echo "  OK: Seeding complete."
echo "  Logs: gcloud run jobs logs read ${JOB} --region=${REGION} --limit=50"

# Step 3 (restore) runs automatically via the EXIT trap above.
