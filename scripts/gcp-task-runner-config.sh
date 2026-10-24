#!/usr/bin/env bash
# Shared configuration for scripts/gcp-task-runner.sh (create / replace) and
# scripts/gcp-task-runner-teardown.sh (delete). Source it; do not run it.
#
# Both scripts must address exactly the same resources, so configuration
# loading and name derivation live here once. Sourcing this file never calls
# gcloud, docker or any other external tool.
#
# The caller sets SCRIPT_DIR and PROJECT_ROOT and `set -euo pipefail` first.
# After sourcing, these are defined: DRY_RUN, PROJECT_ID, REGION, SERVICE_NAME,
# REPO_NAME, the TASK_RUNNER_* names, RUNTIME_SA_EMAIL, INVOKER_SA_EMAIL,
# JOB_RUN_URI, IMAGE_REPO, secret_name() and read_task_runner_env_file().

DRY_RUN=${DRY_RUN:-false}

_ENV_FILE="${PROJECT_ROOT}/.env.production.local"
if [[ -f "$_ENV_FILE" ]]; then
  # The file holds secrets; keep it readable by the owner only.
  chmod 600 "$_ENV_FILE"
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
# Keep in sync with the package.json script that runs every scheduled task in
# dependency order (`task:run-all`).
TASK_RUNNER_NPM_SCRIPT="${TASK_RUNNER_NPM_SCRIPT:-task:run-all}"
# Cron expression + IANA time zone for the nightly trigger.
TASK_RUNNER_SCHEDULE="${TASK_RUNNER_SCHEDULE:-0 2 * * *}"
TASK_RUNNER_TIME_ZONE="${TASK_RUNNER_TIME_ZONE:-Asia/Tokyo}"
# Dockerfile stage the image is built from. `task-runner` skips the Next.js build.
TASK_RUNNER_DOCKER_TARGET="${TASK_RUNNER_DOCKER_TARGET:-task-runner}"
TASK_RUNNER_TASK_TIMEOUT="${TASK_RUNNER_TASK_TIMEOUT:-3600s}"
TASK_RUNNER_ENV_FILE="${TASK_RUNNER_ENV_FILE:-${PROJECT_ROOT}/.env.task-runner.production.local}"
# Keys that must be present and non-empty in the env file. DATABASE_URL should
# be the unpooled (direct) connection string. Add every other production
# secret your handlers read; see docs/knowledge/scheduled-task-operations.md.
# CRON_SECRET is not required: task:run-all runs the tasks directly and never
# goes through the HTTP route that checks it.
TASK_RUNNER_REQUIRED_KEYS="${TASK_RUNNER_REQUIRED_KEYS:-DATABASE_URL}"
# Optional bucket access for the Job's runtime service account: space-separated
# BUCKET=ROLE pairs (for example "my-archive=roles/storage.objectUser"). Each
# pair becomes a bucket-scoped IAM binding; nothing is granted project-wide.
TASK_RUNNER_BUCKET_ROLES="${TASK_RUNNER_BUCKET_ROLES:-}"

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
IMAGE_REPO="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO_NAME}/${SERVICE_NAME}-task-runner"

# KEY -> Secret Manager name: DATABASE_URL -> task-runner-database-url
secret_name() {
  local n="${1,,}"
  printf 'task-runner-%s' "${n//_/-}"
}

# Reads the secrets env file (KEY=VALUE lines; parsed, never sourced) into
# SECRET_KEYS and SECRET_VALUES. With ENV_FILE_OPTIONAL=true a missing file is
# not an error: the required keys alone are listed (the teardown needs names,
# never values).
SECRET_KEYS=()
declare -A SECRET_VALUES=()
read_task_runner_env_file() {
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
  elif [[ "$DRY_RUN" == "true" || "${ENV_FILE_OPTIONAL:-false}" == "true" ]]; then
    if [[ "$DRY_RUN" == "true" ]]; then
      echo "[DRY-RUN] ${TASK_RUNNER_ENV_FILE} not found; showing the required keys only." >&2
    else
      echo "[note] ${TASK_RUNNER_ENV_FILE} not found; using the required keys only." >&2
    fi
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

  if [[ "${ENV_FILE_OPTIONAL:-false}" != "true" ]]; then
    for _key in $TASK_RUNNER_REQUIRED_KEYS; do
      if [[ -z "${SECRET_VALUES[$_key]+x}" ]]; then
        echo "ERROR: required key ${_key} is missing or empty in ${TASK_RUNNER_ENV_FILE}." >&2
        exit 1
      fi
    done
  fi
}
