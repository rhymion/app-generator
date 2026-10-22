#!/bin/bash
# Says whether the mobile Playwright gate step applies to a change.
#
# Usage: bash scripts/mobile_pw_gate_applies.sh [<base-ref>]   (default base: origin/develop)
# Prints "yes" when the diff between <base-ref> and HEAD (plus uncommitted changes) touches a path that
# the mobile Playwright suite (`npm run test:e2e:mobile:pw`) exercises, "no" otherwise. The CI job
# `mobile-playwright` and the update-generator gate (.claude/commands/update-generator.md) use the same
# list, so they cannot drift. Fails closed: when the base cannot be resolved it prints "yes".
set -euo pipefail

BASE="${1:-origin/develop}"

PATHS=(
  'mobile'                                                  # Expo app, its specs, proxy and runner scripts
  'code_generator/templates/mobile'                         # templates of the generated Expo app
  'code_generator/mobile_entities.py'                       # which entities get native screens
  'code_generator/mobile_nav.py'                            # footer tabs and drill-down
  'code_generator/generate.py'                              # renders the Expo project (the mobile target)
  'code_generator/validate.py'                              # x-generator.mobile validation
  'code_generator/tests/fixtures/mobile_entity_e2e_gate'    # fixture schema of the fixture mode
  'code_generator/tests/fixtures/scheduled_task_e2e_gate'   # fixture schema of the scheduled mode
  'scripts/compose_child_datagrid_e2e_fixture.py'           # merges those fixtures
  'scripts/run_mobile_entity_playwright.sh'                 # the runner itself
  'scripts/mobile_pw_gate_applies.sh'                       # this list
  '.github/workflows/ci.yml'                                # the CI job that runs this suite
)

if ! git rev-parse --verify --quiet "$BASE^{commit}" >/dev/null; then
  echo "yes"
  exit 0
fi

if [ -n "$(git diff --name-only "$BASE" -- "${PATHS[@]}")" ]; then
  echo "yes"
else
  echo "no"
fi
