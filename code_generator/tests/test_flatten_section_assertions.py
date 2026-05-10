"""
Regression tests for the generated flatten-section blocks (8.x.1 / 9.x.1 /
9.x.2 / 9.x.3 / 10.x.1 / 10.x.2).

Background
----------
The flatten section renders fields whose labels can collide with fields on the
outer parent form. For example, `checkup.total_testosterone` is a NumberField
on the parent and `checkup_judgment.total_testosterone` is an enum Autocomplete
inside the Checkup Judgment accordion. Both render a `<label>` with text
"Total Testosterone".

Operations on inside-accordion fields (fill, clear, assert) MUST be scoped via
`cy.withinAccordion(<section>, () => { ... })`. Cypress' `cy.within` restricts
subsequent `cy.get` calls to descendants of the subject — so checkField /
selectAutocomplete / clearField inside the wrapper resolve only against labels
that live in that accordion's body. Operations on outside-accordion fields
(`Patient Rel`, `Checkup Date`, …) stay before the wrapper.

Edit-flatten tests (9.x.x) also navigate back to the edit page after Save and
assert that the inside-accordion field values were persisted correctly:
  9.x.1 / 9.x.2: fields hold the create_value (`assert_cmds`).
  9.x.3:        fields render empty after removal (`empty_assert_cmds`).
"""
import re
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
TEMPLATE = REPO_ROOT / 'code_generator' / 'templates' / 'test_spec.cy.ts.jinja2'
COMMANDS = REPO_ROOT / 'cypress' / 'support' / 'commands.ts'


def _read(path: Path) -> str:
    return path.read_text(encoding='utf-8')


def _block(template_src: str, it_marker: str) -> str:
    """Return the source of an `it('<it_marker> ...')` block, up to its closing `});`."""
    pattern = (
        r"it\('"
        + re.escape(it_marker)
        + r".*?\n      \}\);"
    )
    match = re.search(pattern, template_src, re.DOTALL)
    assert match is not None, f"Could not locate the {it_marker} it(...) block in the template"
    return match.group(0)


def _within_accordion_open(label_expr: str = "'{{ rel.section_label }}'") -> str:
    return f"cy.withinAccordion({label_expr}, () => {{"


# ---------------------------------------------------------------------------
# 8.x.1 — create-with-flatten-section
# ---------------------------------------------------------------------------

def test_8x1_fill_block_uses_within_accordion():
    """8.x.1 fill_cmds must be wrapped — even when individual labels happen to
    be unique today, the rule is to scope every inside-accordion operation."""
    block = _block(_read(TEMPLATE), "8.{{ loop.index }}.1 create")
    assert re.search(
        r"cy\.withinAccordion\('\{\{ rel\.section_label \}\}', \(\) => \{\s*"
        r"\{% for cmd in rel\.fill_cmds %\}",
        block,
    ), "8.x.1 fill_cmds must be wrapped in cy.withinAccordion(...)"


def test_8x1_assert_block_uses_within_accordion():
    """The 8.x.1 view-after-create assertions must be scoped to the accordion body."""
    block = _block(_read(TEMPLATE), "8.{{ loop.index }}.1 create")
    assert re.search(
        r"cy\.withinAccordion\('\{\{ rel\.section_label \}\}', \(\) => \{\s*"
        r"\{% for cmd in rel\.assert_cmds %\}",
        block,
    ), "rel.assert_cmds must be wrapped in cy.withinAccordion(...)"


def test_8x1_no_bare_open_accordion_around_inside_fields():
    """Regression: openAccordion + bare loop must not appear anywhere in 8.x.1."""
    block = _block(_read(TEMPLATE), "8.{{ loop.index }}.1 create")
    bad_assert = re.search(
        r"cy\.openAccordion\('\{\{ rel\.section_label \}\}'\);\s*"
        r"\{% for cmd in rel\.(assert_cmds|fill_cmds) %\}",
        block,
    )
    assert bad_assert is None, (
        "8.x.1 must not call cy.openAccordion(...) immediately followed by an "
        "unscoped fill_cmds or assert_cmds loop — that's the duplicate-label bug."
    )


# ---------------------------------------------------------------------------
# 9.x.x — edit-flatten-section (must wrap fill/clear AND verify after save)
# ---------------------------------------------------------------------------

def test_9x1_fill_wrapped_and_post_save_assertion_present():
    """9.x.1 (add): fill inside withinAccordion, then re-visit edit and assert."""
    block = _block(_read(TEMPLATE), "9.{{ loop.index }}.1 edit")
    # Fill is scoped.
    assert re.search(
        r"cy\.withinAccordion\('\{\{ rel\.section_label \}\}', \(\) => \{\s*"
        r"\{% for cmd in rel\.fill_cmds %\}",
        block,
    ), "9.x.1 fill_cmds must be wrapped in cy.withinAccordion(...)"
    # Post-save: re-visit edit then run assert_cmds inside withinAccordion.
    assert "cy.visit(`/en/{{ parent }}/edit/${records[0].id}`);" in block, (
        "9.x.1 must navigate back to the edit page after Save to verify persistence."
    )
    assert re.search(
        r"cy\.withinAccordion\('\{\{ rel\.section_label \}\}', \(\) => \{\s*"
        r"\{% for cmd in rel\.assert_cmds %\}",
        block,
    ), "9.x.1 must assert rel.assert_cmds inside cy.withinAccordion(...)"


def test_9x2_fill_wrapped_and_post_save_assertion_present():
    block = _block(_read(TEMPLATE), "9.{{ loop.index }}.2 edit")
    assert re.search(
        r"cy\.withinAccordion\('\{\{ rel\.section_label \}\}', \(\) => \{\s*"
        r"\{% for cmd in rel\.fill_cmds %\}",
        block,
    ), "9.x.2 fill_cmds must be wrapped in cy.withinAccordion(...)"
    assert "cy.visit(`/en/{{ parent }}/edit/${records[0].id}`);" in block, (
        "9.x.2 must navigate back to the edit page after Save to verify persistence."
    )
    assert re.search(
        r"cy\.withinAccordion\('\{\{ rel\.section_label \}\}', \(\) => \{\s*"
        r"\{% for cmd in rel\.assert_cmds %\}",
        block,
    ), "9.x.2 must assert rel.assert_cmds inside cy.withinAccordion(...)"


def test_9x3_clear_wrapped_and_empty_assertion_present():
    """9.x.3 (remove): clear inside withinAccordion, then re-visit edit and assert empty."""
    block = _block(_read(TEMPLATE), "9.{{ loop.index }}.3 edit")
    assert re.search(
        r"cy\.withinAccordion\('\{\{ rel\.section_label \}\}', \(\) => \{\s*"
        r"\{% for cmd in rel\.clear_cmds %\}",
        block,
    ), "9.x.3 clear_cmds must be wrapped in cy.withinAccordion(...)"
    assert "cy.visit(`/en/{{ parent }}/edit/${records[0].id}`);" in block, (
        "9.x.3 must navigate back to the edit page after Save to verify removal."
    )
    assert re.search(
        r"cy\.withinAccordion\('\{\{ rel\.section_label \}\}', \(\) => \{\s*"
        r"\{% for cmd in rel\.empty_assert_cmds %\}",
        block,
    ), "9.x.3 must assert rel.empty_assert_cmds inside cy.withinAccordion(...)"


def test_9xx_no_bare_open_accordion():
    """No bare openAccordion + loop pattern anywhere under 'Edit flatten section'."""
    template_src = _read(TEMPLATE)
    edit_block_match = re.search(
        r"describe\('Edit flatten section'.*?\n    \}\);",
        template_src,
        re.DOTALL,
    )
    assert edit_block_match, "Couldn't locate the 'Edit flatten section' describe block"
    edit_block = edit_block_match.group(0)
    bad = re.search(
        r"cy\.openAccordion\('\{\{ rel\.section_label \}\}'\);\s*"
        r"\{% for cmd in rel\.(fill_cmds|clear_cmds|assert_cmds|empty_assert_cmds) %\}",
        edit_block,
    )
    assert bad is None, (
        "Edit-flatten 9.x.x tests must not pair openAccordion with an unscoped loop."
    )


# ---------------------------------------------------------------------------
# 10.x.x — fail-partial
# ---------------------------------------------------------------------------

def test_10xx_partial_fill_wrapped():
    """10.x.1 (fail create) and 10.x.2 (fail edit) must wrap partial_fill_cmds."""
    template_src = _read(TEMPLATE)
    fail_block_match = re.search(
        r"describe\('Fail: partial flatten section data'.*?\n    \}\);",
        template_src,
        re.DOTALL,
    )
    assert fail_block_match, "Couldn't locate the 'Fail: partial flatten section data' describe block"
    fail_block = fail_block_match.group(0)
    # Two wrappers expected (one per 10.x.1 with-deps branch + 10.x.2; the no-deps
    # 10.x.1 branch is also wrapped, so accept >= 2).
    wrap_count = len(re.findall(
        r"cy\.withinAccordion\('\{\{ rel\.section_label \}\}', \(\) => \{",
        fail_block,
    ))
    assert wrap_count >= 2, (
        "10.x.x must wrap partial_fill_cmds in cy.withinAccordion(...) — found "
        f"{wrap_count} wrapper(s)."
    )
    bad = re.search(
        r"cy\.openAccordion\('\{\{ rel\.section_label \}\}'\);\s*"
        r"\{% for cmd in rel\.partial_fill_cmds %\}",
        fail_block,
    )
    assert bad is None, "10.x.x must not pair openAccordion with the partial_fill_cmds loop."
    # The legacy no-deps `cy.contains(rel.section_label).click()` shortcut
    # should also be replaced by the proper wrapper.
    legacy = re.search(
        r"cy\.contains\('\{\{ rel\.section_label \}\}'\)\.click\(\);\s*"
        r"\{% for cmd in rel\.partial_fill_cmds %\}",
        fail_block,
    )
    assert legacy is None, "Legacy `cy.contains(rel.section_label).click()` pattern must not return."


# ---------------------------------------------------------------------------
# Generator surface — gen_empty_assert_command + flatten_test_rels exposure
# ---------------------------------------------------------------------------

def test_compute_flatten_test_rels_populates_empty_assert_cmds_for_checkup():
    """Real-schema check: every flatten rel of `checkup` must carry `empty_assert_cmds`."""
    import sys
    sys.path.insert(0, str(REPO_ROOT / 'code_generator'))
    import yaml
    from generators_test import _compute_flatten_test_rels  # noqa: WPS433

    schema_path = REPO_ROOT / 'code_generator' / 'json_schema.yaml'
    schema = yaml.safe_load(schema_path.read_text(encoding='utf-8'))
    rels = _compute_flatten_test_rels('checkup', 'Checkup', 'checkup_detail', schema)
    assert rels, "checkup is expected to have flatten rels (pre_check / checkup_judgment / lifestyle)"
    for r in rels:
        assert 'empty_assert_cmds' in r, f"rel {r.get('prop_name')} missing empty_assert_cmds"
        assert isinstance(r['empty_assert_cmds'], list), "empty_assert_cmds must be a list"
        # Every fill_cmds entry corresponds to one empty_assert_cmds entry.
        assert len(r['empty_assert_cmds']) == len(r['fill_cmds']), (
            f"empty_assert_cmds count must match fill_cmds for rel {r.get('prop_name')}"
        )
        # Each empty-assert must be either a checkField('Label', '') or a setCheckbox(false) line.
        for cmd in r['empty_assert_cmds']:
            assert (
                "cy.checkField(" in cmd and "'')" in cmd
            ) or "cy.setCheckbox(" in cmd and "false" in cmd, (
                f"empty-assert command shape unexpected: {cmd!r}"
            )


def test_9x3_title_drops_unlinked_or_deleted_word():
    """The 9.x.3 it() title must use a single phrase regardless of whether the
    target's parent FK is optional. Earlier versions emitted '(with → without,
    unlinked)' for lifestyle and '(with → without, deleted)' for pre_check —
    the user wants no test-side distinction."""
    block = _block(_read(TEMPLATE), "9.{{ loop.index }}.3 edit")
    assert "(with → without)" in block, (
        "9.x.3 title must use the unified '(with → without)' phrasing."
    )
    assert "unlinked" not in block, (
        "9.x.3 title must not branch on rel.is_optional_parent_fk (no 'unlinked')."
    )
    assert '"deleted"' not in block and "'deleted'" not in block, (
        "9.x.3 title must not branch on rel.is_optional_parent_fk (no 'deleted')."
    )


def test_compute_flatten_test_rels_marks_lifestyle_as_inline_creatable():
    """`_compute_flatten_test_rels` used to gate 8.x.1/9.x.1 on
    can_create_inline = not _has_external_req_fk, which excluded lifestyle
    (it has a required external `patient_id`). The service generator now
    derives `patient_id` from `checkup.patient_rel.patient_id`, so the test
    suite should generate inline-create tests for lifestyle too."""
    import sys
    sys.path.insert(0, str(REPO_ROOT / 'code_generator'))
    import yaml
    from generators_test import _compute_flatten_test_rels  # noqa: WPS433

    schema_path = REPO_ROOT / 'code_generator' / 'json_schema.yaml'
    schema = yaml.safe_load(schema_path.read_text(encoding='utf-8'))
    rels = _compute_flatten_test_rels('checkup', 'Checkup', 'checkup_detail', schema)
    by_prop = {r['prop_name']: r for r in rels}
    assert 'lifestyle' in by_prop, "lifestyle must be a flatten rel of checkup"
    assert by_prop['lifestyle']['can_create_inline'] is True, (
        "lifestyle must be inline-creatable now that the service derives patient_id"
    )
    # All flatten rels of checkup share the same can_create_inline = True contract.
    for prop, r in by_prop.items():
        assert r['can_create_inline'] is True, (
            f"flatten rel {prop} should be inline-creatable (no more update-only path)"
        )


# ---------------------------------------------------------------------------
# Service-side derivation for external required FKs
# ---------------------------------------------------------------------------

def test_find_fk_derivation_path_resolves_one_hop():
    """checkup → patient_rel → patient is a one-hop derivation path."""
    import sys
    sys.path.insert(0, str(REPO_ROOT / 'code_generator'))
    import yaml
    from helpers.schema_helpers import find_fk_derivation_path  # noqa: WPS433

    schema_path = REPO_ROOT / 'code_generator' / 'json_schema.yaml'
    schema = yaml.safe_load(schema_path.read_text(encoding='utf-8'))
    parent_def = schema['definitions']['checkup']
    path = find_fk_derivation_path('checkup', parent_def, 'patient', schema)
    assert path is not None, "checkup must reach patient via patient_rel"
    assert path['kind'] == 'one_hop'
    assert path['parent_fk'] == 'patient_rel_id'
    assert path['intermediate'] == 'patient_rel'
    assert path['intermediate_fk'] == 'patient_id'


def test_find_fk_derivation_path_returns_none_when_unreachable():
    """Schema with no path returns None — caller falls back to update-only."""
    import sys
    sys.path.insert(0, str(REPO_ROOT / 'code_generator'))
    from helpers.schema_helpers import find_fk_derivation_path  # noqa: WPS433
    schema = {
        'definitions': {
            'parent_only': {
                'type': 'object',
                'required': ['id'],
                'properties': {'id': {'type': 'string'}},
            },
            'unreachable_target': {
                'type': 'object',
                'required': ['id'],
                'properties': {'id': {'type': 'string'}},
            },
        },
    }
    parent_def = schema['definitions']['parent_only']
    assert find_fk_derivation_path('parent_only', parent_def, 'unreachable_target', schema) is None


def test_generated_service_creates_lifestyle_inline_with_derived_patient_id():
    """Real-codegen check: lib/checkup/service.ts must contain the inline
    lifestyle.create with patient_id derived from patient_rel.findUnique."""
    service_src = (REPO_ROOT / 'lib' / 'checkup' / 'service.ts').read_text(encoding='utf-8')
    # The addCheckup branch must inline-create lifestyle.
    assert 'tx.lifestyle.create' in service_src, (
        "addCheckup must inline-create lifestyle now that the test gen "
        "expects 8.3.1 ('create checkup with Lifestyle section filled') to work."
    )
    # And it must derive patient_id from patient_rel.
    assert 'tx.patient_rel.findUnique' in service_src, (
        "Service must derive lifestyle.patient_id from patient_rel "
        "(the form does not collect patient_id for the inline lifestyle)."
    )
    # The legacy update-only branch (`updateMany` without create-on-miss) must
    # not be present alone for lifestyle on the update path.
    assert 'tx.lifestyle.upsert' in service_src, (
        "updateCheckup must upsert lifestyle so a freshly-added section "
        "(9.3.1: add Lifestyle to checkup without one) gets persisted."
    )


def test_gen_empty_assert_command_emits_empty_check_for_text_and_enum():
    """gen_empty_assert_command must emit `cy.checkField(label, '')` for non-bool fields."""
    import sys
    sys.path.insert(0, str(REPO_ROOT / 'code_generator'))
    from generators_test import gen_empty_assert_command  # noqa: WPS433

    text = {'category': 'text', 'label': 'Comment'}
    enum = {'category': 'enum', 'label': 'Total Testosterone'}
    num = {'category': 'number', 'label': 'Sleep Hours'}
    dtm = {'category': 'datetime', 'label': 'Date'}
    boo = {'category': 'boolean', 'label': 'Active'}

    assert gen_empty_assert_command(text, '  ') == "  cy.checkField('Comment', '');"
    assert gen_empty_assert_command(enum, '  ') == "  cy.checkField('Total Testosterone', '');"
    assert gen_empty_assert_command(num, '  ') == "  cy.checkField('Sleep Hours', '');"
    assert gen_empty_assert_command(dtm, '  ') == "  cy.checkField('Date', '');"
    # Booleans use setCheckbox(false) as the empty-state assertion.
    assert "setCheckbox('Active', false)" in gen_empty_assert_command(boo, '  ')


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
