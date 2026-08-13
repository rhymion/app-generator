#!/usr/bin/env python3
"""Lint only the files prj:sync just copied/merged from ../prj.

Consumer-side lint is not a copy of this generator's own lint: this
generator's own `lint` script (see package.json) lints this repo's
committed templates and is measured against by this repo's own CI Lint
job. A consumer (app-template, inventory-app, ...) has no schema of its
own inside this repo to generate against, so it needs a different,
narrower check: does the consumer's own hand-written prj/ content pass
ESLint, once synced to its real destination paths? Running the
consumer's lint step against the full generated codebase (post
generate-code) would measure hundreds of pre-existing, per-entity
template-instantiation warnings that have nothing to do with prj/'s own
content and are already covered by this generator's own gate/CI (see
cmd_682, cmd_600, docs/knowledge/lint-gate-must-match-ci-precondition.md).

This script is the (a) implementation ruled on 2026-08-13 (cmd_683):
run prj:sync, take its own stdout as the single source of truth for
"what did prj:sync just write" (never re-derive that list by walking
../prj independently -- prj_sync.py's own copied/merged log lines ARE
the list), filter to .ts/.tsx, and lint exactly those files at their
synced destination paths (so file-scoped ESLint overrides, e.g. for
cypress/**, apply exactly as they would post generate-code).

Deliberately fail-closed: if the extracted file list is empty for any
reason (no ../prj sibling directory, or a real ../prj with zero
.ts/.tsx content), this is treated as a failure, not a silent pass.
Silently linting nothing and exiting 0 is a worse failure mode than a
loud error -- a gate that can go green without ever running is a bug
class this repo has hit before (candidate (i)'s naive invocation in
subtask_664b linted 0 files and exited 0; this script exists partly to
avoid ever reproducing that shape here).

Unlike this generator's own `lint` script, this script does not cap
the ESLint warning count (no --max-warnings). It only fails on ESLint
errors, or on the zero-files fail-closed check above. Warnings are
printed for visibility but do not block the gate -- this mirrors the
original (a) investigation (subtask_664b), which measured "exit 0, 0
errors, N warnings" as success. This generator's own `--max-warnings 20`
ceiling was calibrated for this repo's own small, stable template
surface; a consumer's prj/ content is expected to grow over time as
hand-written specs/source are added, and capping it at a number
inherited from an unrelated population would either force it stale
immediately or require constant recalibration for a reason unrelated to
actual defects. If a future need arises for a warning ceiling on prj/
content specifically, that is a separate decision, not something this
script should decide unilaterally.

Run from this generator's own root: `python3 scripts/lint_prj_synced.py`
(this is also wired up as `npm run lint:prj`). A consumer project calls
this indirectly, through the submodule: `npm --prefix app-generator run
lint:prj`.
"""
from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
PRJ_SYNC_SCRIPT = PROJECT_ROOT / "scripts" / "prj_sync.py"

# Matches prj_sync.py's own log line formats exactly:
#   "prj:sync: copied <rel>"
#   "prj:sync: copied (new) <rel>"   (messages/*.json with no system default)
#   "prj:sync: merged <rel>"
# The optional "(new) " marker only ever appears for messages/*.json in the
# current prj_sync.py implementation (never .ts/.tsx), but is handled here
# so a path is still extracted correctly if that ever changes.
SYNC_LINE_RE = re.compile(r"^prj:sync: (?:copied|merged)(?: \(new\))? (.+)$")

TS_SUFFIXES = (".ts", ".tsx")


def run_prj_sync() -> str:
    """Run prj:sync and return its captured stdout (stderr passes through live)."""
    result = subprocess.run(
        [sys.executable, str(PRJ_SYNC_SCRIPT)],
        cwd=PROJECT_ROOT,
        capture_output=True,
        text=True,
    )
    # Surface prj_sync.py's own warnings (e.g. invalid JSON in messages/*.json)
    # immediately, even though this script continues past them.
    if result.stderr:
        print(result.stderr, file=sys.stderr, end="")
    if result.returncode != 0:
        print(
            f"lint:prj: prj_sync.py exited {result.returncode} -- aborting "
            "before any lint attempt (fail-closed).",
            file=sys.stderr,
        )
        sys.exit(result.returncode)
    print(result.stdout, end="")
    return result.stdout


def extract_ts_files(prj_sync_stdout: str) -> list[str]:
    files = []
    for line in prj_sync_stdout.splitlines():
        m = SYNC_LINE_RE.match(line)
        if not m:
            continue
        rel = m.group(1)
        if rel.endswith(TS_SUFFIXES):
            files.append(rel)
    return files


def main() -> int:
    stdout = run_prj_sync()
    ts_files = extract_ts_files(stdout)

    if not ts_files:
        print(
            "lint:prj: FAIL-CLOSED -- prj:sync reported zero .ts/.tsx files "
            "to lint. This is treated as a failure, not a pass: either "
            "../prj does not exist, or it exists but has no .ts/.tsx "
            "content today. A gate that silently lints nothing and exits 0 "
            "is worse than one that fails loudly (see this script's "
            "module docstring). If this is a genuinely fresh consumer "
            "with no hand-written prj/ TS content yet, that is expected "
            "to be a temporary state, not a permanent green.",
            file=sys.stderr,
        )
        return 1

    print(f"lint:prj: {len(ts_files)} .ts/.tsx file(s) synced from prj/, linting:")
    for f in ts_files:
        print(f"  {f}")

    eslint = subprocess.run(["npx", "eslint", *ts_files], cwd=PROJECT_ROOT)
    return eslint.returncode


if __name__ == "__main__":
    sys.exit(main())
