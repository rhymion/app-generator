"""
An entity with no primary column and no `name` column renders only the display
labels of its parents in the list. The generated spec must assert the first
required FK's label, not the `'{Title} 1'` / `'Test {Title}'` placeholder that
never appears on screen. That label repeats across rows, so it is not unique.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from generators_test import spec_context  # noqa: E402

CFG = {
    'list': True, 'view': True, 'new': True, 'edit': True,
    'delete': True, 'api': True, 'test': True, 'fields': None,
}


def _fk(target: str, label_field='name') -> dict:
    return {'type': 'string', 'x-relationship': {'type': 'many-to-one', 'target': target, 'labelField': label_field}}


def _schema(label_field='name', parent_required=('id', 'name', 'code')) -> dict:
    return {'definitions': {
        'parent_thing': {
            'type': 'object', 'required': list(parent_required),
            'properties': {
                'id': {'type': 'string'}, 'name': {'type': 'string'}, 'code': {'type': 'string'},
            },
        },
        'link_row': {
            'type': 'object', 'required': ['id', 'parent_thing_id'],
            'properties': {'id': {'type': 'string'}, 'parent_thing_id': _fk('parent_thing', label_field)},
        },
    }}


def _spec(schema: dict) -> dict:
    return spec_context('link_row', [], schema, 'link_row', 'link_row', CFG)


def test_no_primary_no_name_asserts_the_fk_label():
    ctx = _spec(_schema())
    assert ctx['list_id_1'] == 'Test Parent Thing A'
    assert ctx['after_create_id'] == 'Test Parent Thing A'
    assert ctx['list_id_is_unique'] is False


def test_list_form_label_field_is_concatenated():
    ctx = _spec(_schema(['name', 'code']))
    assert ctx['list_id_1'] == 'Test Parent Thing A Test Code A'
    assert ctx['list_id_is_unique'] is False
