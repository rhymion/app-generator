"""
Regression tests for `helpers/label_field.py` — labelField resolution and
TS expression building.
"""
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / 'code_generator'))

from helpers.label_field import (  # noqa: E402  WPS433
    build_label_expression,
    first_label_format,
    first_label_path,
    render_prisma_include,
    resolve_label_paths,
)


def _schema():
    """Minimal schema covering: simple field, dotted path, list of paths,
    and a date-formatted leaf."""
    return {
        'definitions': {
            'role': {
                'type': 'object',
                'properties': {
                    'id':   {'type': 'string'},
                    'name': {'type': 'string'},
                },
            },
            'patient': {
                'type': 'object',
                'properties': {
                    'id':   {'type': 'string'},
                    'name': {'type': 'string'},
                },
            },
            'patient_rel': {
                'type': 'object',
                'properties': {
                    'id':         {'type': 'string'},
                    'patient_no': {'type': 'string'},
                    'patient_id': {
                        'type': 'string',
                        'x-relationship': {'type': 'many-to-one', 'target': 'patient'},
                    },
                },
            },
            'checkup': {
                'type': 'object',
                'properties': {
                    'id':            {'type': 'string'},
                    'checkup_date':  {'type': 'string', 'format': 'date'},
                    'patient_rel_id': {
                        'type': 'string',
                        'x-relationship': {'type': 'many-to-one', 'target': 'patient_rel'},
                    },
                },
            },
        },
    }


# ---------------------------------------------------------------------------
# resolve_label_paths
# ---------------------------------------------------------------------------

def test_resolve_label_paths_single_field():
    paths = resolve_label_paths('name', 'patient', _schema())
    assert len(paths) == 1
    assert paths[0]['segments'] == ['name']
    assert paths[0]['final_format'] is None
    assert paths[0]['relation_chain'] == []


def test_resolve_label_paths_dotted_through_relations():
    paths = resolve_label_paths('patient_rel.patient.name', 'checkup', _schema())
    assert paths[0]['segments'] == ['patient_rel', 'patient', 'name']
    assert paths[0]['relation_chain'] == ['patient_rel', 'patient']


def test_resolve_label_paths_picks_up_date_format():
    paths = resolve_label_paths('checkup_date', 'checkup', _schema())
    assert paths[0]['final_format'] == 'date'


def test_resolve_label_paths_array_form():
    paths = resolve_label_paths(['patient_rel.patient.name', 'checkup_date'], 'checkup', _schema())
    assert len(paths) == 2
    assert paths[0]['final_format'] is None
    assert paths[1]['final_format'] == 'date'


def test_resolve_label_paths_rejects_unknown_segment():
    import pytest
    with pytest.raises(ValueError, match="not a property of"):
        resolve_label_paths('not_a_field', 'patient', _schema())


def test_resolve_label_paths_rejects_intermediate_non_relation():
    import pytest
    with pytest.raises(ValueError, match="not a m2o/one-to-one relation"):
        resolve_label_paths('name.deeper', 'patient', _schema())


# ---------------------------------------------------------------------------
# build_label_expression
# ---------------------------------------------------------------------------

def test_build_label_expression_single_simple_field():
    built = build_label_expression('item', 'name', 'patient', _schema())
    assert built['expression'] == "(item.name ?? '')"
    assert built['has_format'] is False
    assert built['prisma_include'] == {}


def test_build_label_expression_single_field_after_relation_root():
    """Item var that itself contains a `.` (e.g. `item.requestor_role`)
    must use `?.` for the next access — the relation can be null."""
    built = build_label_expression('item.requestor_role', 'name', 'role', _schema())
    assert built['expression'] == "(item.requestor_role?.name ?? '')"


def test_build_label_expression_dotted_path_walks_with_optional_chain():
    built = build_label_expression('item', 'patient_rel.patient.name', 'checkup', _schema())
    assert built['expression'] == "(item.patient_rel?.patient?.name ?? '')"
    # And the prisma include must mirror the chain.
    assert built['prisma_include'] == {
        'patient_rel': {'include': {'patient': True}},
    }


def test_build_label_expression_date_field_uses_format_label_value():
    built = build_label_expression('item', 'checkup_date', 'checkup', _schema())
    assert built['expression'] == "formatLabelValue(item.checkup_date, 'date')"
    assert built['has_format'] is True


def test_build_label_expression_array_concatenates_with_space():
    built = build_label_expression(
        'item',
        ['patient_rel.patient.name', 'checkup_date'],
        'checkup',
        _schema(),
    )
    # Template literal joining the two paths with a space.
    assert built['expression'] == (
        "`${(item.patient_rel?.patient?.name ?? '')} "
        "${formatLabelValue(item.checkup_date, 'date')}`"
    )
    assert built['has_format'] is True
    assert built['prisma_include'] == {
        'patient_rel': {'include': {'patient': True}},
    }


def test_build_label_expression_falls_back_to_name_when_empty():
    built = build_label_expression('item', None, 'patient', _schema())
    assert built['expression'] == "(item.name ?? '')"


# ---------------------------------------------------------------------------
# render_prisma_include
# ---------------------------------------------------------------------------

def test_render_prisma_include_flat():
    assert render_prisma_include({'patient_rel': True}) == 'patient_rel: true'


def test_render_prisma_include_nested():
    s = render_prisma_include({'patient_rel': {'include': {'patient': True}}})
    assert s == 'patient_rel: { include: { patient: true } }'


def test_render_prisma_include_two_siblings():
    s = render_prisma_include({
        'patient_rel': {'include': {'patient': True}},
        'pre_check':   True,
    })
    # Order is dict insertion order — we just check both pieces are present.
    assert 'patient_rel: { include: { patient: true } }' in s
    assert 'pre_check: true' in s


# ---------------------------------------------------------------------------
# Convenience helpers used by legacy callers
# ---------------------------------------------------------------------------

def test_first_label_format_picks_first_dated_path():
    """Returns the format of the first path whose final field is a date/time —
    used by legacy callers that only care 'is this label date-formatted?'."""
    fmt = first_label_format(['patient_rel.patient.name', 'checkup_date'], 'checkup', _schema())
    assert fmt == 'date', "any date-formatted path in the list is enough to flag the labelField as dated"
    fmt = first_label_format(['name'], 'patient', _schema())
    assert fmt is None
    fmt = first_label_format('checkup_date', 'checkup', _schema())
    assert fmt == 'date'


def test_first_label_path_returns_first():
    assert first_label_path(['a', 'b']) == 'a'
    assert first_label_path('only') == 'only'
    assert first_label_path([]) == ''
    assert first_label_path(None) == ''


# ---------------------------------------------------------------------------
# Detail-page include deepening (FormView label resolution)
#
# These tests verify that `build_context` deepens the Prisma `include` chain
# whenever a relation's labelField walks through more than one level of m2o /
# one-to-one — e.g. `lifestyle.checkup_id` with labelField
# `patient_rel.patient.name` means the lifestyle detail query must include
# `checkup → patient_rel → patient` so the label expression isn't dereferencing
# undefined fields at render time.
#
# Earlier versions of these tests read `lib/lifestyle/getters.ts` from disk,
# which (a) required `npm run demo:generate` to have produced the file and
# (b) made the assertion brittle to whatever entities live in the host
# project's `json_schema.yaml` today. We now inspect `build_context`'s
# output directly against an inline fixture schema.
# ---------------------------------------------------------------------------

def _pipeline_entity(parent: str, definition_key: str | None = None) -> dict:
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


def _pipeline_schema() -> dict:
    """Fixture exercising deepened-include behaviour through `build_context`.

    `lifestyle.checkup_id` is a selector one-to-one whose labelField walks
    `patient_rel.patient.name` on the target. Calling `build_context` on the
    `lifestyle` entity must therefore emit a `checkup` include that nests
    `patient_rel → patient` — both inside `include_props_detail` (used by
    `getLifestyleDetail`) and inside each selector OTO rel's `available_include`
    (used by `getAvailableCheckupsForLifestyle`).
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
                            'labelField': 'patient_no',
                        },
                    },
                    'checkup_date':  {'type': 'string', 'format': 'date'},
                },
                'x-display': {'table': [{'patient_rel': {'primary': True}}]},
            },
            'checkup_detail': {'allOf': [{'$ref': '#/definitions/checkup'}]},

            'lifestyle': {
                'type': 'object',
                'required': ['id', 'patient_id'],
                'properties': {
                    'id':         {'type': 'string'},
                    'patient_id': {
                        'type': 'string',
                        'x-relationship': {
                            'type': 'many-to-one',
                            'target': 'patient',
                            'labelField': 'name',
                        },
                    },
                    'checkup_id': {
                        'type': ['string', 'null'],
                        'x-relationship': {
                            'type': 'one-to-one',
                            'target': 'checkup',
                            # Two-hop labelField — the include must deepen.
                            'labelField': 'patient_rel.patient.name',
                        },
                    },
                },
                'x-display': {'table': [{'patient': {'primary': True}}]},
            },
            'lifestyle_detail': {
                'allOf': [
                    {'$ref': '#/definitions/lifestyle'},
                    {
                        'type': 'object',
                        'properties': {
                            'patient': {'$ref': '#/definitions/patient'},
                            'checkup': {'$ref': '#/definitions/checkup'},
                        },
                    },
                ],
            },
        },
    }


def test_lifestyle_detail_include_deepens_for_checkup_labelfield():
    """`include_props_detail` (used by getLifestyleDetail) must deepen the
    `checkup` selector-OTO include to mirror the labelField path
    `patient_rel.patient.name`. Without this, FormView renders
    `src.checkup?.patient_rel?.patient?.name` as undefined and the Checkup
    field shows just the date."""
    from build_context import build_context  # noqa: WPS433

    schema = _pipeline_schema()
    ctx = build_context(_pipeline_entity('lifestyle'), schema)
    include_detail = ctx['include_props_detail']
    assert (
        'checkup: { include: { patient_rel: { include: { patient: true } } } }'
        in include_detail
    ), (
        "build_context must deepen the `checkup` include to match the "
        "labelField path `patient_rel.patient.name`. See "
        "build_context.py → _detail_entry_for_rel.\n"
        f"include_props_detail was: {include_detail}"
    )


def test_get_available_checkups_for_lifestyle_includes_label_path():
    """Each selector OTO rel must carry an `available_include` string mirroring
    its labelField path. This is what `getAvailableCheckupsForLifestyle` inlines
    into its Prisma query so the `initialAvailableCheckups` prop seeds the
    autocomplete options with every relation the label expression dereferences."""
    from build_context import build_context  # noqa: WPS433

    schema = _pipeline_schema()
    ctx = build_context(_pipeline_entity('lifestyle'), schema)
    selector_rels = ctx['selector_oto_rels']
    checkup_rel = next(
        (r for r in selector_rels if r['target'] == 'checkup'),
        None,
    )
    assert checkup_rel is not None, (
        f"lifestyle should expose `checkup` as a selector OTO rel; got: "
        f"{[r['target'] for r in selector_rels]}"
    )
    assert (
        checkup_rel['available_include']
        == 'patient_rel: { include: { patient: true } }'
    ), (
        "Selector OTO `checkup` must mirror the labelField path "
        "`patient_rel.patient.name` in its available_include. See "
        "build_context.py → selector_oto_rels.available_include.\n"
        f"available_include was: {checkup_rel['available_include']!r}"
    )
