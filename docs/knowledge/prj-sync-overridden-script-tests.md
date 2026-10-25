# prj:sync skips a generator test whose script the consumer replaces

`scripts/grant-all-permissions.test.ts` asserts the generator's own
`scripts/grant-all-permissions.ts` against a fake client that provides only
`role` and `permission`. A consumer may replace that script through `prj/`
(for example to grant department roles). `prj:sync` copies the variant over the
generator script, and the generator test then runs against a script with a
different contract: every example in the file fails in the consumer's
`npm run test:vitest`, although the generator's own copy passes (Issue #1070).

## Behavior

- `scripts/prj_sync.py` keeps a table, `GENERATOR_TESTS_OF_OVERRIDABLE_SCRIPTS`,
  of generator script -> the generator test of that script.
- When `prj/` contains the script but not the test, the sync writes the test's
  path to `.prj-sync-excluded-tests.json` at the project root and prints
  `prj:sync: generator test <path> excluded`. `vitest.config.ts` adds the listed
  paths to its `exclude` list.
- The list is rewritten on every sync. Removing the script from `prj/`, or adding
  a test of the consumer's own for it, brings the generator test back on the
  next sync.
- A checkout that never ran `prj:sync` has no list, so every generator test runs.
  The file is gitignored: it describes this checkout's own sync.

The consumer's variant is then covered only by whatever test `prj/` ships for it.
To cover another overridable script, add it to the table; the condition is
machine-checkable (a file exists in `prj/`), so no gate step is skipped by hand.

Tests: `code_generator/tests/test_prj_sync_overridden_script_tests.py`.
