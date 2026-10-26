"""
Regression test: a foreign key carried by a nested child row that points at an
organization-scoped entity is verified by the parent's add/update service
functions before the row is written (lib/_fk_reference.ts), exactly like the
parent's own foreign keys. REST, Server Action, bulk create and bulk update all
reach the nested write through these two functions.

Run:
    cd code_generator && python3 -m pytest tests/test_fk_write_nested_child_check.py -v
"""
from pathlib import Path

from jinja2 import Environment, FileSystemLoader

from build_context import build_context
from generators import service_context

_GEN = {'list': True, 'view': True, 'new': True, 'edit': True, 'delete': True, 'api': True, 'test': True}
_ID = {'type': 'string', 'pattern': '^c[a-z0-9]{24,}$'}
_NULLABLE_ID = {'type': ['string', 'null'], 'pattern': '^c[a-z0-9]{24,}$'}


def _fk(target: str, base: dict = _ID) -> dict:
    return {**base, 'x-relationship': {'type': 'many-to-one', 'target': target, 'labelField': 'name'}}


def _schema(target_scoped: bool = True) -> dict:
    target_props = {'id': _ID, 'name': {'type': 'string', 'minLength': 1}}
    if target_scoped:
        target_props['organization_id'] = _fk('organization')
    return {'definitions': {
        '__organization': {'type': 'object', 'required': ['id', 'name'], 'properties': {'id': _ID, 'name': {'type': 'string'}}},
        'organization': {'x-generate': dict(_GEN), 'allOf': [{'$ref': '#/definitions/__organization'}]},
        '__gadget': {'type': 'object', 'required': ['id', 'name'], 'properties': target_props},
        'gadget': {'x-generate': dict(_GEN), 'allOf': [{'$ref': '#/definitions/__gadget'}]},
        '__widget': {
            'type': 'object', 'required': ['id', 'name', 'organization_id'],
            'properties': {
                'id': _ID, 'name': {'type': 'string', 'minLength': 1},
                'organization_id': _fk('organization'),
                'parts': {'type': 'array', 'items': {'$ref': '#/definitions/part'}},
            },
        },
        'widget': {'x-generate': dict(_GEN), 'allOf': [{'$ref': '#/definitions/__widget'}]},
        'part': {
            'type': 'object', 'required': ['id', 'name', 'widget_id'],
            'x-generate': {**_GEN, 'new': False, 'edit': False, 'delete': False, 'api': False, 'test': False},
            'properties': {
                'id': _ID, 'name': {'type': 'string', 'minLength': 1},
                'widget_id': _fk('widget'),
                'gadget_id': _fk('gadget', _NULLABLE_ID),
            },
        },
    }}


def _render(schema: dict) -> tuple[str, dict]:
    entity = {
        'parent': 'widget', 'model': 'widget', 'definition_key': 'widget',
        'children': [{'name': 'part', 'property_name': 'parts', 'output_type': None, 'file_type': None, 'relationship': None}],
        'generate_config': {**_GEN, 'fields': None},
    }
    ctx = build_context(entity, schema)
    svc_ctx = {**ctx, **service_context(ctx, schema)}
    env = Environment(
        loader=FileSystemLoader(Path(__file__).parent.parent / 'templates'),
        trim_blocks=True, lstrip_blocks=True,
    )
    return env.get_template('service.ts.jinja2').render(**svc_ctx), svc_ctx


def _body(rendered: str, fn: str) -> str:
    start = rendered.index(f'export async function {fn}')
    end = rendered.find('export async function', start + 1)
    return rendered[start:] if end == -1 else rendered[start:end]


def test_child_fk_to_org_scoped_target_is_checked_on_add_before_the_write():
    rendered, _ = _render(_schema())
    add_body = _body(rendered, 'addWidget')
    assert "model: 'gadget', id: f.gadget_id" in add_body
    assert add_body.index("model: 'gadget'") < add_body.index('prisma.$transaction')


def test_child_fk_is_checked_on_update_against_the_stored_value():
    rendered, _ = _render(_schema())
    update_body = _body(rendered, 'updateWidget')
    assert "model: 'gadget', id: f.gadget_id" in update_body
    assert 'previousId: f.id ? _partsFkPrev.get(f.id)?.gadget_id : undefined' in update_body
    assert update_body.index("model: 'gadget'") < update_body.index('prisma.$transaction')


def test_child_fk_to_a_system_global_target_is_not_checked():
    rendered, _ = _render(_schema(target_scoped=False))
    assert "model: 'gadget'" not in rendered
    assert 'assertFkReferencesUsable' not in rendered
