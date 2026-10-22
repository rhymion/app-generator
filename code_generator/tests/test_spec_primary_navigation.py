"""
Specs open a record through the link in the list row or card, using the primary
column the entity declares. An entity that declares no primary column cannot get
a UI spec: the generator refuses rather than guessing which text the list shows.
"""
import sys
from pathlib import Path

import pytest
from jinja2 import Environment, FileSystemLoader

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from generators_test import spec_context  # noqa: E402
from helpers.naming import to_camel_case, to_pascal_case  # noqa: E402

CFG = {
    'list': True, 'view': True, 'new': True, 'edit': True,
    'delete': True, 'api': True, 'test': True, 'fields': None,
}
CLICK_LINK = ".find('a').first().click()"
BY_ID = "invoke('attr', 'data-id')"


def _fk(target: str) -> dict:
    return {'type': 'string', 'x-relationship': {'type': 'many-to-one', 'target': target, 'labelField': 'name'}}


def _schema(kind: str) -> dict:
    props = {'id': {'type': 'string'}, 'step_id': _fk('step'), 'step_no': {'type': 'integer'}}
    required = ['id', 'step_id']
    entity = {'type': 'object', 'required': required, 'properties': props}
    if kind == 'primary':
        entity['x-display'] = {'table': [{'step': {'primary': True}}, {'step_no': {}}]}
    elif kind == 'name':
        props['name'] = {'type': 'string'}
        required.append('name')
        entity['x-display'] = {'table': [{'name': {'primary': True}}]}
    elif kind == 'name_undeclared':
        props['name'] = {'type': 'string'}
        required.append('name')
    return {'definitions': {
        'step': {
            'type': 'object', 'required': ['id', 'name'],
            'properties': {'id': {'type': 'string'}, 'name': {'type': 'string'}},
        },
        'step_placement': entity,
    }}


def _env() -> Environment:
    env = Environment(
        loader=FileSystemLoader(str(Path(__file__).resolve().parents[1] / 'templates')),
        trim_blocks=True, lstrip_blocks=True, keep_trailing_newline=True,
    )
    env.filters['pascal_case'] = to_pascal_case
    env.filters['camel_case'] = to_camel_case
    return env


def _render(kind: str, template: str) -> tuple[dict, str]:
    ctx = spec_context('step_placement', [], _schema(kind), 'step_placement', 'step_placement', CFG)
    return ctx, _env().get_template(template).render(**ctx)




def test_entity_with_a_primary_column_is_unchanged():
    ctx, text = _render('primary', 'test_spec.cy.ts.jinja2')
    assert BY_ID not in text, text


def test_entity_with_a_name_column_is_unchanged():
    ctx, text = _render('name', 'test_spec.cy.ts.jinja2')
    assert BY_ID not in text, text
    _, mobile = _render('name', 'test_spec_mobile.cy.ts.jinja2')
    assert 'view/${records[0].id}' not in mobile, mobile



def test_entity_with_a_name_column_still_edits_the_name():
    ctx, text = _render('name', 'test_spec.cy.ts.jinja2')
    assert ctx['has_edit_primary'] is True
    assert "clearAndFillField('Name'" in text, text


def test_entity_without_a_declared_primary_is_refused():
    with pytest.raises(ValueError, match="without a primary column"):
        _render('none', 'test_spec.cy.ts.jinja2')


def test_a_name_column_does_not_stand_in_for_a_declared_primary():
    with pytest.raises(ValueError, match="without a primary column"):
        _render('name_undeclared', 'test_spec.cy.ts.jinja2')


NO_LIST_CFG = {**CFG, 'list': False}


def test_entity_without_a_list_view_needs_no_primary_and_gets_no_list_steps():
    """list: false is a structural exclusion: no primary needed, no list step generated."""
    ctx = spec_context('step_placement', [], _schema('none'), 'step_placement', 'step_placement', NO_LIST_CFG)
    text = _env().get_template('test_spec.cy.ts.jinja2').render(**ctx)
    assert ctx['can_list'] is False
    assert 'MuiDataGrid' not in text, text
    assert "cy.visit('/en/step_placement')" not in text, text
    assert "'Step Placement 1'" not in text and 'Updated Step Placement' not in text, text
    assert "it('2.1 creates with minimal data" in text, text
