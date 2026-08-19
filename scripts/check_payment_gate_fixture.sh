#!/bin/bash
# Payment-gate fixture check (subtask_753a / cmd_753).
#
# Runs a small, self-contained fixture entity (x-payment: true) through the
# real build_user_schema.py -> generate.py -> tsc pipeline and type-checks
# the write-once Stripe integration stubs: lib/stripe.ts,
# app/api/payment/checkout/route.ts, app/api/webhooks/stripe/route.ts.
#
# Why this exists: this repo's own json_schema.yaml declares no x-payment
# key anywhere, so no CI job ever type-checks the Stripe stub templates --
# a Stripe SDK apiVersion literal drift (cmd_753) went undetected for this
# exact reason. code_generator/tests/test_payment_gate_fixture.py already
# proves the stubs are *written*; this script proves the written stubs
# *type-check* against whatever Stripe SDK version is actually installed.
# Mirrors scripts/check_decimal_gate_fixture.sh's structure and rationale.
#
# Usage: bash scripts/check_payment_gate_fixture.sh
# Exit code: 0 = pass, non-zero = fail (schema/generation error or a real
# tsc type error).

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

FIXTURE_DIR="code_generator/tests/fixtures/payment_gate"
OUT_DIR="$REPO_ROOT/.generated-payment-gate"

if [ ! -f "$FIXTURE_DIR/json_schema.yaml" ] || [ ! -f "$FIXTURE_DIR/schema.prisma" ]; then
  echo "payment-gate fixture check: fixture files not found under $FIXTURE_DIR" >&2
  exit 1
fi

echo "== payment-gate fixture check =="
t0=$(date +%s.%N)

rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR/prisma" "$OUT_DIR/lib" "$OUT_DIR/app/api"
cp "$FIXTURE_DIR/schema.prisma" "$OUT_DIR/prisma/schema.prisma"

echo "-- build_user_schema.py (Stage 4 -> intermediate) --"
python3 code_generator/build_user_schema.py \
  "$FIXTURE_DIR/json_schema.yaml" \
  "$OUT_DIR/prisma/schema.prisma" \
  --out "$OUT_DIR/generated_json_schema.yaml"

echo "-- generate.py (intermediate -> TS) --"
python3 code_generator/generate.py "$OUT_DIR/generated_json_schema.yaml" "$OUT_DIR"

if [ ! -f "$OUT_DIR/lib/stripe.ts" ]; then
  echo "payment-gate fixture check: lib/stripe.ts was not written -- the" >&2
  echo "x-payment: true write-once stub mechanism did not fire." >&2
  exit 1
fi

# Fixture-only shim for @/lib/authz -- see fixtures/payment_gate/shims/ for
# the source of truth and why this exists rather than the real file.
cp "$FIXTURE_DIR/shims/authz.ts" "$OUT_DIR/lib/authz.ts"
cp "$FIXTURE_DIR/tsconfig.json" "$OUT_DIR/tsconfig.json"

echo "-- tsc --noEmit (lib/stripe.ts + checkout route + webhook route) --"
set +e
npx tsc -p "$OUT_DIR/tsconfig.json"
tsc_status=$?
set -e

t1=$(date +%s.%N)
elapsed=$(echo "$t1 - $t0" | bc)
echo "== payment-gate fixture check: $(printf '%.1f' "$elapsed")s, tsc exit=$tsc_status =="

if [ "$tsc_status" -ne 0 ]; then
  echo "payment-gate fixture check FAILED -- the Stripe integration stub" >&2
  echo "templates (see scripts/check_payment_gate_fixture.sh header) no" >&2
  echo "longer type-check against the installed Stripe SDK version." >&2
  exit "$tsc_status"
fi

exit 0
