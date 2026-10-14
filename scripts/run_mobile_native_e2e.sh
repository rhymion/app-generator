#!/bin/bash
# Entry point for the generated native (Maestro) flows of the Expo app.
#
# generate-code writes one Maestro flow per entity that has native screens to
# mobile/e2e/generated/maestro/ (git-ignored; code_generator/mobile_e2e.py). This script checks them and,
# when an Android emulator or device is attached, runs them.
#
# Usage: bash scripts/run_mobile_native_e2e.sh [validate|run]
#
#   validate (default)  Checks the syntax of every generated flow with `maestro check-syntax`. Needs the Maestro
#                       CLI only, no emulator and no APK. Exits non-zero when there is no flow or one is invalid.
#   run                 Installs APK on the attached Android device or emulator and runs every flow against the
#                       API at the URL the APK was built with. Exits 3 (UNAVAILABLE, never a silent pass) when
#                       the CLI, adb, the APK or an attached device is missing.
#
# Environment:
#   MAESTRO_BIN       maestro executable (default: maestro on PATH)
#   FLOW_DIR          generated flow directory (default: mobile/e2e/generated/maestro)
#   APK               path of the debug APK (run only)
#   ANDROID_SERIAL    adb serial to use when several devices are attached
#   E2E_EMAIL, E2E_PASSWORD   sign-in (default: the db:seed-baseline administrator)
#   E2E_APP_ID        Android application id of the APK (default: com.anonymous.<slug of mobile/app.json>)
#   E2E_REQUIRE_SEED_ROWS=1   also require every list to show at least one row
#
# The API the APK talks to (EXPO_PUBLIC_API_BASE_URL, baked in at build time), its database (db:seed-baseline,
# db:grant-all-permissions) and the APK build are prepared by the caller; see docs/knowledge/mobile-app.md.
# Exit codes: 0 ok, 1 failure, 3 unavailable.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

MODE="${1:-validate}"
FLOW_DIR="${FLOW_DIR:-mobile/e2e/generated/maestro}"
MAESTRO="${MAESTRO_BIN:-maestro}"

unavailable() {
  echo "mobile-native-e2e: UNAVAILABLE: $1" >&2
  exit 3
}

command -v "$MAESTRO" >/dev/null 2>&1 || unavailable "the Maestro CLI is not installed ($MAESTRO); set MAESTRO_BIN."

shopt -s nullglob
flows=("$FLOW_DIR"/*.yaml)
if [ "${#flows[@]}" -eq 0 ]; then
  echo "mobile-native-e2e: no generated flow in $FLOW_DIR; run generate-code with x-generator.mobile.enabled and at least one entity with native screens." >&2
  exit 1
fi

case "$MODE" in
  validate)
    failed=0
    for f in "${flows[@]}" "$FLOW_DIR"/subflows/*.yaml; do
      result="$("$MAESTRO" check-syntax "$f" 2>&1 | tail -n 1)"
      if [ "$result" != "OK" ]; then
        echo "mobile-native-e2e: INVALID $f: $result" >&2
        failed=1
      fi
    done
    if [ "$failed" -ne 0 ]; then exit 1; fi
    echo "mobile-native-e2e: validated ${#flows[@]} flow(s) + sign-in subflow in $FLOW_DIR (syntax only; nothing was executed)"
    ;;
  run)
    command -v adb >/dev/null 2>&1 || unavailable "adb is not on PATH."
    [ -n "${APK:-}" ] && [ -f "$APK" ] || unavailable "APK is not set to an existing file."
    devices="$(adb devices | awk 'NR>1 && $2=="device" {print $1}')"
    if [ -z "$devices" ]; then
      if [ -e /dev/kvm ] && [ ! -r /dev/kvm -o ! -w /dev/kvm ]; then
        unavailable "no device attached, and /dev/kvm is not accessible to this user (the Android emulator cannot start)."
      fi
      unavailable "no Android device or emulator is attached (adb devices)."
    fi
    slug="$(python3 -c "import json;print(json.load(open('mobile/app.json'))['expo']['slug'])" 2>/dev/null || true)"
    export E2E_APP_ID="${E2E_APP_ID:-com.anonymous.$(printf '%s' "$slug" | tr -cd 'a-zA-Z0-9')}"
    export E2E_EMAIL="${E2E_EMAIL:-admin@example.com}"
    export E2E_PASSWORD="${E2E_PASSWORD:-password123}"
    export E2E_RUN_ID="${E2E_RUN_ID:-$(date +%s)}"
    export E2E_REQUIRE_SEED_ROWS="${E2E_REQUIRE_SEED_ROWS:-0}"
    adb install -r "$APK" >/dev/null
    "$MAESTRO" test \
      -e E2E_APP_ID="$E2E_APP_ID" -e E2E_EMAIL="$E2E_EMAIL" -e E2E_PASSWORD="$E2E_PASSWORD" \
      -e E2E_RUN_ID="$E2E_RUN_ID" -e E2E_REQUIRE_SEED_ROWS="$E2E_REQUIRE_SEED_ROWS" \
      "$FLOW_DIR"
    ;;
  *)
    echo "mobile-native-e2e: unknown mode '$MODE' (expected validate or run)." >&2
    exit 1
    ;;
esac
