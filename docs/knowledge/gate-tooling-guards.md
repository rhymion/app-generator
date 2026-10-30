# Gate tooling guards

Two guards protect the local completion gate and CI from failure modes that only show up when the gate is run in a particular way.

## Tracked source must not import generated files: `npm run check:tracked-generated-imports`

CI's Unit Tests job runs `npm ci`, `npm run db:generate` and `npm run test:vitest` on a clean checkout, with no `generate-code`. A tracked file that statically imports a git-ignored generated file (for example `lib/<entity>/service.ts`) resolves in a worktree where `generate-code` already ran, so the local gate stays green, and then fails to resolve in CI.

`code_generator/check_tracked_generated_imports.py` decides from the git index and the ignore rules, never from what exists on disk, so it gives the same answer on a clean checkout and on a generated tree.

- **Which files**: tracked `.ts` / `.tsx` files, except under `code_generator/`, `cypress/`, `mobile/`, `scripts/`, `docs/` (code that only runs after generation or is not part of the app). A file that is not yet tracked (`git add` it first) is not scanned.
- **Which imports**: static `import ... from`, `import '...'` and `export ... from` specifiers that are relative or use the `@/` alias, including multi-line lists and type-only imports. Dynamic `import()` and commented-out imports are ignored.
- **What is flagged**: a specifier with no tracked candidate path (`<p>.ts`, `<p>.tsx`, `<p>/index.ts`, ...) where a candidate is git-ignored. Anything under `app/generated/prisma/` passes because CI runs `db:generate` first.
- **Exemptions**: `code_generator/check_tracked_generated_imports_allowlist.yaml` (or a file passed with `--allowlist`) lists deliberate generated-caller wiring: the importing `path`, the imported `targets` and a required `reason`. An entry that no longer matches a flagged import is reported as stale. Do not add an entry to silence a new import; first check that the importing file is not reached by the clean-checkout Unit Tests job.
- **Where it runs**: `code_generator/tests/test_check_tracked_generated_imports.py` runs it against this repository, so it is part of `npm run test:pytest` (gate step 2 and the CI `pytest` job). `npm run check:tracked-generated-imports` runs it on its own. Exit status: 0 clean, 1 violations or stale entries, 2 configuration error.

## One run per checkout for the disposable-stack e2e gates

`test:child-datagrid-e2e-gate`, `test:list-child-e2e-gate`, `test:comment-rest-e2e-gate`, `test:scheduled-task-e2e-gate`, `test:version-of-e2e-gate` and `test:security-matrix-e2e-gate` derive their build directory, docker compose project and ports from the checkout path alone. Their startup tears down whatever it finds under those names, assuming a previous run was interrupted. A second invocation in the same checkout while the first was still alive therefore removed the first run's containers and build directory and left it orphaned.

Each script now sources `scripts/gate_run_lock.sh` and calls `gate_run_lock "$BUILD_DIR.lock" <label>` before it installs its cleanup trap. The helper takes a non-blocking `flock` on `.generated-<name>-e2e-gate.lock` (git-ignored, next to the build directory). While another run holds it, the new run prints that another run is still active and exits 1 without touching the stack. The kernel releases the lock when the run and its process tree exit, however they exit, so a killed run never leaves a stale lock. An orphaned child of a dead run keeps the lock until it exits, which is correct: its stack is still in use.

`code_generator/tests/test_gate_run_lock.py` covers refusal while a holder is alive, release after the holder dies, and, for every `check_*_e2e_gate_fixture.sh`, that a refused run leaves the first run's build directory untouched.

Two worktrees still never collide: the hash includes the absolute checkout path.
