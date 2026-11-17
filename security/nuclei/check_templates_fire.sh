#!/usr/bin/env bash
# Shows that every Nuclei template matches a deliberately broken app.
#
#   bash security/nuclei/check_templates_fire.sh [port]
#
# Requires nuclei and python3 on PATH. Exits non-zero when a template does not
# report a finding against security/nuclei/broken_app.py.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
port="${1:-18765}"

python3 "$here/broken_app.py" "$port" &
server_pid=$!
trap 'kill "$server_pid" 2>/dev/null || true' EXIT
for _ in $(seq 1 50); do
  (exec 3<>"/dev/tcp/127.0.0.1/$port") 2>/dev/null && break
  sleep 0.1
done

out="$(mktemp)"
nuclei -t "$here/templates" -u "http://127.0.0.1:$port" -jsonl -silent \
  -disable-update-check -o "$out" >/dev/null 2>&1 || true

status=0
for template in "$here"/templates/*.yaml; do
  id="$(sed -n 's/^id: //p' "$template" | head -n 1)"
  if grep -q "\"template-id\":\"$id\"" "$out"; then
    echo "fires: $id"
  else
    echo "DOES NOT FIRE: $id" >&2
    status=1
  fi
done
rm -f "$out"
exit "$status"
