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
  set -a
  # shellcheck disable=SC1090
  source "$_ENV_FILE"
  set +a
else
  echo "ERROR: .env.production.local not found at ${_ENV_FILE}" >&2
  echo "  Copy .env.production.local.example to .env.production.local and fill in values." >&2
  exit 1
fi

DRY_RUN="${DRY_RUN:-false}"

# AUTH_SECRET: generate-once-persist (if unset, generates and writes back to .env.production.local)
if [[ -z "${AUTH_SECRET:-}" ]]; then
  if [[ "$DRY_RUN" == "true" ]]; then
    echo "[DRY-RUN] AUTH_SECRET not set — will generate with openssl rand -base64 32 and save to .env.production.local at runtime"
    AUTH_SECRET="<DRY_RUN_AUTH_SECRET>"
  else
    AUTH_SECRET=$(openssl rand -base64 32)
    _AUTH_SECRET_ESCAPED="$(_shell_dquote_escape "${AUTH_SECRET}")"
    if grep -q "^AUTH_SECRET=" "${_ENV_FILE}" 2>/dev/null; then
      sed -i "s|^AUTH_SECRET=.*|AUTH_SECRET=\"$(_sed_replacement_escape "${_AUTH_SECRET_ESCAPED}")\"|" "${_ENV_FILE}"
    else
      echo "AUTH_SECRET=\"${_AUTH_SECRET_ESCAPED}\"" >> "${_ENV_FILE}"
    fi
    echo "[INFO] AUTH_SECRET generated and saved to .env.production.local"
  fi
  export AUTH_SECRET
fi

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

export REDIS_URL VERCEL_PROJECT_NAME VERCEL_ORG_ID GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET BLOB_READ_WRITE_TOKEN

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
  inject_var DATABASE_URL "$db_url" "$target"
  # DIRECT_URL: the unpooled Neon endpoint, consumed by prisma.config.ts for
  # `migrate:deploy` (both the one-time run in vercel-setup.sh Steps 3/5 and
  # the migrate:deploy embedded in `vercel-build`, which runs on every Vercel
  # build). Pooled DATABASE_URL cannot carry migrations reliably — PgBouncer
  # transaction mode does not preserve the session-scoped advisory lock
  # Prisma's migration engine takes. See
  # docs/knowledge/prisma-direct-vs-pooled-connection.md.
  inject_var DIRECT_URL "$direct_url" "$target"
  inject_var AUTH_SECRET "$AUTH_SECRET" "$target"
  inject_var REDIS_URL "$REDIS_URL" "$target"
  inject_var BLOB_READ_WRITE_TOKEN "$BLOB_READ_WRITE_TOKEN" "$target"
  inject_var GOOGLE_CLIENT_ID "$GOOGLE_CLIENT_ID" "$target"
  inject_var GOOGLE_CLIENT_SECRET "$GOOGLE_CLIENT_SECRET" "$target"
  inject_var AUTH_TRUST_HOST "true" "$target"
  # USE_NEON_ADAPTER: fixed flag, not a per-deployment secret — same pattern
  # as AUTH_TRUST_HOST above. Injected as the literal string "true" on both
  # production and preview (lib/prisma.ts does an exact-match check, so any
  # other value is treated as unset). Vercel+Neon only; GCP Cloud Run and
  # local/CI never set this var and keep using the PrismaPg branch
  # unconditionally (cmd_692/cmd_711/cmd_712). See .env.example for the
  # branch this flips in lib/prisma.ts.
  inject_var USE_NEON_ADAPTER "true" "$target"
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
