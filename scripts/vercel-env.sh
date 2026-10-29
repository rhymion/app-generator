#!/usr/bin/env bash
# Vercel env-injection helpers for consumer apps generated from this repo
# (app-generator). Canonical copy — consumer repos reference this file via
# their app-generator submodule rather than keeping their own duplicate
# (cmd_711).
# Source this file to load Vercel deployment variables and the vercel_env_inject
# function, used by vercel-setup.sh and vercel-deploy.sh.
# Usage (sourced):   source "$(dirname "${BASH_SOURCE[0]}")/vercel-env.sh"
# Usage (direct run): bash scripts/vercel-env.sh inject <production|preview>
#
# Two-DB pattern (see docs/vercel-automation-design.md §7):
#   inject production -> DATABASE_URL_PROD            is injected as DATABASE_URL (pooled)
#                      -> DATABASE_URL_UNPOOLED_PROD    is injected as DIRECT_URL (unpooled)
#   inject preview    -> DATABASE_URL_STAGING          is injected as DATABASE_URL (pooled)
#                      -> DATABASE_URL_UNPOOLED_STAGING is injected as DIRECT_URL (unpooled)
#   (all preview/staging deploys share one DB — deliberate, keeps DB count at 2)
#   DIRECT_URL is what prisma.config.ts uses for `migrate:deploy` on Vercel —
#   see cmd_657 / docs/knowledge/prisma-direct-vs-pooled-connection.md.
set -euo pipefail

_SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
_ENV_FILE="${_SCRIPT_DIR}/../.env.production.local"

# ── env-file write-quoting helpers (shared by vercel-env.sh/vercel-setup.sh) ──
# `set -a; source "$_ENV_FILE"; set +a` (below) evaluates every KEY=value line
# as real shell syntax. An unquoted value containing `&` is parsed by bash as
# the background-job control operator, silently truncating/unsetting the var
# on the *next* source of this file (confirmed live with a Neon connection
# string's trailing `&channel_binding=require` — see an earlier report
# CF-1/CF-5-adjacent finding). Fix: every write to _ENV_FILE wraps its value in
# double quotes (`KEY="value"`), which makes bash treat `&` (and whitespace,
# `#`, etc.) as a literal character during source. Double quotes still let `$`
# and a backtick trigger expansion/command-substitution during source, so the
# value is backslash-escaped first (`_shell_dquote_escape`) to keep it fully
# literal — safer than switching to single quotes, which cannot represent a
# literal `'` in the value at all.
_shell_dquote_escape() {
  local s="$1"
  s="${s//\\/\\\\}"
  s="${s//\$/\\\$}"
  s="${s//\`/\\\`}"
  s="${s//\"/\\\"}"
  printf '%s' "$s"
}

# sed's replacement text (the RHS of `s|...|replacement|`) has its own
# metacharacters: `&` re-inserts the whole match, and `\` starts an escape
# sequence (`\&`, `\\`, backreferences). This is unrelated to — and doesn't
# replace — `_shell_dquote_escape` above: that one protects the value once
# it's *sourced* from _ENV_FILE, this one protects the value while sed is
# *writing* it into _ENV_FILE in the first place. Apply this second, on top of
# the already shell-escaped string, whenever sed (not a plain echo/printf
# append) is used to write the value.
_sed_replacement_escape() {
  local s="$1"
  s="${s//\\/\\\\}"
  s="${s//&/\\&}"
  printf '%s' "$s"
}

if [[ -f "$_ENV_FILE" ]]; then
  # The file holds secrets; keep it readable by the owner only.
  chmod 600 "$_ENV_FILE"
  set -a
  # shellcheck disable=SC1090
  source "$_ENV_FILE"
  set +a
else
  echo "ERROR: .env.production.local not found at ${_ENV_FILE}" >&2
  echo "  Copy .env.vercel.production.local.example to .env.production.local and fill in values." >&2
  exit 1
fi

DRY_RUN="${DRY_RUN:-false}"

# _ensure_generated_secret NAME: generate-once-persist. If NAME is unset, generate it with
# openssl and write it back to .env.production.local so later runs reuse the same value.
_ensure_generated_secret() {
  local name="$1" value escaped
  if [[ -n "${!name:-}" ]]; then
    return 0
  fi
  if [[ "$DRY_RUN" == "true" ]]; then
    echo "[DRY-RUN] ${name} not set — will generate with openssl rand -base64 32 and save to .env.production.local at runtime"
    printf -v "$name" '%s' "<DRY_RUN_${name}>"
  else
    value=$(openssl rand -base64 32)
    escaped="$(_shell_dquote_escape "${value}")"
    if grep -q "^${name}=" "${_ENV_FILE}" 2>/dev/null; then
      sed -i "s|^${name}=.*|${name}=\"$(_sed_replacement_escape "${escaped}")\"|" "${_ENV_FILE}"
    else
      echo "${name}=\"${escaped}\"" >> "${_ENV_FILE}"
    fi
    printf -v "$name" '%s' "$value"
    echo "[INFO] ${name} generated and saved to .env.production.local"
  fi
  export "${name?}"
}

# Per-target secrets (Issue #1182). The Preview target must never receive the Production
# value of a secret: a Preview deployment of any branch would then sign sessions, accept
# cron calls and reach storage with Production's credentials. Production reads NAME;
# Preview reads NAME_STAGING (the same suffix DATABASE_URL_STAGING already uses).
#   - AUTH_SECRET and CRON_SECRET are generate-once-persist for both targets.
#   - REDIS_URL, BLOB_READ_WRITE_TOKEN, GOOGLE_CLIENT_SECRET cannot be generated here:
#     Preview gets them only from NAME_STAGING, and is left without them (never a copy
#     of the Production value) when NAME_STAGING is unset or equals the Production value.
#
# AUTH_SECRET: changing it invalidates all sessions for that target.
# CRON_SECRET (cmd_781): secures app/api/scheduled-tasks/[task]/route.ts — Vercel sends
# it back as `Authorization: Bearer $CRON_SECRET` on every Cron Job invocation once it's
# set on the project, but Vercel never generates/sets it itself. Harmless to inject even
# when the schema declares no x-scheduled-task entity.
_ensure_generated_secret AUTH_SECRET
_ensure_generated_secret CRON_SECRET
_ensure_generated_secret AUTH_SECRET_STAGING
_ensure_generated_secret CRON_SECRET_STAGING

# Required variables — abort with a clear message if missing (skip hard-fail in DRY_RUN
# so the syntax/flow of a fresh checkout can still be exercised end-to-end).
if [[ "$DRY_RUN" != "true" ]]; then
  : "${REDIS_URL:?REDIS_URL is required — set in .env.production.local}"
  : "${VERCEL_PROJECT_NAME:?VERCEL_PROJECT_NAME is required — set in .env.production.local}"
else
  REDIS_URL="${REDIS_URL:-<DRY_RUN_REDIS_URL>}"
  VERCEL_PROJECT_NAME="${VERCEL_PROJECT_NAME:-<DRY_RUN_VERCEL_PROJECT_NAME>}"
fi

VERCEL_ORG_ID="${VERCEL_ORG_ID:-}"
GOOGLE_CLIENT_ID="${GOOGLE_CLIENT_ID:-}"
GOOGLE_CLIENT_SECRET="${GOOGLE_CLIENT_SECRET:-}"
BLOB_READ_WRITE_TOKEN="${BLOB_READ_WRITE_TOKEN:-}"
# NEXT_PUBLIC_APP_TITLE / NEXT_PUBLIC_APP_COPYRIGHT (cmd_782/783): optional
# branding overrides, not secrets — see lib/site-config.ts and
# docs/knowledge/noindex-default-and-branding-env-vars.md. Both are
# NEXT_PUBLIC_-prefixed, so Next.js inlines them into the client bundle at
# *build* time: injecting them here only takes effect on Vercel's next
# build, not on the current running deployment.
NEXT_PUBLIC_APP_TITLE="${NEXT_PUBLIC_APP_TITLE:-}"
NEXT_PUBLIC_APP_COPYRIGHT="${NEXT_PUBLIC_APP_COPYRIGHT:-}"

REDIS_URL_STAGING="${REDIS_URL_STAGING:-}"
BLOB_READ_WRITE_TOKEN_STAGING="${BLOB_READ_WRITE_TOKEN_STAGING:-}"
GOOGLE_CLIENT_ID_STAGING="${GOOGLE_CLIENT_ID_STAGING:-}"
GOOGLE_CLIENT_SECRET_STAGING="${GOOGLE_CLIENT_SECRET_STAGING:-}"

export REDIS_URL VERCEL_PROJECT_NAME VERCEL_ORG_ID GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET BLOB_READ_WRITE_TOKEN NEXT_PUBLIC_APP_TITLE NEXT_PUBLIC_APP_COPYRIGHT
export REDIS_URL_STAGING BLOB_READ_WRITE_TOKEN_STAGING GOOGLE_CLIENT_ID_STAGING GOOGLE_CLIENT_SECRET_STAGING

# _target_value NAME TARGET: print the value to inject for NAME on TARGET (Issue #1182).
# production -> $NAME. preview -> $NAME_STAGING, or nothing when that is unset or is
# identical to the Production value (the variable is then skipped for Preview rather
# than shared).
_target_value() {
  local name="$1" target="$2" staging_name prod_value staging_value
  prod_value="${!name:-}"
  if [[ "$target" != "preview" ]]; then
    printf '%s' "$prod_value"
    return 0
  fi
  staging_name="${name}_STAGING"
  staging_value="${!staging_name:-}"
  if [[ -z "$staging_value" ]]; then
    if [[ -n "$prod_value" ]]; then
      echo "WARNING: ${staging_name} is not set — ${name} is NOT injected into Preview (the Production value is never reused). Set ${staging_name} in .env.production.local to enable it." >&2
    fi
    return 0
  fi
  if [[ "$staging_value" == "$prod_value" ]]; then
    echo "WARNING: ${staging_name} is identical to ${name} — ${name} is NOT injected into Preview. Use a distinct value per environment." >&2
    return 0
  fi
  printf '%s' "$staging_value"
}

# ── inject_var: upsert one Vercel env var, never echoing the secret value ────
# Usage: inject_var NAME VALUE TARGET
inject_var() {
  local name="$1" value="$2" target="$3"
  if [[ -z "$value" ]]; then
    echo "  [SKIP] ${name}: [unset] (not configured for ${target})"
    return 0
  fi
  # This project has no connected Git provider (deliberate — see
  # docs/vercel-automation-design.md "all preview/staging deploys share one
  # DB"). Without one, `vercel env add NAME preview --force` (no branch arg)
  # fails non-interactively with reason=git_branch_required, because the CLI
  # can't resolve what "all Preview branches" means with no Git history
  # (confirmed live). Passing an explicit empty git-branch argument resolves
  # it and applies to all Preview deploys, same as the CLI's own bare-target
  # form would if a Git provider were connected (confirmed live: `vercel env
  # ls preview` shows the var scoped to "Preview", not to any single branch).
  local _target_args=("$target")
  [[ "$target" == "preview" ]] && _target_args+=("")
  if [[ "$DRY_RUN" == "true" ]]; then
    echo "[DRY-RUN] printf '%s' <redacted> | vercel env add ${name} ${_target_args[*]} --force"
  else
    printf '%s' "$value" | vercel env add "$name" "${_target_args[@]}" --force
    echo "  Injected: ${name}: [set] -> ${target}"
  fi
}

# ── vercel_env_inject: inject the full variable set for one Vercel environment ──
# Usage: vercel_env_inject <production|preview>
vercel_env_inject() {
  local target="${1:?Usage: vercel_env_inject <production|preview>}"
  local db_url direct_url

  case "$target" in
    production)
      if [[ "$DRY_RUN" == "true" ]]; then
        db_url="${DATABASE_URL_PROD:-<DRY_RUN_DATABASE_URL_PROD>}"
        direct_url="${DATABASE_URL_UNPOOLED_PROD:-<DRY_RUN_DATABASE_URL_UNPOOLED_PROD>}"
      else
        : "${DATABASE_URL_PROD:?DATABASE_URL_PROD is required in .env.production.local for target=production}"
        : "${DATABASE_URL_UNPOOLED_PROD:?DATABASE_URL_UNPOOLED_PROD is required in .env.production.local for target=production}"
        db_url="$DATABASE_URL_PROD"
        direct_url="$DATABASE_URL_UNPOOLED_PROD"
      fi
      ;;
    preview)
      if [[ "$DRY_RUN" == "true" ]]; then
        db_url="${DATABASE_URL_STAGING:-<DRY_RUN_DATABASE_URL_STAGING>}"
        direct_url="${DATABASE_URL_UNPOOLED_STAGING:-<DRY_RUN_DATABASE_URL_UNPOOLED_STAGING>}"
      else
        : "${DATABASE_URL_STAGING:?DATABASE_URL_STAGING is required in .env.production.local for target=preview}"
        : "${DATABASE_URL_UNPOOLED_STAGING:?DATABASE_URL_UNPOOLED_STAGING is required in .env.production.local for target=preview}"
        db_url="$DATABASE_URL_STAGING"
        direct_url="$DATABASE_URL_UNPOOLED_STAGING"
      fi
      ;;
    development)
      echo "ERROR: 'development' target is not supported — sensitive vars are not allowed on Vercel's development environment." >&2
      return 1
      ;;
    *)
      echo "ERROR: unknown target '${target}' (expected production|preview)" >&2
      return 1
      ;;
  esac

  echo "=== Injecting Vercel env vars: target=${target} ==="
  # DATABASE_URL: an app that runs as the restricted audit_log role
  # (docs/knowledge/audit-log-append-only.md) records that role's pooled connection
  # string as DATABASE_URL_APP_PROD / DATABASE_URL_APP_STAGING in
  # .env.production.local (Issue #1174). When it is set, it is what gets injected as
  # DATABASE_URL, so re-running this script keeps the restricted role. DIRECT_URL stays
  # the owner's unpooled URL: migrations need the owner. The role's password is only
  # ever read from .env.production.local, never created or logged here.
  local app_url_name="DATABASE_URL_APP_PROD"
  [[ "$target" == "preview" ]] && app_url_name="DATABASE_URL_APP_STAGING"
  if [[ -n "${!app_url_name:-}" ]]; then
    db_url="${!app_url_name}"
    echo "  DATABASE_URL (${target}): using the restricted-role URL from ${app_url_name}." >&2
  else
    echo "WARNING: ${app_url_name} is not set, so DATABASE_URL (${target}) is set to the OWNER's pooled URL. If this app runs as the restricted audit_log role, this overwrites it. Record the role's connection string as ${app_url_name} in .env.production.local and re-run (docs/knowledge/audit-log-append-only.md)." >&2
  fi
  inject_var DATABASE_URL "$db_url" "$target"
  # DIRECT_URL: the unpooled Neon endpoint, consumed by prisma.config.ts for
  # `migrate:deploy` (both the one-time run in vercel-setup.sh Steps 3/5 and
  # the migrate:deploy embedded in `vercel-build`, which runs on every Vercel
  # build). Pooled DATABASE_URL cannot carry migrations reliably — PgBouncer
  # transaction mode does not preserve the session-scoped advisory lock
  # Prisma's migration engine takes. See
  # docs/knowledge/prisma-direct-vs-pooled-connection.md.
  inject_var DIRECT_URL "$direct_url" "$target"
  # Every secret below is chosen per target (Issue #1182); see _target_value.
  inject_var AUTH_SECRET "$(_target_value AUTH_SECRET "$target")" "$target"
  inject_var CRON_SECRET "$(_target_value CRON_SECRET "$target")" "$target"
  inject_var REDIS_URL "$(_target_value REDIS_URL "$target")" "$target"
  # Rate-limit keys in Redis are namespaced per environment as a second layer, so two
  # environments that ever share an instance still keep separate budgets
  # (lib/rate-limit/redis.ts reads RATE_LIMIT_KEY_PREFIX).
  inject_var RATE_LIMIT_KEY_PREFIX "${target}:" "$target"
  inject_var BLOB_READ_WRITE_TOKEN "$(_target_value BLOB_READ_WRITE_TOKEN "$target")" "$target"
  # A Google OAuth client ID is public; only its secret must differ. Preview uses
  # GOOGLE_CLIENT_ID_STAGING when set (a separate OAuth client), else the shared ID.
  local google_id="$GOOGLE_CLIENT_ID"
  if [[ "$target" == "preview" && -n "$GOOGLE_CLIENT_ID_STAGING" ]]; then
    google_id="$GOOGLE_CLIENT_ID_STAGING"
  fi
  inject_var GOOGLE_CLIENT_ID "$google_id" "$target"
  inject_var GOOGLE_CLIENT_SECRET "$(_target_value GOOGLE_CLIENT_SECRET "$target")" "$target"
  inject_var AUTH_TRUST_HOST "true" "$target"
  # USE_NEON_ADAPTER: fixed flag, not a per-deployment secret — same pattern
  # as AUTH_TRUST_HOST above. Injected as the literal string "true" on both
  # production and preview (lib/prisma.ts does an exact-match check, so any
  # other value is treated as unset). Vercel+Neon only; GCP Cloud Run and
  # local/CI never set this var and keep using the PrismaPg branch
  # unconditionally (cmd_692/cmd_711/cmd_712). See .env.example for the
  # branch this flips in lib/prisma.ts.
  inject_var USE_NEON_ADAPTER "true" "$target"
  # NEXT_PUBLIC_APP_TITLE / NEXT_PUBLIC_APP_COPYRIGHT: optional branding
  # overrides (cmd_782/783). Unlike every other var injected above, these are
  # NOT read at request time — Next.js inlines NEXT_PUBLIC_ vars into the
  # client bundle at build time, so a value change here has no effect until
  # the next build (redeploy the same build picks up nothing; push a new
  # commit or trigger a rebuild). See
  # docs/knowledge/noindex-default-and-branding-env-vars.md.
  inject_var NEXT_PUBLIC_APP_TITLE "$NEXT_PUBLIC_APP_TITLE" "$target"
  inject_var NEXT_PUBLIC_APP_COPYRIGHT "$NEXT_PUBLIC_APP_COPYRIGHT" "$target"
  # inject_var NODE_ENV "production" "$target"
  echo "=== Injection complete for ${target}. Trigger a redeploy for changes to take effect. ==="
}

# Allow direct execution: bash scripts/vercel-env.sh inject <production|preview>
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  if [[ "${1:-}" == "inject" ]]; then
    vercel_env_inject "${2:?Usage: bash scripts/vercel-env.sh inject <production|preview>}"
  else
    echo "Usage: bash scripts/vercel-env.sh inject <production|preview>" >&2
    exit 1
  fi
fi
