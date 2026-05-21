#!/usr/bin/env bash
PROJ_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MARKER="$PROJ_ROOT/.env.current"

if [[ ! -f "$MARKER" ]]; then
  echo "No environment set. Run: npm run env:use -- <test|cloud>"
  exit 1
fi

ENV_NAME=$(grep '^env=' "$MARKER" | cut -d= -f2)
MODE=$(grep '^mode=' "$MARKER" | cut -d= -f2)
SRC=$(grep '^src=' "$MARKER" | cut -d= -f2)

# .envの実態を確認
if [[ -L "$PROJ_ROOT/.env" ]]; then
  ACTUAL=$(readlink "$PROJ_ROOT/.env")
  STATUS="symlink → $ACTUAL"
elif [[ -f "$PROJ_ROOT/.env" ]]; then
  STATUS="regular file (copy)"
else
  STATUS="MISSING (.env not found)"
fi

echo "Current env : $ENV_NAME"
echo "Source file : $SRC"
echo "Mode        : $MODE"
echo ".env status : $STATUS"
