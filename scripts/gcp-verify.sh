#!/usr/bin/env bash
# Read-only check of a deployed GCP app's security configuration (Issue #1244). Run it after each deployment.
#
#   ./scripts/gcp-verify.sh
#
# It only reads: `gcloud storage buckets describe`, `gcloud storage buckets get-iam-policy` and
# `gcloud secrets list`. It never creates, updates or deletes anything, never reads a secret's value, and takes no
# credentials: it uses the gcloud CLI's existing sign-in (`gcloud auth login`). Each line is PASS/FAIL with the
# name of the setting examined; the output contains no values and is safe to paste into an Issue.
#
# Settings: PROJECT_ID, GCS_BUCKET (default <PROJECT_ID>-app-uploads) and the optional AUDIT_LOG_GCS_BUCKET, from
# the environment or .env.production.local (read, not sourced). Exit status: 0 all passed, 1 a check failed,
# 2 usage or setup error.
set -euo pipefail

_VERIFY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=deploy-verify-common.sh
source "${_VERIFY_DIR}/deploy-verify-common.sh"

verify_require_cli gcloud 'gcloud auth login'

PROJECT_ID="$(verify_env_value PROJECT_ID)"
if [[ -z "$PROJECT_ID" ]]; then
  echo "ERROR: PROJECT_ID is not set (environment or .env.production.local)." >&2
  exit 2
fi
GCS_BUCKET="$(verify_env_value GCS_BUCKET)"
GCS_BUCKET="${GCS_BUCKET:-${PROJECT_ID}-app-uploads}"
AUDIT_LOG_GCS_BUCKET="$(verify_env_value AUDIT_LOG_GCS_BUCKET)"

# Secrets the Cloud Run service needs (scripts/gcp-setup.sh, scripts/gcp-deploy.sh). Presence only.
REQUIRED_SECRETS=(app-database-url app-direct-database-url app-auth-secret app-nextauth-secret app-gcs-bucket-name)
OPTIONAL_SECRETS=(app-cron-secret app-redis-url)

check_bucket() {
  local label="$1" bucket="$2" pap ubla policy
  if ! pap="$(gcloud storage buckets describe "gs://${bucket}" --project "$PROJECT_ID" \
      --format='value(public_access_prevention)' 2>/dev/null)"; then
    verify_fail "${label}" "bucket not found or not readable with the signed-in account"
    return 0
  fi
  if [[ "$pap" == "enforced" ]]; then
    verify_pass "${label}.public_access_prevention"
  else
    verify_fail "${label}.public_access_prevention" "not enforced"
  fi
  ubla="$(gcloud storage buckets describe "gs://${bucket}" --project "$PROJECT_ID" \
      --format='value(uniform_bucket_level_access)' 2>/dev/null || true)"
  if [[ "$(tr '[:upper:]' '[:lower:]' <<<"$ubla")" == "true" ]]; then
    verify_pass "${label}.uniform_bucket_level_access"
  else
    verify_fail "${label}.uniform_bucket_level_access" "not enabled"
  fi
  if ! policy="$(gcloud storage buckets get-iam-policy "gs://${bucket}" --project "$PROJECT_ID" --format=json 2>/dev/null)"; then
    verify_fail "${label}.iam_policy" "policy not readable with the signed-in account"
    return 0
  fi
  if grep -Eq '"(allUsers|allAuthenticatedUsers)"' <<<"$policy"; then
    verify_fail "${label}.iam_policy" "has an allUsers or allAuthenticatedUsers binding"
  else
    verify_pass "${label}.iam_policy (no allUsers/allAuthenticatedUsers)"
  fi
}

check_bucket attachment_bucket "$GCS_BUCKET"
if [[ -n "$AUDIT_LOG_GCS_BUCKET" ]]; then
  check_bucket audit_log_bucket "$AUDIT_LOG_GCS_BUCKET"
else
  verify_info "audit_log_bucket not configured (AUDIT_LOG_GCS_BUCKET unset); skipped"
fi

if secrets="$(gcloud secrets list --project "$PROJECT_ID" --format='value(name)' 2>/dev/null)"; then
  for name in "${REQUIRED_SECRETS[@]}"; do
    if grep -Eq "(^|/)${name}\$" <<<"$secrets"; then
      verify_pass "secret ${name} present"
    else
      verify_fail "secret ${name}" "missing"
    fi
  done
  for name in "${OPTIONAL_SECRETS[@]}"; do
    if grep -Eq "(^|/)${name}\$" <<<"$secrets"; then
      verify_pass "secret ${name} present"
    else
      verify_info "secret ${name} not present (optional)"
    fi
  done
else
  verify_fail "secret_manager" "secrets not listable with the signed-in account"
fi

verify_finish
