#!/usr/bin/env bash
# Lightweight check: active env profile is set and .env / .env.local point to the same src.
set -euo pipefail

PROJ_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MARKER="$PROJ_ROOT/.env.current"

if [[ ! -f "$MARKER" ]]; then
  echo "Error: No active env profile found." >&2
  echo "       Run 'npm run env:use -- <test|cloud>' first." >&2
  exit 1
fi

CURRENT_ENV=$(grep '^env=' "$MARKER" | cut -d= -f2)
SRC=$(grep '^src=' "$MARKER" | cut -d= -f2)

for file in .env .env.local; do
  if [[ ! -L "$PROJ_ROOT/$file" ]]; then
    echo "Error: $file is not a symlink. Run 'npm run env:use -- $CURRENT_ENV'." >&2
    exit 1
  fi
  TARGET="$(readlink "$PROJ_ROOT/$file")"
  if [[ "$TARGET" != "$SRC" ]]; then
    echo "Error: $file points to $TARGET, expected $SRC. Run 'npm run env:use -- $CURRENT_ENV'." >&2
    exit 1
  fi
done

echo "✓ Active env: $CURRENT_ENV (src: $SRC)"
echo "  .env      -> $SRC"
echo "  .env.local -> $SRC"
