"""
For an entity with two foreign keys to the same model, the populate helper seeds
the primary FK's dependency row under the foreign-key stem
(`placed_step_id` -> `Test Placed Step 0_1`). The generated spec must expect that
same label, not the label built from the target model title (`Test Step 0_1`).
When the stem title equals the target title the output is unchanged.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from generators_test import helper_context, spec_context  # noqa: E402

CFG = {
    'list': True, 'view': True, 'new': True, 'edit': True,
    'delete': True, 'api': True, 'test': True, 'fields': None,
}


def _fk(target: str) -> dict:
    return {'type': 'string', 'x-relationship': {'type': 'many-to-one', 'target': target, 'labelField': 'name'}}


def _schema(primary: str) -> dict:
    other = 'placed_step' if primary == 'step' else 'step'
    return {'definitions': {
        'step': {
            'type': 'object', 'required': ['id', 'name'],
            'properties': {'id': {'type': 'string'}, 'name': {'type': 'string'}},
        },
        'step_placement': {
            'type': 'object', 'required': ['id', 'placed_step_id', 'step_id'],
            'properties': {
                'id': {'type': 'string'}, 'placed_step_id': _fk('step'),
                'step_id': _fk('step'), 'step_no': {'type': 'integer'},
            },
            'x-display': {'table': [{primary: {'primary': True}}, {'step_no': {}}, {other: {}}]},
        },
    }}


def _spec(primary: str) -> dict:
    return spec_context('step_placement', [], _schema(primary), 'step_placement', 'step_placement', CFG)


def test_aliased_primary_fk_expects_stem_title():
    ctx = _spec('placed_step')
    assert ctx['list_id_1'] == 'Test Placed Step 0_1'
    assert ctx['check_field_value_1'] == 'Test Placed Step 0_1'
    assert ctx['list_id_updated'] == 'Test Placed Step A'
    assert ctx['check_field_updated'] == 'Test Placed Step A'


def test_expected_label_matches_the_seeded_dependency_title():
    helper = helper_context('step_placement', [], _schema('placed_step'), 'step_placement', 'step_placement', CFG)
    primary_dep = next(d for d in helper['deps'] if d.get('needs_second'))
    assert primary_dep['title'] == 'Placed Step'
    assert _spec('placed_step')['list_id_1'] == f"Test {primary_dep['title']} 0_1"


def test_second_fk_to_the_same_target_as_primary_is_unchanged():
    # stem `step` == target title `Step`, so the label equals the target-title form
    ctx = _spec('step')
    assert ctx['list_id_1'] == 'Test Step 0_1'
    assert ctx['list_id_updated'] == 'Test Step A'
