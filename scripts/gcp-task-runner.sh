#!/usr/bin/env bash
# Provision a nightly trigger for `npm run task:run-all` on GCP: a minimal
# Cloud Run Job ("task-runner") plus a Cloud Scheduler job that starts it.
# The app itself stays wherever it is hosted (for example Vercel); only this
# small executor lives on GCP.
#
# What it creates (each step idempotent):
#   1. GCP APIs (Cloud Run, Cloud Scheduler, Secret Manager, Artifact Registry)
#   2. Artifact Registry repository (if missing)
#   3. Two service accounts: a runtime SA for the Job (reads its own secrets
#      only) and an invoker SA for Cloud Scheduler (may run this one Job only)
#   4. Secret Manager secrets, one per KEY in the task-runner env file
#      (every variable reaches the Job as a secret, bucket names included)
#   5. The task-runner image (built from the Dockerfile's `task-runner` stage, which skips `next build`)
#   6. The Cloud Run Job, running `npm run task:run-all`
#   7. The Cloud Scheduler job that POSTs to the Cloud Run Jobs API `:run`
#
# Usage:
#   DRY_RUN=true ./scripts/gcp-task-runner.sh   # print the command sequence, run nothing
#   ./scripts/gcp-task-runner.sh                # live run
#   SKIP_BUILD=true TASK_RUNNER_IMAGE=<image> ./scripts/gcp-task-runner.sh
#
# DRY_RUN never invokes gcloud, docker, or any other external tool, and never
# prints a secret value. Nothing is created or changed.
#
# Configuration comes from the environment or `.env.production.local`
# (PROJECT_ID, REGION, SERVICE_NAME, REPO_NAME, and the TASK_RUNNER_* knobs
# below). The consumer's production secrets come from a separate file
# (TASK_RUNNER_ENV_FILE, default `.env.task-runner.production.local`; see
# `.env.task-runner.production.local.example`). That file is parsed line by
# line, never sourced.
#
# Prerequisites (live run): gcloud (authenticated), docker (unless SKIP_BUILD)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

SKIP_BUILD=${SKIP_BUILD:-false}

# Configuration loading and name derivation are shared with
# gcp-task-runner-teardown.sh through this file, so both scripts address the
# same resources. It does not source gcp-env.sh: that file requires Upstash and
# seed admin values this Job never uses, and it runs `gcloud config set
# project`, which DRY_RUN must not do.
# shellcheck source=scripts/gcp-task-runner-config.sh
source "${SCRIPT_DIR}/gcp-task-runner-config.sh"

BUILD_TS="$(date +%Y%m%d-%H%M%S)"
TASK_RUNNER_IMAGE="${TASK_RUNNER_IMAGE:-${IMAGE_REPO}:${BUILD_TS}}"

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

# Runs a check that needs gcloud. In DRY_RUN it never runs and reports "absent",
# so the create branch is the one shown.
exists() {
  [[ "$DRY_RUN" == "true" ]] && return 1
  "$@" &>/dev/null
}

# Retry a gcloud command while a freshly created service account is still
# invisible to IAM (eventual consistency). Only the "does not exist" error is retried.
run_iam_binding() {
  if [[ "$DRY_RUN" == "true" ]]; then
    run "$@"
    return 0
  fi
  local attempt=1 delay=2 max=6 stderr_file
  stderr_file="$(mktemp)"
  while true; do
    if "$@" 2>"$stderr_file"; then
      cat "$stderr_file" >&2
      rm -f "$stderr_file"
      return 0
    fi
    if grep -q "does not exist" "$stderr_file" && (( attempt < max )); then
      echo "  [IAM propagation lag] attempt ${attempt}/${max} failed, retrying in ${delay}s..." >&2
      sleep "$delay"
      attempt=$((attempt + 1))
      delay=$((delay * 2))
      continue
    fi
    cat "$stderr_file" >&2
    rm -f "$stderr_file"
    echo "ERROR: gcloud command failed after ${attempt} attempt(s): $*" >&2
    return 1
  done
}

# ── Read the secrets env file (KEY=VALUE lines; parsed, never sourced) ────────
read_task_runner_env_file

SET_SECRETS=""
for _key in "${SECRET_KEYS[@]}"; do
  SET_SECRETS+="${SET_SECRETS:+,}${_key}=$(secret_name "$_key"):latest"
done

echo "=== GCP task-runner provisioning: ${PROJECT_ID} / ${REGION} ==="
[[ "$DRY_RUN" == "true" ]] && echo "[DRY-RUN mode: commands are printed, nothing is executed]"
echo "  Job       : ${TASK_RUNNER_JOB_NAME} (npm run ${TASK_RUNNER_NPM_SCRIPT})"
echo "  Scheduler : ${TASK_RUNNER_SCHEDULER_JOB_NAME} (${TASK_RUNNER_SCHEDULE}, ${TASK_RUNNER_TIME_ZONE})"
echo "  Secrets   : ${#SECRET_KEYS[@]} (names only, values never printed)"
echo ""

if [[ "$DRY_RUN" != "true" ]]; then
  _need=(gcloud)
  [[ "$SKIP_BUILD" == "true" ]] || _need+=(docker)
  for _cmd in "${_need[@]}"; do
    command -v "$_cmd" &>/dev/null || { echo "ERROR: Required command not found: ${_cmd}" >&2; exit 1; }
  done
fi

# ── Step 1: APIs ─────────────────────────────────────────────────────────────
echo "=== Step 1: Enable GCP APIs ==="
run gcloud services enable \
  run.googleapis.com \
  cloudscheduler.googleapis.com \
  secretmanager.googleapis.com \
  artifactregistry.googleapis.com \
  iam.googleapis.com \
  --project="$PROJECT_ID"

# ── Step 2: Artifact Registry ────────────────────────────────────────────────
echo ""
echo "=== Step 2: Artifact Registry ==="
if exists gcloud artifacts repositories describe "$REPO_NAME" --location="$REGION" --project="$PROJECT_ID"; then
  echo "[SKIP] Repository ${REPO_NAME} already exists"
else
  run gcloud artifacts repositories create "$REPO_NAME" \
    --repository-format=docker \
    --location="$REGION" \
    --description="App Generator Docker images" \
    --project="$PROJECT_ID"
fi

# ── Step 3: Service accounts ─────────────────────────────────────────────────
echo ""
echo "=== Step 3: Service accounts ==="
for _pair in "${TASK_RUNNER_SA_NAME}|${RUNTIME_SA_EMAIL}|Task runner Cloud Run Job (runtime)" \
             "${TASK_RUNNER_INVOKER_SA_NAME}|${INVOKER_SA_EMAIL}|Task runner Cloud Scheduler invoker"; do
  IFS='|' read -r _name _email _display <<<"$_pair"
  if exists gcloud iam service-accounts describe "$_email" --project="$PROJECT_ID"; then
    echo "[SKIP] Service account ${_email} already exists"
  else
    run gcloud iam service-accounts create "$_name" \
      --display-name="$_display" \
      --project="$PROJECT_ID"
  fi
done

# ── Step 4: Secret Manager ───────────────────────────────────────────────────
# Values go in through stdin, never as a command-line flag. The runtime SA gets
# accessor rights on these secrets only, not project-wide.
echo ""
echo "=== Step 4: Secret Manager ==="
for _key in "${SECRET_KEYS[@]}"; do
  _sname="$(secret_name "$_key")"
  if [[ "$DRY_RUN" == "true" ]]; then
    echo "[DRY-RUN] gcloud secrets create|versions add ${_sname} --data-file=-   # value of ${_key} from the env file, not shown"
  else
    if gcloud secrets describe "$_sname" --project="$PROJECT_ID" &>/dev/null; then
      printf '%s' "${SECRET_VALUES[$_key]}" | gcloud secrets versions add "$_sname" --data-file=- --project="$PROJECT_ID"
    else
      printf '%s' "${SECRET_VALUES[$_key]}" | gcloud secrets create "$_sname" \
        --data-file=- --replication-policy=automatic --project="$PROJECT_ID"
    fi
    echo "  Upserted secret: ${_sname}"
  fi
  run_iam_binding gcloud secrets add-iam-policy-binding "$_sname" \
    --member="serviceAccount:${RUNTIME_SA_EMAIL}" \
    --role="roles/secretmanager.secretAccessor" \
    --project="$PROJECT_ID"
done

# ── Step 4b: Bucket access (optional) ────────────────────────────────────────
if [[ -n "$TASK_RUNNER_BUCKET_ROLES" ]]; then
  echo ""
  echo "=== Step 4b: Bucket access for the runtime service account ==="
  for _pair in $TASK_RUNNER_BUCKET_ROLES; do
    if [[ ! "$_pair" =~ ^([a-z0-9][a-z0-9._-]*)=(roles/[A-Za-z0-9._]+)$ ]]; then
      echo "ERROR: TASK_RUNNER_BUCKET_ROLES entry '${_pair}' is not BUCKET=ROLE (for example my-bucket=roles/storage.objectUser)." >&2
      exit 1
    fi
    run_iam_binding gcloud storage buckets add-iam-policy-binding "gs://${BASH_REMATCH[1]}" \
      --member="serviceAccount:${RUNTIME_SA_EMAIL}" \
      --role="${BASH_REMATCH[2]}" \
      --project="$PROJECT_ID"
  done
fi

# ── Step 5: Image ────────────────────────────────────────────────────────────
# The `task-runner` stage carries the full source tree, node_modules (including
# tsx), the generated code and the Prisma client, which is what `npm run
# task:run-all` needs, and skips `next build`. The slim runner stage does not carry
# the source tree. Set TASK_RUNNER_DOCKER_TARGET=builder to build the previous,
# heavier image.
echo ""
echo "=== Step 5: Image ==="
if [[ "$SKIP_BUILD" == "true" ]]; then
  echo "[SKIP] SKIP_BUILD=true; using image ${TASK_RUNNER_IMAGE}"
else
  run gcloud auth configure-docker "${REGION}-docker.pkg.dev" --quiet
  run docker build -f "${PROJECT_ROOT}/Dockerfile" --target "$TASK_RUNNER_DOCKER_TARGET" \
    -t "$TASK_RUNNER_IMAGE" "$PROJECT_ROOT"
  run docker push "$TASK_RUNNER_IMAGE"
fi

# ── Step 6: Cloud Run Job ────────────────────────────────────────────────────
# max-retries=0: run-all records per-task results, and a failed task is
# picked up by the next scheduled run rather than by a blind whole-batch retry.
echo ""
echo "=== Step 6: Cloud Run Job ==="
_JOB_FLAGS=(
  --image="$TASK_RUNNER_IMAGE"
  --region="$REGION"
  --project="$PROJECT_ID"
  --service-account="$RUNTIME_SA_EMAIL"
  --set-secrets="$SET_SECRETS"
  --command="npm"
  --args="run,${TASK_RUNNER_NPM_SCRIPT}"
  --tasks=1
  --parallelism=1
  --max-retries=0
  --task-timeout="$TASK_RUNNER_TASK_TIMEOUT"
)
if exists gcloud run jobs describe "$TASK_RUNNER_JOB_NAME" --region="$REGION" --project="$PROJECT_ID"; then
  run gcloud run jobs update "$TASK_RUNNER_JOB_NAME" "${_JOB_FLAGS[@]}"
else
  run gcloud run jobs create "$TASK_RUNNER_JOB_NAME" "${_JOB_FLAGS[@]}"
fi

# ── Step 7: Invoker permission + Cloud Scheduler job ─────────────────────────
echo ""
echo "=== Step 7: Invoker permission and Cloud Scheduler ==="
run_iam_binding gcloud run jobs add-iam-policy-binding "$TASK_RUNNER_JOB_NAME" \
  --region="$REGION" \
  --member="serviceAccount:${INVOKER_SA_EMAIL}" \
  --role="roles/run.invoker" \
  --project="$PROJECT_ID"

_SCHED_FLAGS=(
  --location="$REGION"
  --project="$PROJECT_ID"
  --schedule="$TASK_RUNNER_SCHEDULE"
  --time-zone="$TASK_RUNNER_TIME_ZONE"
  --uri="$JOB_RUN_URI"
  --http-method=POST
  --oauth-service-account-email="$INVOKER_SA_EMAIL"
)
if exists gcloud scheduler jobs describe "$TASK_RUNNER_SCHEDULER_JOB_NAME" --location="$REGION" --project="$PROJECT_ID"; then
  run gcloud scheduler jobs update http "$TASK_RUNNER_SCHEDULER_JOB_NAME" "${_SCHED_FLAGS[@]}"
else
  run gcloud scheduler jobs create http "$TASK_RUNNER_SCHEDULER_JOB_NAME" "${_SCHED_FLAGS[@]}"
fi

echo ""
echo "=== Done ==="
if [[ "$DRY_RUN" == "true" ]]; then
  echo "[DRY-RUN] Nothing was created. In a live run, Step 6 uses 'update' when the Job already exists"
  echo "          and Step 7 uses 'update' when the scheduler job already exists; otherwise 'create'."
else
  echo "  Trigger once now:  gcloud scheduler jobs run ${TASK_RUNNER_SCHEDULER_JOB_NAME} --location=${REGION} --project=${PROJECT_ID}"
  echo "  Executions:        gcloud run jobs executions list --job=${TASK_RUNNER_JOB_NAME} --region=${REGION} --project=${PROJECT_ID}"
fi
