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
# ---------------------------------------------------------------------------

def test_lifestyle_detail_include_deepens_for_checkup_labelfield():
    """Pin: getLifestyleDetail's `include` for the `checkup` selector OTO must
    deepen to mirror the labelField path. Without this, FormView renders
    `src.checkup?.patient_rel?.patient?.name` as undefined and the Checkup
    field shows just the date."""
    src = (REPO_ROOT / 'lib' / 'lifestyle' / 'getters.ts').read_text(encoding='utf-8')
    # Find the getLifestyleDetail block.
    detail_start = src.index('async function getLifestyleDetail')
    detail_end   = src.index('export', detail_start + 1)
    detail_block = src[detail_start:detail_end]
    assert 'checkup: { include: { patient_rel: { include: { patient: true } } } }' in detail_block, (
        "getLifestyleDetail must deepen the `checkup` include to match the "
        "labelField path `patient_rel.patient.name`. See "
        "build_context.py → _detail_entry_for_rel."
    )


def test_get_available_checkups_for_lifestyle_includes_label_path():
    """Pin: getAvailableCheckupsForLifestyle must include the labelField path
    so the form's initial-options data (`initialAvailableCheckups`) carries
    every relation the autocomplete label expression dereferences. Without
    this, the lifestyle picker's options render with an empty patient name."""
    src = (REPO_ROOT / 'lib' / 'lifestyle' / 'getters.ts').read_text(encoding='utf-8')
    avail_start = src.index('async function getAvailableCheckupsForLifestyle')
    # Walk to the end of the function — next 'export' or end-of-file.
    avail_end_marker = src.find('\nexport', avail_start + 1)
    avail_block = src[avail_start: avail_end_marker if avail_end_marker != -1 else None]
    assert 'include: { patient_rel: { include: { patient: true } } }' in avail_block, (
        "getAvailableCheckupsForLifestyle must mirror the labelField path "
        "`patient_rel.patient.name` in its include. See "
        "build_context.py → selector_oto_rels.available_include."
    )
