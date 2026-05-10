#!/usr/bin/env bash
set -euo pipefail

cat <<'JSON'
{
  "continue": true,
  "systemMessage": "Before stopping, state the task type (A/B/C per AGENTS.md), report the required gate status or Type C no-edit status, and confirm nothing from the original request remains outstanding."
}
JSON
