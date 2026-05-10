"""
Regression tests for the 8.x.1 generated assertion block (flatten one-to-one
section).

Background
----------
The flatten section renders fields whose labels can collide with fields on the
outer parent form. For example, `checkup.total_testosterone` is a NumberField
on the parent and `checkup_judgment.total_testosterone` is an enum Autocomplete
inside the Checkup Judgment accordion. Both render a `<label>` with text
"Total Testosterone".

Earlier the 8.x.1 view-after-create assertions emitted a bare
`cy.openAccordion(...)` followed by `cy.checkField(...)` calls. `cy.checkField`
finds labels with `cy.get('label')` (page-wide), so the first matching label
wins — almost always the wrong one in this collision pattern.

The fix wraps the assertions in `cy.withinAccordion(<section>, () => { ... })`
so Cypress' `cy.within` scopes the inner `cy.get` calls to the accordion's
body. These tests pin the template structure and the helper command surface.
"""
import re
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
TEMPLATE = REPO_ROOT / 'code_generator' / 'templates' / 'test_spec.cy.ts.jinja2'
COMMANDS = REPO_ROOT / 'cypress' / 'support' / 'commands.ts'


def _read(path: Path) -> str:
    return path.read_text(encoding='utf-8')


def _block_8x1(template_src: str) -> str:
    """Return the source of the 8.x.1 (`it('8.{{ loop.index }}.1 ...')`) block."""
    match = re.search(
        r"it\('8\.\{\{ loop\.index \}\}\.1 create.*?\n      \}\);",
        template_src,
        re.DOTALL,
    )
    assert match is not None, "Could not locate the 8.x.1 it(...) block in the template"
    return match.group(0)


def test_8x1_assert_block_uses_within_accordion():
    """The 8.x.1 view-after-create assertions must be scoped to the accordion body."""
    block = _block_8x1(_read(TEMPLATE))

    # The wrapper must be present.
    assert "cy.withinAccordion('{{ rel.section_label }}', () => {" in block, (
        "8.x.1 must wrap rel.assert_cmds in cy.withinAccordion(...) so the "
        "checkField calls don't collide with same-named labels on the outer form."
    )

    # The assert loop must live inside the wrapper, immediately after it.
    assert re.search(
        r"cy\.withinAccordion\('\{\{ rel\.section_label \}\}', \(\) => \{\s*"
        r"\{% for cmd in rel\.assert_cmds %\}",
        block,
    ), "rel.assert_cmds must be the body of the withinAccordion wrapper"


def test_8x1_does_not_use_bare_open_accordion_for_assertions():
    """Regression: the broken pattern (openAccordion then unscoped checkFields) must not return."""
    block = _block_8x1(_read(TEMPLATE))

    # The broken pattern was:
    #   cy.openAccordion('{{ rel.section_label }}');
    #   {% for cmd in rel.assert_cmds %}
    #   {{ cmd }}
    #   {% endfor %}
    bad = re.search(
        r"cy\.openAccordion\('\{\{ rel\.section_label \}\}'\);\s*"
        r"\{% for cmd in rel\.assert_cmds %\}",
        block,
    )
    assert bad is None, (
        "8.x.1 must not call cy.openAccordion(...) immediately followed by the "
        "rel.assert_cmds loop — that pattern caused the duplicate-label bug."
    )


def test_within_accordion_command_is_registered():
    """The shared command must exist alongside the template change."""
    src = _read(COMMANDS)
    assert "Cypress.Commands.add('withinAccordion'," in src, (
        "cy.withinAccordion(label, fn) must be registered in cypress/support/commands.ts"
    )
    # And declared on the Chainable interface so TypeScript callers compile.
    assert "withinAccordion(label: string, fn: () => void): Chainable<void>;" in src, (
        "The Chainable interface must declare withinAccordion so generated specs typecheck."
    )


def test_within_accordion_scopes_to_accordion_details():
    """The helper must run the callback inside the accordion's details, not on the whole page."""
    src = _read(COMMANDS)
    # Pin the scoping chain — relaxed enough to allow whitespace/formatting changes.
    assert ".parents('.MuiAccordion-root')" in src, (
        "withinAccordion must walk up to the surrounding .MuiAccordion-root before scoping."
    )
    assert ".find('.MuiAccordionDetails-root')" in src, (
        "withinAccordion must scope into .MuiAccordionDetails-root so it excludes the summary header."
    )
    assert ".within(fn)" in src, (
        "withinAccordion must invoke `fn` via cy.within so subsequent cy.get calls are scoped."
    )
