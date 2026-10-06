"""
An entity with no primary column and no `name` column lists the first required
FK's label, but its list renders no link in a row or cell and its card title is
the row id. The generated specs open a record by its id (the grid row's
`data-id`, or the seeded record) instead of clicking a link that is not there.
Entities with a primary column, or with a `name` column, keep clicking the link.
"""
import sys
from pathlib import Path

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


def test_no_primary_entity_navigates_by_record_id():
    ctx, text = _render('none', 'test_spec.cy.ts.jinja2')
    assert ctx['list_nav_by_record_id'] is True
    assert CLICK_LINK not in text, text
    assert text.count(BY_ID) >= 5, text
    assert "cy.visit(`/en/step_placement/view/${id}`)" in text


def test_no_primary_entity_mobile_opens_the_card_by_record_id():
    _, text = _render('none', 'test_spec_mobile.cy.ts.jinja2')
    assert 'cy.visit(`/en/step_placement/view/${records[0].id}`)' in text, text


def test_entity_with_a_primary_column_is_unchanged():
    ctx, text = _render('primary', 'test_spec.cy.ts.jinja2')
    assert ctx['list_nav_by_record_id'] is False
    assert BY_ID not in text, text


def test_entity_with_a_name_column_is_unchanged():
    ctx, text = _render('name', 'test_spec.cy.ts.jinja2')
    assert ctx['list_nav_by_record_id'] is False
    assert BY_ID not in text, text
    _, mobile = _render('name', 'test_spec_mobile.cy.ts.jinja2')
    assert 'view/${records[0].id}' not in mobile, mobile


def test_no_primary_entity_asserts_a_field_the_form_renders():
    ctx, text = _render('none', 'test_spec.cy.ts.jinja2')
    assert ctx['has_edit_primary'] is False
    assert ctx['edit_primary_cmd'] is None
    assert "checkField('Name'" not in text and "clearAndFillField('Name'" not in text, text
    assert "'Step Placement 1'" not in text and 'Updated Step Placement' not in text, text
    assert "cy.checkField('Step', 'Test Step A');" in text, text


def test_entity_with_a_name_column_still_edits_the_name():
    ctx, text = _render('name', 'test_spec.cy.ts.jinja2')
    assert ctx['has_edit_primary'] is True
    assert "clearAndFillField('Name'" in text, text
