"""An `x-version-of` identity whose primary column is virtual (read from its current version).

The identity row carries no content. Its list shows the version's `name`, which the
virtual resolver reads through `current_version_id`. The generated populate helper
therefore has to create one version per identity row and make it current, and the
generated UI spec must not expect a name the identity form cannot set.
"""
import os

from jinja2 import Environment, FileSystemLoader

from generators_test import helper_context, spec_context, _identity_version_for_virtual_primary
from helpers.naming import to_camel_case, to_pascal_case

_ID = {'type': 'string', 'pattern': '^c[a-z0-9]{24,}$'}
_GENERATE = {'list': True, 'view': True, 'new': True, 'edit': True, 'delete': True, 'api': True, 'test': True}


def _env() -> Environment:
    template_dir = os.path.join(os.path.dirname(__file__), '..', 'templates')
    env = Environment(
        loader=FileSystemLoader(template_dir), trim_blocks=True, lstrip_blocks=True, keep_trailing_newline=True,
    )
    env.filters['pascal_case'] = to_pascal_case
    env.filters['camel_case'] = to_camel_case
    return env


def _schema(virtual_primary: bool = True) -> dict:
    identity = {
        'type': 'object',
        'required': ['id'],
        'x-generate': dict(_GENERATE),
        'x-display': {'table': [{'name' if virtual_primary else 'code': {'primary': True}}]},
        'properties': {
            'id': _ID,
            'current_version_id': {
                'type': ['string', 'null'],
                'x-relationship': {'type': 'many-to-one', 'target': 'widget_version', 'labelField': 'name'},
            },
        },
    }
    if not virtual_primary:
        identity['properties']['code'] = {'type': 'string'}
        identity['required'].append('code')
    version = {
        'type': 'object',
        'required': ['id', 'widget_id', 'name'],
        'x-generate': dict(_GENERATE),
        'x-version-of': {'identity': 'widget', 'number': 'version_no'},
        'properties': {
            'id': _ID,
            'widget_id': {
                'type': 'string',
                'x-relationship': {'type': 'many-to-one', 'target': 'widget', 'labelField': 'id'},
            },
            'name': {'type': 'string'},
            'note': {'type': 'string'},
            'version_no': {'type': ['integer', 'null']},
        },
    }
    return {'definitions': {
        '__widget': identity, 'widget': {}, 'widget_detail': {'allOf': [{'$ref': '#/definitions/widget'}]},
        '__widget_version': version, 'widget_version': {},
    }}


def _config() -> dict:
    return {**_GENERATE, 'fields': None}


def test_pairing_data_for_a_virtual_primary_identity():
    pairing = _identity_version_for_virtual_primary('widget', 'name', _schema())
    assert pairing['version'] == 'widget_version'
    assert pairing['identity_fk'] == 'widget_id'
    assert pairing['prim'] == 'name'
    assert pairing['extra_required_fields'] == []


def test_no_pairing_when_the_primary_column_is_the_identitys_own():
    assert _identity_version_for_virtual_primary('widget', 'code', _schema(virtual_primary=False)) is None
    assert _identity_version_for_virtual_primary('widget_version', 'name', _schema()) is None


def test_populate_helpers_create_a_current_version_per_row():
    schema = _schema()
    ctx = helper_context('widget', [], schema, 'widget', 'widget_detail', _config())
    out = _env().get_template('test_helper.ts.jinja2').render(**ctx)
    assert 'prisma.widget_version.create' in out
    assert 'widget_id: record.id,' in out
    assert 'name: `Widget ${i}`,' in out
    assert 'data: { current_version_id: versionRecord.id },' in out
    assert 'records.push(currentRecord);' in out


def test_helper_is_unchanged_for_an_identity_with_its_own_primary_column():
    schema = _schema(virtual_primary=False)
    ctx = helper_context('widget', [], schema, 'widget', 'widget_detail', _config())
    out = _env().get_template('test_helper.ts.jinja2').render(**ctx)
    assert 'widget_version.create' not in out
    assert 'records.push(record);' in out


def test_spec_does_not_expect_a_name_the_form_cannot_set():
    schema = _schema()
    ctx = spec_context('widget', [], schema, 'widget', 'widget_detail', _config())
    assert ctx['after_create_blank'] is True
    assert ctx['list_id_1'] == 'Widget 1'
    assert ctx['has_edit_primary'] is False
    assert ctx['check_field_skip'] is True
    out = _env().get_template('test_spec.cy.ts.jinja2').render(**ctx)
    assert "getDataGridTotalRowCount().should('eq', 1);" in out
    assert "exactRe('Test Widget')" not in out


def test_spec_omits_the_optional_fk_that_closes_the_cycle():
    schema = _schema()
    ctx = spec_context('widget', [], schema, 'widget', 'widget_detail', _config())
    out = _env().get_template('test_spec.cy.ts.jinja2').render(**ctx)
    assert 'deps.currentVersion' not in out
    assert "'Current Version'" not in out
