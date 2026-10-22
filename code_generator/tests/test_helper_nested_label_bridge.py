"""
The nested fresh-row create in populate<Entity>Data (a primary FK whose display
label is reached through another model) supplies the nested target's required
bridge relations the same way the shared dependency helper does: the bridge row
is created first and `<bridge>_id` is set on the nested row.
"""
import sys
from pathlib import Path

from jinja2 import Environment, FileSystemLoader

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from generators_test import helper_context  # noqa: E402
from helpers.naming import to_camel_case, to_pascal_case  # noqa: E402

CFG = {
    'list': True, 'view': True, 'new': True, 'edit': True,
    'delete': True, 'api': True, 'test': True, 'fields': None,
}


def _fk(target: str, label='name', kind='many-to-one') -> dict:
    return {'type': 'string', 'x-relationship': {'type': kind, 'target': target, 'labelField': label}}


def _schema(with_bridge: bool) -> dict:
    part_props = {'id': {'type': 'string'}, 'title': {'type': 'string'}}
    part_required = ['id', 'title']
    if with_bridge:
        part_props['attachable_id'] = _fk('attachable', kind='one-to-one_bridge')
        part_required.append('attachable_id')
    definitions = {
        'part': {'type': 'object', 'required': part_required, 'properties': part_props},
        'gadget': {
            'type': 'object', 'required': ['id', 'part_id'],
            'properties': {'id': {'type': 'string'}, 'part_id': _fk('part', 'title')},
        },
        'widget': {
            'type': 'object', 'required': ['id', 'gadget_id', 'note'],
            'properties': {
                'id': {'type': 'string'},
                'gadget_id': _fk('gadget', ['part.title']),
                'note': {'type': 'string'},
            },
            'x-display': {'table': [{'gadget': {'primary': True}}, {'note': {}}]},
        },
    }
    if with_bridge:
        definitions['attachable'] = {
            'type': 'object', 'required': ['id'], 'properties': {'id': {'type': 'string'}},
        }
    return {'definitions': definitions}


def _populate_data(with_bridge: bool) -> str:
    env = Environment(
        loader=FileSystemLoader(str(Path(__file__).resolve().parents[1] / 'templates')),
        trim_blocks=True, lstrip_blocks=True, keep_trailing_newline=True,
    )
    env.filters['pascal_case'] = to_pascal_case
    env.filters['camel_case'] = to_camel_case
    ctx = helper_context('widget', [], _schema(with_bridge), 'widget', 'widget', CFG)
    text = env.get_template('test_helper.ts.jinja2').render(**ctx)
    start = text.index('export async function populateWidgetData(')
    return text[start:text.index('\nexport ', start + 1)]


def test_nested_create_is_reached():
    body = _populate_data(True)
    assert 'const partFresh = await prisma.part.create(' in body, body


def test_nested_create_creates_the_bridge_row_first_and_links_it():
    body = _populate_data(True)
    bridge = body.index('prisma.attachable.create(')
    nested = body.index('prisma.part.create(')
    assert bridge < nested, body
    assert 'attachable_id: partFreshAttachable.id' in body, body


def test_nested_create_without_a_bridge_is_unchanged():
    body = _populate_data(False)
    assert 'const partFresh = await prisma.part.create(' in body, body
    assert 'attachable' not in body, body
