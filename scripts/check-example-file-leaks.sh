#!/bin/bash
# Fail-closed scan for real-looking credential/identifier values leaking into
# `.example` template files (cmd_829). A `.example` file is a committed
# template showing *shape*, not real values -- app-generator is a public
# repo, so any real value written here ships to the world, permanently, the
# moment it is committed. This gate does not (and cannot) undo a leak already
# in git history; it only stops a NEW one from landing.
#
# Placeholders must not accidentally match the very patterns below -- prefer
# a value that breaks the character-class run (e.g. underscores/words)
# instead of a same-character run like "xxxxxxxxxxxxxxxxxxxx", which is
# itself 20+ alnum chars and would trip this gate.
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT" || { echo "not inside a git work tree -- failing closed" >&2; exit 1; }

# Env-var KEY prefixes allowlisted globally regardless of value. Each entry
# must name why it can never carry a real secret.
ALLOWLIST_KEY_PATTERNS=(
  '^NEXT_PUBLIC_'  # inlined into the client bundle at build time by design -- never secret-bearing
)

# Value patterns that indicate a real (non-placeholder) credential/identifier.
LEAK_PATTERNS=(
  'team_[A-Za-z0-9]{20,}'
  'ghp_[A-Za-z0-9]{20,}'
  'github_pat_[A-Za-z0-9_]{20,}'
  'sk-[A-Za-z0-9]{20,}'
  'npm_[A-Za-z0-9]{20,}'
  '[A-Za-z0-9+/]{32,}={0,2}'
)

# Hostname allowlist for postgres(ql):// URLs -- placeholders only, never a
# real reachable host.
HOST_ALLOWLIST_REGEX='^(localhost|127\.0\.0\.1|host|hostname|your[-_]?host|dbhost|db|<[^>]*>|x{3,}|\$\{[^}]*\}|\$[A-Za-z_][A-Za-z0-9_]*)$'

mapfile -t example_files < <(git ls-files -z | tr '\0' '\n' | grep -E '(^|/)[^/]*\.example$' || true)

if [ "${#example_files[@]}" -eq 0 ]; then
  echo "example-file credential leak check: OK (0 .example files tracked)"
  exit 0
fi

fail=0

is_key_allowlisted() {
  local key="$1" pat
  for pat in "${ALLOWLIST_KEY_PATTERNS[@]}"; do
    if [[ "$key" =~ $pat ]]; then
      return 0
    fi
  done
  return 1
}

trim() {
  local s="$1"
  s="${s#"${s%%[![:space:]]*}"}"
  s="${s%"${s##*[![:space:]]}"}"
  printf '%s' "$s"
}

for f in "${example_files[@]}"; do
  [ -f "$f" ] || continue
  while IFS= read -r raw; do
    lineno="${raw%%:*}"
    line="${raw#*:}"
    stripped="$(trim "$line")"
    case "$stripped" in
      '#'*|'') continue ;;
    esac
    case "$stripped" in
      *=*) : ;;
      *) continue ;;  # not a KEY=VALUE line -- nothing to scan
    esac
    key="$(trim "${stripped%%=*}")"
    if is_key_allowlisted "$key"; then
      continue
    fi
    value="${stripped#*=}"
    value="${value%%#*}"  # drop a trailing inline comment before matching

    if [[ "$value" =~ postgres(ql)?://([^/@[:space:]]*@)?([^/:[:space:]\"\']+) ]]; then
      host="${BASH_REMATCH[3]}"
      host_lc="$(printf '%s' "$host" | tr '[:upper:]' '[:lower:]')"
      if ! [[ "$host_lc" =~ $HOST_ALLOWLIST_REGEX ]]; then
        echo "LEAK: $f:$lineno: postgres(ql):// URL with non-placeholder host '$host' (key=$key)" >&2
        fail=1
      fi
    fi

    for pat in "${LEAK_PATTERNS[@]}"; do
      if [[ "$value" =~ $pat ]]; then
        echo "LEAK: $f:$lineno: value for '$key' matches /$pat/" >&2
        fail=1
      fi
    done
  done < <(grep -n '' "$f")
done

if [ "$fail" -ne 0 ]; then
  echo "example-file credential leak check FAILED -- see LEAK lines above" >&2
  exit 1
fi

echo "example-file credential leak check: OK (${#example_files[@]} file(s) scanned)"
