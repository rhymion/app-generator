"""Regression tests for cmd_607's post-render dead-code cleanup helpers in
generate.py.

Both helpers exist because the *set* of Jinja2 conditions under which a
rendered cypress spec's helper function / `.then()` callback param actually
gets referenced is large and scattered across the template (many independent
per-scenario branches). Rather than duplicate every one of those conditions
in Python to gate the definition/param name precisely — which would silently
drift out of sync as scenarios are added — both helpers inspect the fully
rendered TypeScript text itself and act only when nothing in the output
actually uses the binding. See docs/knowledge/cmd607-generator-lint-debt-fix.md.

cmd_618: cmd_614 widened exactRe() past self-ref-only, which rewrote the
comment above the function — desyncing _EXACT_RE_HELPER_RE's old
comment-anchored regex (it silently stopped matching, so the "unused" strip
quietly stopped firing at all, with no error and no test failure). Both
helpers were re-anchored on JS/TS structure that doesn't depend on comment
prose, and both now raise instead of silently no-op'ing when their input
diverges from a recognized shape. The tests below cover: the exact scenario
that broke (widened comment text), the real formatting variance already
present in the templates that the old bare `.then((\\w+)) => {` never
matched (typed params, `async`), and the loud-failure path itself.
"""
from generate import (
    _strip_unused_exact_re_helper,
    _prefix_unused_then_callback_params,
    _check_then_callback_coverage,
)
import pytest

_EXACT_RE_BLOCK = (
    "\n\n// A self-referential dependency record (e.g. a split-lineage decoy created by\n"
    "// populateThingDependencies()) can share a substring with the record\n"
    "// this spec creates via the UI (cmd_592) — cy.contains() is substring-based,\n"
    "// so row lookups keyed on a dep's display name need an exact-match anchor\n"
    "// instead.\n"
    "function exactRe(text: string): RegExp {\n"
    "  return new RegExp('^' + text.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&') + '$');\n"
    "}\n"
)


def test_strip_exact_re_helper_when_never_called():
    content = "import { TEST_CREDENTIALS } from '../support/test-credentials';" + _EXACT_RE_BLOCK + "\ndescribe('x', () => {});\n"
    out = _strip_unused_exact_re_helper(content)
    assert 'function exactRe' not in out
    assert 'exactRe(' not in out
    # Nothing else in the file was touched.
    assert "describe('x', () => {});" in out


def test_keep_exact_re_helper_when_called():
    content = (
        "import { TEST_CREDENTIALS } from '../support/test-credentials';"
        + _EXACT_RE_BLOCK
        + "\n      cy.contains(exactRe(deps.thing.name)).click();\n"
    )
    out = _strip_unused_exact_re_helper(content)
    assert 'function exactRe' in out
    assert out == content  # untouched — still called


def test_strip_exact_re_helper_noop_when_absent():
    content = "describe('x', () => {});\n"
    assert _strip_unused_exact_re_helper(content) == content


def test_then_callback_unused_param_gets_underscore_prefix():
    content = (
        "cy.task<any[]>('db:populateThing', 1).then((records) => {\n"
        "  cy.visit('/en/thing');\n"
        "  cy.contains('Thing 1').click();\n"
        "});\n"
    )
    out = _prefix_unused_then_callback_params(content)
    assert ".then((_records) => {" in out
    assert ".then((records) => {" not in out


def test_then_callback_used_param_is_left_alone():
    content = (
        "cy.task<any[]>('db:populateThing', 1).then((records) => {\n"
        "  cy.visit(`/en/thing/edit/${records[0].id}`);\n"
        "});\n"
    )
    out = _prefix_unused_then_callback_params(content)
    assert ".then((records) => {" in out
    assert '_records' not in out


def test_then_callback_handles_multiple_independent_blocks():
    """Each block is judged independently — one file commonly has both an
    unused-arg case (dead-code-eliminated) and a used-arg case (untouched),
    exactly as seen across real generated specs (cmd_607)."""
    content = (
        "it('a', () => {\n"
        "  cy.task<any[]>('db:populateThing', 1).then((records) => {\n"
        "    cy.contains('Thing 1').click();\n"
        "  });\n"
        "});\n"
        "it('b', () => {\n"
        "  cy.task<any>('db:populateThingDependencies').then((deps) => {\n"
        "    cy.visit(`/en/thing/new?parent=${deps.parent.id}`);\n"
        "  });\n"
        "});\n"
    )
    out = _prefix_unused_then_callback_params(content)
    assert ".then((_records) => {" in out
    assert ".then((deps) => {" in out
    assert "_deps" not in out


def test_then_callback_string_literal_braces_do_not_break_brace_matching():
    """A template literal containing `{`/`}` (e.g. `${rowNum}`) inside the
    callback body must not desync the brace-depth scan."""
    content = (
        "cy.task<any[]>('db:populateThing', 1).then((records) => {\n"
        "  cy.log(`Row ${records.length}: {not a real brace}`);\n"
        "});\n"
    )
    out = _prefix_unused_then_callback_params(content)
    # records IS referenced (inside the template literal) — must be kept.
    assert ".then((records) => {" in out
    assert '_records' not in out


def test_then_callback_shadowing_nested_same_name_declaration_alone_does_not_fake_a_use():
    """A nested `.then((records) => {...})` reusing the same param name
    shadows the outer one; the *declaration text itself* (`.then((records)
    => {`) must not count as a "use" of the outer binding, or an outer param
    that's otherwise genuinely dead would never get flagged just because a
    same-named nested callback happens to exist."""
    content = (
        "cy.task<any[]>('db:populateThing', 1).then((records) => {\n"
        "  cy.task<any[]>('db:populateOther', 1).then((records) => {\n"
        "    cy.visit('/en/other');\n"
        "  });\n"
        "});\n"
    )
    out = _prefix_unused_then_callback_params(content)
    assert "populateThing', 1).then((_records) => {" in out
    # Inner declaration is independently dead within its own body too.
    assert "populateOther', 1).then((_records) => {" in out


def test_then_callback_shadowing_with_genuine_inner_use_is_conservative():
    """Whole-word matching isn't scope-aware: a genuine reference inside a
    same-named nested block reads as "used" for the outer param too, so the
    outer binding is conservatively left unrenamed. This is the safe
    direction — a rename that turns out wrong would break compilation,
    whereas leaving a warning unfixed does not. This shadowing shape has not
    been observed in the actual generated specs (cmd_607: 0 warnings remain
    after the fix), so this is a documented limitation, not an active bug."""
    content = (
        "cy.task<any[]>('db:populateThing', 1).then((records) => {\n"
        "  cy.task<any[]>('db:populateOther', 1).then((records) => {\n"
        "    cy.log(records[0].id);\n"
        "  });\n"
        "});\n"
    )
    out = _prefix_unused_then_callback_params(content)
    assert "populateThing', 1).then((records) => {" in out  # left alone, not renamed
    assert 'cy.log(records[0].id);' in out


# --- cmd_618: comment-anchor desync + structural-anchor regressions -------

_EXACT_RE_BLOCK_WIDENED = (
    "\n\n// A dependency record's display name can share a substring with another\n"
    "// record (e.g. a split-lineage decoy created by populateThingDependencies(),\n"
    "// cmd_592) — cy.contains() is substring-based, so row lookups keyed on a\n"
    "// dep's display name need an exact-match anchor instead (cmd_614: widened\n"
    "// from self-ref-only to all entities — partial-match collisions aren't\n"
    "// specific to self-referential deps).\n"
    "function exactRe(text: string): RegExp {\n"
    "  return new RegExp('^' + text.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&') + '$');\n"
    "}\n"
)


def test_strip_exact_re_helper_survives_cmd614_comment_rewrite():
    """The exact regression that broke: cmd_614 widened exactRe() to every
    entity and rewrote the explanatory comment to match (dropping "A
    self-referential dependency record"). A comment-anchored regex would
    silently stop matching here — this must still strip cleanly."""
    content = "import x;" + _EXACT_RE_BLOCK_WIDENED + "\ndescribe('x', () => {});\n"
    out = _strip_unused_exact_re_helper(content)
    assert 'function exactRe' not in out
    assert "describe('x', () => {});" in out


def test_strip_exact_re_helper_keeps_widened_comment_block_when_called():
    content = (
        "import x;"
        + _EXACT_RE_BLOCK_WIDENED
        + "\n      cy.contains(exactRe(deps.thing.name)).click();\n"
    )
    out = _strip_unused_exact_re_helper(content)
    assert out == content  # untouched — still called


def test_strip_exact_re_helper_raises_on_shape_mismatch():
    """If the signature is present but the surrounding block no longer
    matches _EXACT_RE_HELPER_RE (e.g. the return statement was reformatted),
    fail loudly instead of silently leaving the helper — and the lint debt
    it exists to prevent — in place."""
    mangled = _EXACT_RE_BLOCK_WIDENED.replace(
        "return new RegExp('^' + text.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&') + '$');",
        "return new RegExp('^' + text + '$'); // reformatted",
    )
    content = "import x;" + mangled + "\ndescribe('x', () => {});\n"
    with pytest.raises(RuntimeError):
        _strip_unused_exact_re_helper(content)


def test_then_callback_typed_param_unused_gets_prefixed():
    """test_reservation_spec.cy.ts.jinja2 uses TS-typed callback params
    throughout (`.then((res: any) => {`) — the original bare `\\((\\w+)\\)`
    never matched these at all, silently leaving every one unprocessed."""
    content = "cy.task('x').then((res: any) => {\n  doStuff();\n});\n"
    out = _prefix_unused_then_callback_params(content)
    assert ".then((_res: any) => {" in out


def test_then_callback_typed_param_used_is_left_alone():
    content = "cy.task('x').then((res: any) => {\n  expect(res).to.eq(1);\n});\n"
    out = _prefix_unused_then_callback_params(content)
    assert ".then((res: any) => {" in out
    assert '_res' not in out


def test_then_callback_async_unused_gets_prefixed_keeping_async():
    content = "cy.task('x').then(async (win) => {\n  doStuff();\n});\n"
    out = _prefix_unused_then_callback_params(content)
    assert ".then(async (_win) => {" in out


def test_then_callback_no_param_left_untouched():
    content = "cy.task('x').then(() => {\n  doStuff();\n});\n"
    assert _prefix_unused_then_callback_params(content) == content


def test_then_callback_destructured_param_left_untouched():
    """Destructured params are a different eslint no-unused-vars shape
    (per-key, not per-binding) — deliberately out of scope for this
    prefix-with-underscore mechanism, not a miss."""
    content = "cy.task('x').then(({ mentionedUserId }) => {\n  use(mentionedUserId);\n});\n"
    assert _prefix_unused_then_callback_params(content) == content


def test_then_callback_coverage_raises_on_unrecognized_shape():
    """A `.then(` call whose parameter clause matches none of the three
    recognized shapes (no-param / destructured / named-with-optional-type)
    must fail generation loudly, not pass through silently unprocessed —
    the exact failure mode being fixed here."""
    content = "cy.task('x').then([a, b] => {\n  doStuff();\n});\n"
    with pytest.raises(RuntimeError):
        _check_then_callback_coverage(content)


def test_then_callback_coverage_silent_on_all_recognized_shapes():
    content = (
        "a.then((x) => {});\n"
        "b.then((y: any) => {});\n"
        "c.then(async (z) => {});\n"
        "d.then(() => {});\n"
        "e.then(({ k }) => {});\n"
    )
    _check_then_callback_coverage(content)  # must not raise
