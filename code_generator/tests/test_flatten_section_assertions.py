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

Schema-independence
-------------------
Tests that exercise generator behaviour build their own inline fixture
schema via `_fixture_schema()`. They must not read the project's
`code_generator/json_schema.yaml` or any file under `lib/` / `cypress/`,
because those depend on whichever entities currently live in the repo and
on whether `demo:generate` has been run. The generator-source files
(`test_spec.cy.ts.jinja2`, `cypress/support/commands.ts`) are still read
directly — those are the artefacts under test.
"""
import re
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
TEMPLATE = REPO_ROOT / 'code_generator' / 'templates' / 'test_spec.cy.ts.jinja2'
COMMANDS = REPO_ROOT / 'cypress' / 'support' / 'commands.ts'


def _read(path: Path) -> str:
    return path.read_text(encoding='utf-8')


# ---------------------------------------------------------------------------
# Inline fixture schema — enough to exercise:
#   * `_compute_flatten_test_rels('checkup', ...)` with three flatten OTOs
#     (pre_check, checkup_judgment, lifestyle), one of which (lifestyle)
#     carries an external required FK to `patient`.
#   * `find_fk_derivation_path('checkup', …, 'patient', …)` — one-hop via
#     `checkup.patient_rel_id → patient_rel.patient_id`.
#   * `build_context` + `service_context` for `checkup_detail`, so the
#     resulting `flatten_nested_creates` / `flatten_nested_updates` strings
#     contain the expected `tx.lifestyle.create` / `tx.patient_rel.findUnique`
#     / `tx.lifestyle.upsert` snippets.
#
# The fixture is intentionally local: no read of json_schema.yaml or of any
# generated file under `lib/`. That keeps these tests robust to schema
# changes in the host project (proj_a / proj_b can each evolve independently).
# ---------------------------------------------------------------------------

def _entity(parent: str, definition_key: str | None = None) -> dict:
    """Minimal entity dict matching what `extract_entities` would emit."""
    return {
        'parent':          parent,
        'model':           parent,
        'definition_key':  definition_key or f'{parent}_detail',
        'children':        [],
        'generate_config': {
            'list':   True,
            'view':   True,
            'new':    True,
            'edit':   True,
            'delete': True,
            'api':    True,
            'test':   True,
            'fields': None,
        },
    }


def _fixture_schema() -> dict:
    """Minimal schema covering checkup + three flatten OTOs + the patient_rel→
    patient one-hop derivation chain.

    Mirrors the shape historically tested against the real proj_a schema, but
    contains only the entities and properties the assertions below actually
    touch. Add new top-level definitions here when adding tests that need
    extra surface — never reach into `code_generator/json_schema.yaml`.
    """
    return {
        'definitions': {
            'patient': {
                'type': 'object',
                'required': ['id', 'name'],
                'properties': {
                    'id':   {'type': 'string'},
                    'name': {'type': 'string'},
                },
                'x-display': {'table': [{'name': {'primary': True}}]},
            },
            'patient_detail': {'allOf': [{'$ref': '#/definitions/patient'}]},

            'patient_rel': {
                'type': 'object',
                'required': ['id', 'patient_no', 'patient_id'],
                'properties': {
                    'id':         {'type': 'string'},
                    'patient_no': {'type': 'string'},
                    'patient_id': {
                        'type': 'string',
                        'x-relationship': {
                            'type': 'many-to-one',
                            'target': 'patient',
                            'labelField': 'name',
                        },
                    },
                },
                'x-display': {'table': [{'patient_no': {'primary': True}}]},
            },
            'patient_rel_detail': {'allOf': [{'$ref': '#/definitions/patient_rel'}]},

            'checkup': {
                'type': 'object',
                'required': ['id', 'patient_rel_id', 'checkup_date'],
                'properties': {
                    'id':            {'type': 'string'},
                    'patient_rel_id': {
                        'type': 'string',
                        'x-relationship': {
                            'type': 'many-to-one',
                            'target': 'patient_rel',
                            'labelField': 'patient_rel.patient.name',
                        },
                    },
                    'checkup_date':  {'type': 'string', 'format': 'date'},
                },
                'x-display': {'table': [{'patient_rel': {'primary': True}}]},
            },
            'checkup_detail': {
                'allOf': [
                    {'$ref': '#/definitions/checkup'},
                    {
                        'type': 'object',
                        'properties': {
                            'patient_rel':      {'$ref': '#/definitions/patient_rel'},
                            'pre_check':        {'$ref': '#/definitions/pre_check',
                                                 'x-outputType': 'flatten'},
                            'checkup_judgment': {'$ref': '#/definitions/checkup_judgment',
                                                 'x-outputType': 'flatten'},
                            'lifestyle':        {'$ref': '#/definitions/lifestyle',
                                                 'x-outputType': 'flatten'},
                        },
                    },
                ],
            },

            # Flatten OTO #1 — required parent FK, no external required FK.
            'pre_check': {
                'type': 'object',
                'required': ['id', 'checkup_id', 'ams_score'],
                'properties': {
                    'id':         {'type': 'string'},
                    'checkup_id': {
                        'type': 'string',
                        'x-relationship': {
                            'type': 'one-to-one', 'target': 'checkup',
                            'labelField': 'checkup_date',
                        },
                    },
                    'ams_score':  {'type': 'integer', 'minimum': 0, 'maximum': 50},
                },
                'x-display': {'table': [{'checkup': {'primary': True}}]},
            },
            'pre_check_detail': {'allOf': [{'$ref': '#/definitions/pre_check'}]},

            # Flatten OTO #2 — enum + boolean fields, used to verify
            # `empty_assert_cmds` emits checkField('', '') and setCheckbox(false).
            'checkup_judgment': {
                'type': 'object',
                'required': ['id', 'checkup_id', 'total_testosterone', 'is_followup'],
                'properties': {
                    'id':         {'type': 'string'},
                    'checkup_id': {
                        'type': 'string',
                        'x-relationship': {
                            'type': 'one-to-one', 'target': 'checkup',
                            'labelField': 'checkup_date',
                        },
                    },
                    'total_testosterone': {
                        'type': 'integer', 'minimum': 0, 'maximum': 2,
                        'enum': ['Low', 'Normal', 'High'],
                    },
                    'is_followup': {'type': 'boolean'},
                },
                'x-display': {'table': [{'checkup': {'primary': True}}]},
            },
            'checkup_judgment_detail': {
                'allOf': [{'$ref': '#/definitions/checkup_judgment'}],
            },

            # Flatten OTO #3 — required external FK to `patient` that the form
            # does not collect. The service generator must derive patient_id via
            # the parent's `patient_rel_id → patient_rel.patient_id` chain.
            'lifestyle': {
                'type': 'object',
                'required': ['id', 'checkup_id', 'patient_id', 'sleep_hours'],
                'properties': {
                    'id':         {'type': 'string'},
                    'checkup_id': {
                        'type': ['string', 'null'],
                        'x-relationship': {
                            'type': 'one-to-one', 'target': 'checkup',
                            'labelField': 'checkup_date',
                        },
                    },
                    'patient_id': {
                        'type': 'string',
                        'x-relationship': {
                            'type': 'many-to-one', 'target': 'patient',
                            'labelField': 'name',
                        },
                    },
                    'sleep_hours': {'type': 'integer', 'minimum': 0, 'maximum': 24},
                },
                'x-display': {'table': [{'patient': {'primary': True}}]},
            },
            'lifestyle_detail': {
                'allOf': [
                    {'$ref': '#/definitions/lifestyle'},
                    {
                        'type': 'object',
                        'properties': {
                            'checkup': {'$ref': '#/definitions/checkup'},
                            'patient': {'$ref': '#/definitions/patient'},
                        },
                    },
                ],
            },
        },
    }


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
    """Every flatten rel of `checkup` must carry `empty_assert_cmds`.

    Uses the inline fixture so the assertion does not depend on the host
    project's `json_schema.yaml` carrying checkup/lifestyle/pre_check today.
    """
    from generators_test import _compute_flatten_test_rels  # noqa: WPS433

    rels = _compute_flatten_test_rels('checkup', 'Checkup', 'checkup_detail', _fixture_schema())
    assert rels, "fixture checkup must have flatten rels (pre_check / checkup_judgment / lifestyle)"
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
    suite should generate inline-create tests for lifestyle too.

    Uses the inline fixture so the assertion stays valid regardless of what
    the host project's `json_schema.yaml` currently defines.
    """
    from generators_test import _compute_flatten_test_rels  # noqa: WPS433

    rels = _compute_flatten_test_rels('checkup', 'Checkup', 'checkup_detail', _fixture_schema())
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
    """checkup → patient_rel → patient is a one-hop derivation path.

    Uses the inline fixture; the host project's schema is not consulted.
    """
    from helpers.schema_helpers import find_fk_derivation_path  # noqa: WPS433

    schema = _fixture_schema()
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
    """The service generator must inline-create lifestyle inside addCheckup
    with patient_id derived via a `patient_rel.findUnique`, and must upsert
    lifestyle inside updateCheckup so a freshly-added section is persisted.

    Instead of reading `lib/checkup/service.ts` (which only exists after
    `npm run demo:generate` and depends on the host project's schema), we
    drive `build_context` + `service_context` against the inline fixture
    and inspect the rendered snippets the template would inline. The two
    keys `flatten_nested_creates` (addCheckup) and `flatten_nested_updates`
    (updateCheckup) hold exactly the lines that get pasted into the service.
    """
    from build_context import build_context  # noqa: WPS433
    from generators import service_context   # noqa: WPS433

    schema = _fixture_schema()
    ctx = build_context(_entity('checkup'), schema)
    svc = service_context(ctx, schema)

    creates = svc['flatten_nested_creates']
    updates = svc['flatten_nested_updates']

    # addCheckup branch — must inline-create lifestyle with the derived FK,
    # which means a `tx.patient_rel.findUnique` precedes the create.
    assert 'tx.lifestyle.create' in creates, (
        "addCheckup must inline-create lifestyle so 8.x.1 "
        "(create checkup with Lifestyle section filled) works."
    )
    assert 'tx.patient_rel.findUnique' in creates, (
        "Service must derive lifestyle.patient_id from patient_rel — the form "
        "does not collect patient_id for the inline lifestyle."
    )

    # updateCheckup branch — must upsert lifestyle (not updateMany-only), so a
    # freshly-added flatten section gets created on save (9.x.1).
    assert 'tx.lifestyle.upsert' in updates, (
        "updateCheckup must upsert lifestyle so a freshly-added section "
        "(9.x.1: add Lifestyle to checkup without one) gets persisted."
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
