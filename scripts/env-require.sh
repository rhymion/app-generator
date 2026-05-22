#!/usr/bin/env bash
set -euo pipefail

REQUIRED_ENV="${1:-}"
PROJ_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MARKER="$PROJ_ROOT/.env.current"

if [[ -z "$REQUIRED_ENV" ]]; then
  echo "Usage: env-require.sh <test|cloud>" >&2
  exit 1
fi

if [[ ! -f "$MARKER" ]]; then
  echo "Error: No active env profile. Run 'npm run env:use -- $REQUIRED_ENV' first." >&2
  exit 1
fi

CURRENT_ENV=$(grep '^env=' "$MARKER" | cut -d= -f2)

if [[ "$CURRENT_ENV" != "$REQUIRED_ENV" ]]; then
  echo "Error: This command requires env=$REQUIRED_ENV, but current env=$CURRENT_ENV." >&2
  echo "       Run 'npm run env:use -- $REQUIRED_ENV' first." >&2
  exit 1
fi
