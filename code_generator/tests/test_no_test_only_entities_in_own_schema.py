"""
Fail-closed guard: this repo's own dogfood schema (`code_generator/
json_schema.yaml`) must never declare a test-only fixture entity of its
own. Test-only entities belong in a *consumer's* schema (e.g.
`app-template`'s permanent `approval_edit_terminal_test` regression
fixture) -- never in app-generator's own committed json_schema.yaml.

This is a real-world repeat offense, not a hypothetical: subtask_846c
added an `approval_edit_terminal_test` entity to this repo's own schema
as "dogfood fixture coverage" for the post-approval edit/delete/
invalidate lockdown feature, and subtask_846d had to strip it back out
after the same mistake was made a second time. This test exists so a
third occurrence is caught by a gate step instead of a human re-reading
every schema diff.

Why this check lives here, as a standalone pytest test, and NOT inside
validate_schema() / the shared generate.py validation pipeline: that
pipeline runs identically whether it is validating THIS repo's own
committed json_schema.yaml or a consumer's schema after prj:sync has
overwritten the same on-disk path with the consumer's own content (see
docs/knowledge/appendix/approval-flow.md's Naming note in the post-
approval lockdown section) -- a consumer is fully entitled to declare its
own `*_test`-suffixed permanent regression fixture (app-template already
does), so a rule inside that shared pipeline would false-positive on
every consumer generate-code run. `npm run test:pytest` (this test's
runner), by contrast, is invoked ONLY by this repo's own CI/gate --
no consumer's package.json ever calls it -- so reading `code_generator/
json_schema.yaml` directly by a path relative to this repo's own root is
safe: at the moment this test runs, that path is always this repo's own
committed content, never a consumer's synced-in overlay.
"""
from pathlib import Path

import yaml

SCHEMA_PATH = Path(__file__).parent.parent / "json_schema.yaml"

# Same naming shapes both real incidents used ("approval_edit_terminal_
# TEST", suffix form) plus the two natural synonyms/orderings a future
# occurrence might reach for. Deliberately narrow (not a bare "test"
# substring match) -- this repo's own schema has no legitimate reason to
# ever need any of these three shapes, so there is no false-positive risk
# to weigh against catching a real violation early.
_TEST_ONLY_NAME_SUFFIXES = ("_test", "_fixture")
_TEST_ONLY_NAME_PREFIXES = ("test_",)


def _test_only_entity_names(definitions: dict) -> list[str]:
    names = []
    for key in definitions:
        if key.startswith("__"):
            # Raw base half of a base/view split (e.g. `__role`) -- its
            # view-side name (`role`) is the one that matters for this
            # check and is already a separate `defs` key.
            continue
        if key.endswith(_TEST_ONLY_NAME_SUFFIXES) or key.startswith(_TEST_ONLY_NAME_PREFIXES):
            names.append(key)
    return sorted(names)


def test_detector_catches_an_injected_test_only_entity():
    """Prove the detector actually works before trusting its silence
    below (an injected violation must first be shown to trip the check)."""
    defs = {
        "user": {},
        "role": {},
        "approval_edit_terminal_test": {},
    }
    assert _test_only_entity_names(defs) == ["approval_edit_terminal_test"]


def test_detector_catches_prefix_and_fixture_suffix_variants():
    defs = {
        "user": {},
        "test_widget": {},
        "widget_fixture": {},
    }
    assert _test_only_entity_names(defs) == ["test_widget", "widget_fixture"]


def test_detector_does_not_flag_ordinary_entity_names():
    defs = {
        "user": {},
        "role": {},
        "approval_flow": {},
        "dashboard_widget": {},
        "__role": {},  # raw base half of a split pair -- not a violation
    }
    assert _test_only_entity_names(defs) == []


def test_own_schema_declares_no_test_only_entity():
    """The real, committed json_schema.yaml this repo ships must be clean.

    This is the actual gate: `npm run test:pytest` runs unconditionally
    in this repo's own CI on every push/PR, so a future re-addition of a
    test-only entity to this file fails this test immediately instead of
    surfacing later as a build/PR-conflict surprise.
    """
    with open(SCHEMA_PATH) as f:
        schema = yaml.safe_load(f)
    definitions = schema.get("definitions", {})
    violations = _test_only_entity_names(definitions)
    assert violations == [], (
        f"code_generator/json_schema.yaml declares test-only entity name(s) "
        f"{violations} -- test-only fixture entities belong in a consumer's "
        f"own schema (e.g. app-template's permanent regression fixtures), "
        f"never in this repo's own dogfood schema. Remove the entity (and "
        f"its associated prisma/schema.prisma model, seed-entities.ts, nav "
        f"config, and message-catalog entries) from this repo; if runtime "
        f"verification of a generator feature against a real entity is "
        f"needed, verify against an existing consumer entity in a throwaway "
        f"isolated worktree instead (see docs/knowledge/appendix/"
        f"approval-flow.md's Naming note in the post-approval lockdown "
        f"section for the precedent)."
    )
