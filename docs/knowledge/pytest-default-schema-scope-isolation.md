# pytest Default-Schema Scope Isolation

## The problem

`code_generator/tests/test_build_user_schema_roundtrip.py` has three tests that assert an
invariant about the framework's **own default schema** — they build from the on-disk
`code_generator/json_schema.yaml` + `prisma/schema.prisma` and compare the result against a
frozen reference fixture, or against the on-disk `json_schema_internal.yaml`:

- `test_stage4_derivation_matches_reference`
- `test_phase_a_golden_diff_zero`
- `test_default_schema_bridge_entities_are_unaffected_by_internal_file`

`scripts/prj_sync.py` overlays a consuming project's own schema onto this repo whenever a
sibling `../prj` directory exists (submodule-mount layout: `<consumer>/app-generator` +
`<consumer>/prj`) — it copies `prj/code_generator/json_schema.yaml` and `prj/prisma/schema.prisma`
verbatim over this repo's copies. `json_schema_internal.yaml` has no counterpart in `prj/`, so
`prj:sync` never touches it — it stays the framework default even after a sync.

If these three tests run **after** `prj:sync` has overlaid a consumer's schema (or in a tree
where it *would*, e.g. a submodule mount that hasn't synced yet but could at any time), they are
no longer testing the framework's default schema — they're testing whatever the consumer
happens to have. The failures this produces (a wall of unrelated content diffs against the frozen
reference, or divergent assertions about which entities the internal-merge file legitimately
fills in) look exactly like a real regression in `build_user_schema` or a real schema defect in
the consumer project. Neither the generator nor the consumer is actually broken — the test is
simply pointed at the wrong file for what it claims to verify.

This surfaced as a reported PR failure that reproduced with app-template's consumer data
overlaid but not on a plain app-generator checkout.

## The fix: fail loud, not silent, not confusing

Each of the three tests now calls `_fail_if_prj_synced_tree()` first. This checks for the same
sibling `../prj` directory `scripts/prj_sync.py` itself uses to decide whether it's mounted as a
submodule (`PRJ_DIR = PROJECT_ROOT.parent / "prj"`), and — if present — calls `pytest.fail()`
with a message naming the exact path and explaining that this class of test cannot run
meaningfully once a consumer schema may have been (or will be) overlaid.

This is a hard failure, never a skip: per this repo's `SKIP = FAIL` testing rule, silently
passing over these tests in a submodule-mounted tree would be indistinguishable from "all green"
in a report, which is worse than a loud, clearly-worded failure that tells you what tree you're
in and why it doesn't apply here.

CI's own `pytest` job (`.github/workflows/ci.yml`) checks out this repo standalone — no sibling
`prj/` is ever present there, so the guard is a no-op and these tests keep verifying the real
invariant exactly as before. The guard only fires when a human or agent manually runs `pytest`
inside a submodule-mounted tree (with or without having actually run `prj:sync` yet), which is
the scenario the guard exists to catch.

## Consequence for anyone running this gate

**Never run `code_generator/tests/test_build_user_schema_roundtrip.py` from a submodule-mounted
tree** (i.e. one with a sibling `../prj` directory) if you want these three tests to actually
verify anything. Run them from a standalone app-generator checkout, or in an isolated worktree
with no `../prj` sibling. If you need to verify the generator's behavior against a specific
consumer's schema, that is a different exercise (schema-derivation testing against that
consumer's own fixtures), not a case these framework-default invariant tests are meant to cover.
