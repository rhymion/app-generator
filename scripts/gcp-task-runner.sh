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
#   5. The task-runner image (built from the Dockerfile's `builder` stage)
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

DRY_RUN=${DRY_RUN:-false}
SKIP_BUILD=${SKIP_BUILD:-false}

# Deliberately does not source gcp-env.sh: that file requires Upstash and seed
# admin values this Job never uses, and it runs `gcloud config set project`,
# which DRY_RUN must not do.
_ENV_FILE="${PROJECT_ROOT}/.env.production.local"
if [[ -f "$_ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$_ENV_FILE"
  set +a
fi

REGION="${REGION:-asia-northeast1}"
SERVICE_NAME="${SERVICE_NAME:-app}"
REPO_NAME="${REPO_NAME:-app-generator}"

TASK_RUNNER_JOB_NAME="${TASK_RUNNER_JOB_NAME:-task-runner}"
TASK_RUNNER_SA_NAME="${TASK_RUNNER_SA_NAME:-task-runner-sa}"
TASK_RUNNER_INVOKER_SA_NAME="${TASK_RUNNER_INVOKER_SA_NAME:-task-runner-invoker-sa}"
TASK_RUNNER_SCHEDULER_JOB_NAME="${TASK_RUNNER_SCHEDULER_JOB_NAME:-task-runner-nightly}"
# Placeholder command name; keep in sync with the package.json script that
# runs every scheduled task in dependency order.
TASK_RUNNER_NPM_SCRIPT="${TASK_RUNNER_NPM_SCRIPT:-task:run-all}"
# Cron expression + IANA time zone for the nightly trigger.
TASK_RUNNER_SCHEDULE="${TASK_RUNNER_SCHEDULE:-0 2 * * *}"
TASK_RUNNER_TIME_ZONE="${TASK_RUNNER_TIME_ZONE:-Asia/Tokyo}"
TASK_RUNNER_TASK_TIMEOUT="${TASK_RUNNER_TASK_TIMEOUT:-3600s}"
TASK_RUNNER_ENV_FILE="${TASK_RUNNER_ENV_FILE:-${PROJECT_ROOT}/.env.task-runner.production.local}"
# Keys that must be present and non-empty in the env file. DATABASE_URL should
# be the unpooled (direct) connection string. Add every other production
# secret your handlers read; see docs/knowledge/scheduled-task-operations.md.
TASK_RUNNER_REQUIRED_KEYS="${TASK_RUNNER_REQUIRED_KEYS:-DATABASE_URL CRON_SECRET}"

if [[ -z "${PROJECT_ID:-}" ]]; then
  if [[ "$DRY_RUN" == "true" ]]; then
    PROJECT_ID="<PROJECT_ID>"
    echo "[DRY-RUN] PROJECT_ID is not set; using a placeholder. Set it in .env.production.local or the environment." >&2
  else
    echo "ERROR: PROJECT_ID is required (set it in .env.production.local or the environment)." >&2
    echo "  This script does not fall back to the ambient gcloud project." >&2
    exit 1
  fi
fi

RUNTIME_SA_EMAIL="${TASK_RUNNER_SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
INVOKER_SA_EMAIL="${TASK_RUNNER_INVOKER_SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
JOB_RUN_URI="https://run.googleapis.com/v2/projects/${PROJECT_ID}/locations/${REGION}/jobs/${TASK_RUNNER_JOB_NAME}:run"
BUILD_TS="$(date +%Y%m%d-%H%M%S)"
IMAGE_REPO="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO_NAME}/${SERVICE_NAME}-task-runner"
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
SECRET_KEYS=()
declare -A SECRET_VALUES=()
if [[ -f "$TASK_RUNNER_ENV_FILE" ]]; then
  while IFS= read -r _line || [[ -n "$_line" ]]; do
    [[ "$_line" =~ ^[[:space:]]*(#|$) ]] && continue
    if [[ ! "$_line" =~ ^[[:space:]]*(export[[:space:]]+)?([A-Z][A-Z0-9_]*)=(.*)$ ]]; then
      echo "ERROR: unparsable line in ${TASK_RUNNER_ENV_FILE} (expected KEY=VALUE with an upper-case KEY)." >&2
      exit 1
    fi
    _key="${BASH_REMATCH[2]}"
    _val="${BASH_REMATCH[3]}"
    if [[ "$_val" =~ ^\"(.*)\"$ || "$_val" =~ ^\'(.*)\'$ ]]; then
      _val="${BASH_REMATCH[1]}"
    fi
    if [[ -z "$_val" ]]; then
      echo "  WARN: ${_key} is empty in the env file; skipping it."
      continue
    fi
    if [[ -z "${SECRET_VALUES[$_key]+x}" ]]; then
      SECRET_KEYS+=("$_key")
    fi
    SECRET_VALUES[$_key]="$_val"
  done < "$TASK_RUNNER_ENV_FILE"
elif [[ "$DRY_RUN" == "true" ]]; then
  echo "[DRY-RUN] ${TASK_RUNNER_ENV_FILE} not found; showing the required keys only." >&2
  for _key in $TASK_RUNNER_REQUIRED_KEYS; do
    SECRET_KEYS+=("$_key")
    SECRET_VALUES[$_key]="<DRY_RUN_PLACEHOLDER>"
  done
else
  echo "ERROR: ${TASK_RUNNER_ENV_FILE} not found." >&2
  echo "  Copy .env.task-runner.production.local.example to that path and fill in EVERY production secret" >&2
  echo "  the scheduled-task handlers read (see docs/knowledge/scheduled-task-operations.md)." >&2
  exit 1
fi

for _key in $TASK_RUNNER_REQUIRED_KEYS; do
  if [[ -z "${SECRET_VALUES[$_key]+x}" ]]; then
    echo "ERROR: required key ${_key} is missing or empty in ${TASK_RUNNER_ENV_FILE}." >&2
    exit 1
  fi
done

# KEY -> Secret Manager name: DATABASE_URL -> task-runner-database-url
secret_name() {
  local n="${1,,}"
  printf 'task-runner-%s' "${n//_/-}"
}

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

# ── Step 5: Image ────────────────────────────────────────────────────────────
# The `builder` stage carries the full source tree and node_modules (including
# tsx), which is what `npm run task:run-all` needs. The slim runner stage does not.
echo ""
echo "=== Step 5: Image ==="
if [[ "$SKIP_BUILD" == "true" ]]; then
  echo "[SKIP] SKIP_BUILD=true; using image ${TASK_RUNNER_IMAGE}"
else
  run gcloud auth configure-docker "${REGION}-docker.pkg.dev" --quiet
  run docker build -f "${PROJECT_ROOT}/Dockerfile" --target builder \
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
