#!/usr/bin/env bash
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

# ─── Banner ───────────────────────────────────────────────────────────────────
echo ""
echo "================================================================="
echo "  GCP Project Teardown Script"
echo "================================================================="
echo "  Target PROJECT_ID : ${PROJECT_ID}"
echo "  SERVICE_NAME      : ${SERVICE_NAME}"
echo "  REGION            : ${REGION}"
echo "================================================================="
echo ""

# ─── Safety Guard 1: Verify project exists ──────────────────────────────────
echo "[1/5] Verifying project exists..."
if ! gcloud projects describe "${PROJECT_ID}" --quiet 2>/dev/null; then
  echo "ERROR: Project '${PROJECT_ID}' not found. Aborting."
  exit 1
fi
echo "  OK: Project exists."

# ─── Safety Guard 2: Billing confirmation ────────────────────────────────────
echo ""
echo "[2/5] Checking billing account..."
gcloud billing projects describe "${PROJECT_ID}" || true
echo ""

# ─── Safety Guard 3: Deletion confirmation (yes/no) ─────────────────────────
echo "[3/5] Deletion confirmation (step 1)"
read -rp "Are you sure you want to DELETE ${PROJECT_ID}? (yes/no): " confirm
if [[ "${confirm}" != "yes" ]]; then
  echo "Cancelled. Exiting."
  exit 0
fi

# ─── Safety Guard 4: PROJECT_ID re-entry confirmation ────────────────────────
echo ""
echo "[4/5] Deletion confirmation (step 2)"
read -rp "Enter PROJECT_ID to confirm deletion: " confirm_id
if [[ "${confirm_id}" != "${PROJECT_ID}" ]]; then
  echo "ERROR: Input does not match. Aborting."
  exit 1
fi

# ─── Upstash Redis cleanup ────────────────────────────────────────────────────
echo ""
echo "[5/5] Upstash Redis cleanup..."
if [[ -n "${UPSTASH_EMAIL:-}" && -n "${UPSTASH_API_KEY:-}" ]]; then
  echo "  Fetching Upstash Redis database list..."
  AUTH_HEADER="Authorization: Basic $(echo -n "${UPSTASH_EMAIL}:${UPSTASH_API_KEY}" | base64 -w 0)"
  DB_LIST=$(curl -s -H "${AUTH_HEADER}" https://api.upstash.com/v2/redis/database)
  REDIS_DB_NAME="${SERVICE_NAME}-redis"
  # Get Upstash DB ID via python3
  DB_ID=$(echo "${DB_LIST}" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    target = '${SERVICE_NAME}-redis'
    for db in (data if isinstance(data, list) else []):
        if db.get('database_name') == target:
            print(db.get('database_id', ''))
            break
except Exception:
    pass
")

  if [[ -n "${DB_ID}" ]]; then
    echo "  INFO: Deleting ${REDIS_DB_NAME} (id=${DB_ID})."
    run curl -s -X DELETE \
      -H "${AUTH_HEADER}" \
      "https://api.upstash.com/v2/redis/database/${DB_ID}"
    echo "  INFO: Upstash Redis DB '${REDIS_DB_NAME}' deleted."
  else
    echo "  INFO: Upstash Redis DB '${REDIS_DB_NAME}' not found. Assumed already deleted."
  fi
else
  echo "  WARN: UPSTASH_EMAIL / UPSTASH_API_KEY is not set."
  echo "  Manually log in to https://console.upstash.com and"
  echo "  delete the '${SERVICE_NAME}-redis' database."
fi

# ─── GCP project deletion ─────────────────────────────────────────────────────
echo ""
echo "Deleting GCP project '${PROJECT_ID}'..."
echo "(Will be permanently deleted after a 30-day soft-delete period)"
run gcloud projects delete "${PROJECT_ID}" --quiet

echo ""
echo "================================================================="
echo "  GCP Project deletion complete"
echo "================================================================="
echo ""
echo "[Manual action required] Delete Prisma Accelerate connection (persists after GCP deletion):"
echo "  1. Log in to https://console.prisma.io"
echo "  2. Select the target project → Delete"
echo "  (Safe to leave if no billing is incurred)"
echo ""
