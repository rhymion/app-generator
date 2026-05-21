#!/usr/bin/env bash
PROJ_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

if [[ ! -f "$PROJ_ROOT/.env" ]]; then
  echo "Error: .env not found. Run 'npm run env:use -- <test|cloud>' first." >&2
  exit 1
fi
