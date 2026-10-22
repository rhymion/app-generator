#!/usr/bin/env bash
# Remove the resources scripts/gcp-task-runner.sh created, and nothing else.
# Unlike scripts/gcp-teardown.sh, this never deletes the GCP project.
#
# What it deletes, by name (each step idempotent; a missing resource is SKIPped):
#   1. The Cloud Scheduler job            (TASK_RUNNER_SCHEDULER_JOB_NAME)
#   2. The Cloud Run Job                  (TASK_RUNNER_JOB_NAME; its invoker binding goes with it)
#   3. The bucket-scoped IAM bindings of the runtime service account
#                                         (TASK_RUNNER_BUCKET_ROLES; the buckets stay)
#   4. The Secret Manager secrets         (one per key in the task-runner env file)
#   5. The two service accounts           (invoker, then runtime)
#   6. The task-runner images             (DELETE_IMAGES: all | none | keep:N)
#   7. Optionally the audit-log GCS bucket (DELETE_AUDIT_LOG_BUCKET=true, off by default)
#
# It never touches the Artifact Registry repository itself, the migrate image
# of gcp-deploy.sh, Cloud SQL, or any bucket other than the one named in
# AUDIT_LOG_GCS_BUCKET when the bucket opt-in is set.
#
# Usage:
#   DRY_RUN=true ./scripts/gcp-task-runner-teardown.sh   # print the plan, call nothing
#   ./scripts/gcp-task-runner-teardown.sh                # asks for confirmation, then deletes
#   DELETE_IMAGES=keep:2 ./scripts/gcp-task-runner-teardown.sh
#   DELETE_AUDIT_LOG_BUCKET=true ./scripts/gcp-task-runner-teardown.sh
#
# Configuration is the same as gcp-task-runner.sh (scripts/gcp-task-runner-config.sh):
# PROJECT_ID is required and the ambient gcloud project is never used. The
# task-runner env file is only read for key NAMES (to derive secret names) and
# for AUDIT_LOG_GCS_BUCKET; a missing file falls back to TASK_RUNNER_REQUIRED_KEYS,
# and extra secret keys can be listed in TASK_RUNNER_EXTRA_SECRET_KEYS.
#
# Prerequisites (live run): gcloud (authenticated), python3 (retention check)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

# shellcheck source=scripts/gcp-task-runner-config.sh
source "${SCRIPT_DIR}/gcp-task-runner-config.sh"

DELETE_IMAGES="${DELETE_IMAGES:-all}"
DELETE_AUDIT_LOG_BUCKET="${DELETE_AUDIT_LOG_BUCKET:-false}"
TASK_RUNNER_EXTRA_SECRET_KEYS="${TASK_RUNNER_EXTRA_SECRET_KEYS:-}"

if [[ ! "$DELETE_IMAGES" =~ ^(all|none|keep:[1-9][0-9]*)$ ]]; then
  echo "ERROR: DELETE_IMAGES must be all, none or keep:N (N >= 1); got '${DELETE_IMAGES}'." >&2
  exit 1
fi

ENV_FILE_OPTIONAL=true
read_task_runner_env_file
for _key in $TASK_RUNNER_EXTRA_SECRET_KEYS; do
  if [[ ! "$_key" =~ ^[A-Z][A-Z0-9_]*$ ]]; then
    echo "ERROR: TASK_RUNNER_EXTRA_SECRET_KEYS entry '${_key}' is not an upper-case KEY." >&2
    exit 1
  fi
  [[ -n "${SECRET_VALUES[$_key]+x}" ]] || { SECRET_KEYS+=("$_key"); SECRET_VALUES[$_key]=""; }
done

BUCKET_NAME=""
if [[ "$DELETE_AUDIT_LOG_BUCKET" == "true" ]]; then
  BUCKET_NAME="${SECRET_VALUES[AUDIT_LOG_GCS_BUCKET]:-${AUDIT_LOG_GCS_BUCKET:-}}"
  if [[ ! "$BUCKET_NAME" =~ ^[a-z0-9][a-z0-9._-]*$ ]]; then
    echo "ERROR: DELETE_AUDIT_LOG_BUCKET=true needs AUDIT_LOG_GCS_BUCKET (a bucket name) in ${TASK_RUNNER_ENV_FILE} or the environment." >&2
    exit 1
  fi
elif [[ "$DELETE_AUDIT_LOG_BUCKET" != "false" ]]; then
  echo "ERROR: DELETE_AUDIT_LOG_BUCKET must be true or false; got '${DELETE_AUDIT_LOG_BUCKET}'." >&2
  exit 1
fi

# Bucket-scoped IAM bindings recorded in TASK_RUNNER_BUCKET_ROLES.
BINDING_BUCKETS=()
BINDING_ROLES=()
for _pair in $TASK_RUNNER_BUCKET_ROLES; do
  if [[ ! "$_pair" =~ ^([a-z0-9][a-z0-9._-]*)=(roles/[A-Za-z0-9._]+)$ ]]; then
    echo "ERROR: TASK_RUNNER_BUCKET_ROLES entry '${_pair}' is not BUCKET=ROLE (for example my-bucket=roles/storage.objectUser)." >&2
    exit 1
  fi
  BINDING_BUCKETS+=("${BASH_REMATCH[1]}")
  BINDING_ROLES+=("${BASH_REMATCH[2]}")
done

# In DRY_RUN, echo the command; otherwise execute it.
run() {
  if [[ "$DRY_RUN" == "true" ]]; then
    printf '[DRY-RUN]'
    printf ' %q' "$@"
    printf '\n'
  else
    "$@"
  fi
}

# Runs a delete that may race with another deletion: "not found" is a SKIP.
run_tolerating_missing() {
  if [[ "$DRY_RUN" == "true" ]]; then
    run "$@"
    return 0
  fi
  local err
  err="$(mktemp)"
  if "$@" 2>"$err"; then
    rm -f "$err"
    return 0
  fi
  if grep -qiE "not found|does not exist|NOT_FOUND|HTTPError 404" "$err"; then
    echo "[SKIP] already gone: ${*:1:5}"
    rm -f "$err"
    return 0
  fi
  cat "$err" >&2
  rm -f "$err"
  echo "ERROR: gcloud command failed: $*" >&2
  return 1
}

# Decides whether the audit-log bucket can be deleted now. Prints OK, or
# BLOCKED followed by the reason and the latest expiry. Any doubt is BLOCKED.
retention_verdict() {
  local bucket_json objects_json
  bucket_json="$(gcloud storage buckets describe "gs://${BUCKET_NAME}" --project="$PROJECT_ID" --format=json 2>&1)" || {
    echo "BLOCKED: cannot read bucket gs://${BUCKET_NAME}: ${bucket_json}"
    return 0
  }
  objects_json="$(gcloud storage objects list "gs://${BUCKET_NAME}/**" --project="$PROJECT_ID" --format=json 2>&1)" || {
    if grep -qiE "no urls matched|matched no objects" <<<"$objects_json"; then
      objects_json="[]"
    else
      echo "BLOCKED: cannot list objects of gs://${BUCKET_NAME}: ${objects_json}"
      return 0
    fi
  }
  BUCKET_JSON="$bucket_json" OBJECTS_JSON="$objects_json" python3 -I - <<'PY'
import json, os, re, sys
from datetime import datetime, timedelta, timezone

def norm(key):
    return re.sub(r"[^a-z]", "", key.lower())

def find(node, *names):
    """First value whose normalised key is in names, searching depth first."""
    wanted = {norm(n) for n in names}
    if isinstance(node, dict):
        for k, v in node.items():
            if norm(k) in wanted:
                return v
        for v in node.values():
            r = find(v, *names)
            if r is not None:
                return r
    elif isinstance(node, list):
        for v in node:
            r = find(v, *names)
            if r is not None:
                return r
    return None

def parse_time(value):
    if not isinstance(value, str):
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(timezone.utc)
    except ValueError:
        return None

def parse_period(value):
    if value is None:
        return None
    m = re.fullmatch(r"(\d+)s?", str(value))
    return timedelta(seconds=int(m.group(1))) if m else None

try:
    bucket = json.loads(os.environ["BUCKET_JSON"])
    objects = json.loads(os.environ["OBJECTS_JSON"])
except ValueError as exc:
    print(f"BLOCKED: cannot parse gcloud output ({exc})")
    sys.exit(0)
if isinstance(objects, dict):
    objects = [objects]

now = datetime.now(timezone.utc)
policy = find(bucket, "retentionPolicy")
period = parse_period(find(policy, "retentionPeriod")) if policy else None
locked = bool(find(policy, "isLocked")) if policy else False
default_obj = find(bucket, "defaultObjectRetention", "objectRetention")

latest = None
for obj in objects:
    expiry = parse_time(find(obj, "retentionExpirationTime"))
    if expiry is None and period is not None:
        created = parse_time(find(obj, "timeCreated", "creationTime"))
        if created is None:
            print("BLOCKED: an object has no creation time, so its retention cannot be checked")
            sys.exit(0)
        expiry = created + period
    if expiry is not None and expiry > now and (latest is None or expiry > latest):
        latest = expiry

if latest is not None:
    kind = "locked retention policy" if locked else "retention"
    if default_obj and not locked:
        kind = "Object Retention / retention policy"
    print(f"BLOCKED: objects are under {kind} and cannot be deleted before {latest.isoformat()}")
elif locked and objects:
    print("BLOCKED: the bucket has a locked retention policy and objects whose retention cannot be read")
else:
    print("OK")
PY
}

# ── Plan ─────────────────────────────────────────────────────────────────────
echo "=== GCP task-runner teardown: ${PROJECT_ID} / ${REGION} ==="
[[ "$DRY_RUN" == "true" ]] && echo "[DRY-RUN mode: commands are printed, nothing is executed]"
echo "  Scheduler job   : ${TASK_RUNNER_SCHEDULER_JOB_NAME}"
echo "  Cloud Run Job   : ${TASK_RUNNER_JOB_NAME}"
if (( ${#BINDING_BUCKETS[@]} > 0 )); then
  for _i in "${!BINDING_BUCKETS[@]}"; do
    echo "  Bucket binding  : ${BINDING_ROLES[$_i]} for ${RUNTIME_SA_EMAIL} on gs://${BINDING_BUCKETS[$_i]} (bucket kept)"
  done
fi
for _key in "${SECRET_KEYS[@]}"; do
  echo "  Secret          : $(secret_name "$_key")"
done
echo "  Service accounts: ${INVOKER_SA_EMAIL}, ${RUNTIME_SA_EMAIL}"
echo "  Images          : ${IMAGE_REPO} (${DELETE_IMAGES})"
if [[ -n "$BUCKET_NAME" ]]; then
  echo "  AUDIT-LOG BUCKET: gs://${BUCKET_NAME} (DELETE_AUDIT_LOG_BUCKET=true)"
else
  echo "  Audit-log bucket: not touched (DELETE_AUDIT_LOG_BUCKET is not true)"
fi
echo "  The GCP project and the Artifact Registry repository are never deleted."
echo ""

if [[ "$DRY_RUN" != "true" ]]; then
  _need=(gcloud)
  [[ -n "$BUCKET_NAME" ]] && _need+=(python3)
  for _cmd in "${_need[@]}"; do
    command -v "$_cmd" &>/dev/null || { echo "ERROR: Required command not found: ${_cmd}" >&2; exit 1; }
  done
fi

# ── Bucket pre-check: before anything is deleted ─────────────────────────────
if [[ -n "$BUCKET_NAME" && "$DRY_RUN" != "true" ]]; then
  echo "=== Checking retention on gs://${BUCKET_NAME} ==="
  _verdict="$(retention_verdict)"
  if [[ "$_verdict" != "OK" ]]; then
    echo "ERROR: ${_verdict}" >&2
    echo "  Nothing was deleted. Wait for the expiry, or run again without DELETE_AUDIT_LOG_BUCKET=true to keep the bucket." >&2
    exit 1
  fi
  echo "  OK: no retention blocks deletion."
  echo ""
elif [[ -n "$BUCKET_NAME" ]]; then
  echo "[DRY-RUN] would check Object Retention and retention periods on gs://${BUCKET_NAME} first and stop if any object cannot be deleted yet"
  echo ""
fi

# ── Confirmation ─────────────────────────────────────────────────────────────
if [[ "$DRY_RUN" != "true" ]]; then
  printf 'Delete the task-runner resources listed above from %s? (yes/no): ' "$PROJECT_ID"
  read -r _confirm || _confirm=""
  if [[ "$_confirm" != "yes" ]]; then
    echo "Cancelled. Nothing was deleted."
    exit 0
  fi
  printf 'Enter PROJECT_ID to confirm: '
  read -r _confirm_id || _confirm_id=""
  if [[ "$_confirm_id" != "$PROJECT_ID" ]]; then
    echo "ERROR: Input does not match. Aborting; nothing was deleted." >&2
    exit 1
  fi
  if [[ -n "$BUCKET_NAME" ]]; then
    echo ""
    echo "WARNING: gs://${BUCKET_NAME} holds the audit-log archive. It is the tamper-evidence record:"
    echo "  deleting it removes the only copy that cannot be edited from the database, and"
    echo "  it cannot be recovered. The project and its other data are not affected."
    printf 'Enter the bucket name to confirm deleting it: '
    read -r _confirm_bucket || _confirm_bucket=""
    if [[ "$_confirm_bucket" != "$BUCKET_NAME" ]]; then
      echo "ERROR: Input does not match. Aborting; nothing was deleted." >&2
      exit 1
    fi
  fi
fi

# ── Step 1: Cloud Scheduler job ──────────────────────────────────────────────
echo ""
echo "=== Step 1: Cloud Scheduler job ==="
run_tolerating_missing gcloud scheduler jobs delete "$TASK_RUNNER_SCHEDULER_JOB_NAME" \
  --location="$REGION" --project="$PROJECT_ID" --quiet

# ── Step 2: Cloud Run Job ────────────────────────────────────────────────────
echo ""
echo "=== Step 2: Cloud Run Job ==="
run_tolerating_missing gcloud run jobs delete "$TASK_RUNNER_JOB_NAME" \
  --region="$REGION" --project="$PROJECT_ID" --quiet

# ── Step 3: Bucket-scoped IAM bindings (before the service account goes) ─────
if (( ${#BINDING_BUCKETS[@]} > 0 )); then
  echo ""
  echo "=== Step 3: Bucket access of the runtime service account ==="
  for _i in "${!BINDING_BUCKETS[@]}"; do
    _b="${BINDING_BUCKETS[$_i]}"
    run_tolerating_missing gcloud storage buckets remove-iam-policy-binding "gs://${_b}" \
      --member="serviceAccount:${RUNTIME_SA_EMAIL}" \
      --role="${BINDING_ROLES[$_i]}" \
      --project="$PROJECT_ID"
  done
fi

# ── Step 4: Secret Manager ───────────────────────────────────────────────────
echo ""
echo "=== Step 4: Secret Manager ==="
for _key in "${SECRET_KEYS[@]}"; do
  _sname="$(secret_name "$_key")"
  run_tolerating_missing gcloud secrets delete "$_sname" --project="$PROJECT_ID" --quiet
done

# ── Step 5: Service accounts ─────────────────────────────────────────────────
echo ""
echo "=== Step 5: Service accounts ==="
for _email in "$INVOKER_SA_EMAIL" "$RUNTIME_SA_EMAIL"; do
  run_tolerating_missing gcloud iam service-accounts delete "$_email" --project="$PROJECT_ID" --quiet
done

# ── Step 6: task-runner images ───────────────────────────────────────────────
echo ""
echo "=== Step 6: task-runner images (${DELETE_IMAGES}) ==="
if [[ "$DELETE_IMAGES" == "none" ]]; then
  echo "[SKIP] DELETE_IMAGES=none"
elif [[ "$DRY_RUN" == "true" ]]; then
  _keep=0
  [[ "$DELETE_IMAGES" == keep:* ]] && _keep="${DELETE_IMAGES#keep:}"
  run gcloud artifacts docker images list "$IMAGE_REPO" --include-tags --sort-by=~CREATE_TIME --format='value(version)' --project="$PROJECT_ID"
  echo "[DRY-RUN] then, for each digest after the newest ${_keep}: gcloud artifacts docker images delete ${IMAGE_REPO}@<digest> --delete-tags --quiet"
else
  _keep=0
  [[ "$DELETE_IMAGES" == keep:* ]] && _keep="${DELETE_IMAGES#keep:}"
  _err="$(mktemp)"
  if _digests="$(gcloud artifacts docker images list "$IMAGE_REPO" --include-tags --sort-by=~CREATE_TIME \
                   --format='value(version)' --project="$PROJECT_ID" 2>"$_err")"; then
    rm -f "$_err"
    _n=0
    while IFS= read -r _digest; do
      [[ -z "$_digest" ]] && continue
      _n=$((_n + 1))
      if (( _n <= _keep )); then
        echo "[KEEP] ${IMAGE_REPO}@${_digest}"
        continue
      fi
      run_tolerating_missing gcloud artifacts docker images delete "${IMAGE_REPO}@${_digest}" \
        --delete-tags --quiet --project="$PROJECT_ID"
    done <<<"$_digests"
    (( _n == 0 )) && echo "[SKIP] No images in ${IMAGE_REPO}"
  elif grep -qiE "not found|does not exist|NOT_FOUND" "$_err"; then
    rm -f "$_err"
    echo "[SKIP] ${IMAGE_REPO} does not exist"
  else
    cat "$_err" >&2
    rm -f "$_err"
    echo "ERROR: could not list images in ${IMAGE_REPO}." >&2
    exit 1
  fi
fi

# ── Step 7: audit-log bucket (opt-in only) ───────────────────────────────────
if [[ -n "$BUCKET_NAME" ]]; then
  echo ""
  echo "=== Step 7: audit-log bucket gs://${BUCKET_NAME} ==="
  run_tolerating_missing gcloud storage rm --recursive --all-versions "gs://${BUCKET_NAME}" --project="$PROJECT_ID"
fi

echo ""
echo "=== Done ==="
if [[ "$DRY_RUN" == "true" ]]; then
  echo "[DRY-RUN] Nothing was deleted. A live run skips every resource that is already gone."
fi
