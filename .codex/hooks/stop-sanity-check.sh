#!/usr/bin/env bash
set -euo pipefail

cat <<'JSON'
{
  "continue": true,
  "systemMessage": "Before stopping, state the task type (generate-schema, update-generator, add-component, update-code, or investigate per AGENTS.md), report the required gate status or investigate no-edit status, and confirm nothing from the original request remains outstanding."
}
JSON
