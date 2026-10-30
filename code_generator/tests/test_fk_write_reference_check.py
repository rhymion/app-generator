"""
Regression test: add/update service functions verify every client-writable
foreign key that points at an organization-scoped entity before writing it
(lib/_fk_reference.ts). REST, Server Action, bulk create and bulk update all
call these two functions, so one check in service.ts covers them.

Run:
    cd code_generator && python3 -m pytest tests/test_fk_write_reference_check.py -v
"""
from pathlib import Path

from jinja2 import Environment, FileSystemLoader

from build_context import build_context
from generators import service_context

_GEN = {'list': True, 'view': True, 'new': True, 'edit': True, 'delete': True, 'api': True, 'test': True}
_ID = {'type': 'string', 'pattern': '^c[a-z0-9]{24,}$'}


def _fk(target: str) -> dict:
    return {**_ID, 'x-relationship': {'type': 'many-to-one', 'target': target, 'labelField': 'name'}}


def _entity_defs(name: str, props: dict, required: list[str], extra: dict | None = None) -> dict:
    return {
        f'__{name}': {
            'type': 'object',
            'required': ['id', 'name', *required],
            'properties': {'id': _ID, 'name': {'type': 'string', 'minLength': 1}, **props},
        },
        name: {'x-generate': dict(_GEN), 'allOf': [{'$ref': f'#/definitions/__{name}'}], **(extra or {})},
    }


def _schema(readonly_gadget: bool = False) -> dict:
    defs: dict = {}
    defs.update(_entity_defs('organization', {}, []))
    defs.update(_entity_defs('unit', {}, []))  # no organization_id: system-global
    defs.update(_entity_defs('gadget', {'organization_id': _fk('organization')}, ['organization_id']))
    defs.update(_entity_defs(
        'widget',
        {'organization_id': _fk('organization'), 'gadget_id': _fk('gadget'), 'unit_id': _fk('unit')},
        ['organization_id', 'gadget_id', 'unit_id'],
        {'x-readonly-fields': ['gadget_id']} if readonly_gadget else None,
    ))
    return {'definitions': defs}


def _render(schema: dict, gen: dict | None = None) -> tuple[str, dict, str]:
    entity = {
        'parent': 'widget', 'model': 'widget', 'definition_key': 'widget', 'children': [],
        'generate_config': {**_GEN, **(gen or {}), 'fields': None},
    }
    ctx = build_context(entity, schema)
    svc_ctx = {**ctx, **service_context(ctx, schema)}
    env = Environment(
        loader=FileSystemLoader(Path(__file__).parent.parent / 'templates'),
        trim_blocks=True, lstrip_blocks=True,
    )
    return env.get_template('service.ts.jinja2').render(**svc_ctx), svc_ctx, svc_ctx.get('imports', '')


def _body(rendered: str, fn: str) -> str:
    start = rendered.index(f'export async function {fn}')
    end = rendered.find('export async function', start + 1)
    return rendered[start:] if end == -1 else rendered[start:end]


def test_every_client_chosen_target_is_checked_except_organization_and_user():
    _, ctx, _ = _render(_schema())
    # organization_id is not a reference the client chooses (own membership rule);
    # gadget_id and unit_id are, and a target without an organization column is
    # still checked for read permission.
    assert [c['prop'] for c in ctx['fk_write_checks']] == ['gadget_id', 'unit_id']
    assert [c['target'] for c in ctx['fk_write_checks']] == ['gadget', 'unit']
    assert [c['self_only'] for c in ctx['fk_write_checks']] == [False, False]


def test_user_pointing_foreign_keys_are_not_checked():
    schema = _schema()
    defs = schema['definitions']
    defs.update(_entity_defs('user', {}, []))
    defs['__widget']['properties']['owner_id'] = _fk('user')
    _, ctx, _ = _render(schema)
    assert 'owner_id' not in [c['prop'] for c in ctx['fk_write_checks']]
    assert 'organization_id' not in [c['prop'] for c in ctx['fk_write_checks']]


def test_a_self_only_target_is_marked_so_the_creator_rule_applies():
    schema = _schema()
    schema['definitions']['gadget']['x-self-only'] = True
    rendered, ctx, _ = _render(schema)
    assert [c['self_only'] for c in ctx['fk_write_checks']] == [True, False]
    add_body = _body(rendered, 'addWidget')
    assert "{ model: 'gadget', selfOnly: true, id:" in add_body
    assert "{ model: 'unit', id:" in add_body


def test_a_target_that_is_not_a_generated_entity_is_not_checked():
    schema = _schema()
    del schema['definitions']['unit']['x-generate']
    _, ctx, _ = _render(schema)
    assert [c['prop'] for c in ctx['fk_write_checks']] == ['gadget_id']


def test_add_and_update_check_the_reference_before_writing():
    rendered, _, _ = _render(_schema())
    add_body = _body(rendered, 'addWidget')
    update_body = _body(rendered, 'updateWidget')
    assert 'assertFkReferencesUsable(actorId' in add_body
    assert add_body.index('assertFkReferencesUsable') < add_body.index('prisma.$transaction')
    assert 'assertFkReferencesUsable(actorId' in update_body
    assert update_body.index('assertFkReferencesUsable') < update_body.index('prisma.$transaction')
    # update compares against the stored value so an unchanged reference is not re-checked
    assert 'previousId: _fkPrevious?.gadget_id' in update_body
    assert "model: 'unit'" in rendered


def test_readonly_fk_is_not_a_client_write_and_is_not_checked():
    rendered, ctx, _ = _render(_schema(readonly_gadget=True))
    assert [c['prop'] for c in ctx['fk_write_checks']] == ['unit_id']
    assert "model: 'gadget'" not in rendered


def _api_spec(primary_target_scoped: bool) -> tuple[dict, str]:
    from generate import _make_env
    from generators_test import api_spec_context

    schema = _schema()
    widget = schema['definitions']['__widget']
    widget['x-display'] = {'table': [{'gadget': {'primary': True}}]}
    if not primary_target_scoped:
        widget['x-display'] = {'table': [{'unit': {'primary': True}}]}
    cfg = {**_GEN, 'fields': None}
    ctx = api_spec_context('widget', [], schema, 'widget', 'widget', cfg)
    return ctx, _make_env().get_template('test_api_spec.cy.ts.jinja2').render(**ctx)


def test_generated_spec_points_the_primary_fk_at_a_foreign_org_row():
    ctx, out = _api_spec(primary_target_scoped=True)
    assert ctx['fk_write_probe'] == {'prop': 'gadget_id', 'dep_var': 'gadget', 'target': 'gadget'}
    for case in ('G3.8 POST', 'G3.9 bulk POST', 'G3.10 PUT', 'G3.11 bulk PUT'):
        assert case in out
    assert "entityName: 'gadget'" in out
    assert 'gadget_id: scenario.entityInOrgB.id' in out


def test_generated_spec_has_no_fk_write_cases_for_a_global_target():
    ctx, out = _api_spec(primary_target_scoped=False)
    assert ctx['fk_write_probe'] is None
    assert 'G3.8' not in out


def test_update_does_not_treat_an_empty_required_reference_as_clearing():
    rendered, ctx, _ = _render(_schema())
    # gadget_id and unit_id are both required on widget: an empty value on update
    # means "keep the stored value" (fk_preservation), so it is not a clearing.
    assert [c['required'] for c in ctx['fk_write_checks']] == [True, True]
    update_body = _body(rendered, 'updateWidget')
    assert "previousId: _fkPrevious?.gadget_id, required: true," in update_body
    assert 'required: true' not in _body(rendered, 'addWidget')


def test_an_optional_reference_is_not_marked_required():
    schema = _schema()
    schema['definitions']['__widget']['required'].remove('unit_id')
    _, ctx, _ = _render(schema)
    assert [c['required'] for c in ctx['fk_write_checks']] == [True, False]


def test_delete_helper_checks_the_stored_references_of_the_rows_being_deleted():
    rendered, _, _ = _render(_schema())
    helper = _body(rendered, 'assertDeleteReferencesReachableWidget')
    assert 'prisma.widget.findMany' in helper
    assert 'assertStoredFkReferencesReachable(actorId' in helper
    assert "model: 'gadget', id: _row.gadget_id" in helper
    assert "model: 'unit', id: _row.unit_id" in helper
    # defined before the delete it guards, and the delete itself stays unchanged
    assert rendered.index('assertDeleteReferencesReachableWidget') < rendered.index('export async function deleteWidget')


def test_delete_helper_marks_a_self_only_target():
    schema = _schema()
    schema['definitions']['gadget']['x-self-only'] = True
    rendered, _, _ = _render(schema)
    assert "model: 'gadget', selfOnly: true, id: _row.gadget_id" in _body(rendered, 'assertDeleteReferencesReachableWidget')


def test_no_delete_helper_without_delete_or_without_checked_references():
    schema = _schema()
    rendered, _, _ = _render(schema, {'delete': False})
    assert 'assertDeleteReferencesReachableWidget' not in rendered
    schema = _schema()
    for k in ('gadget_id', 'unit_id'):
        del schema['definitions']['__widget']['properties'][k]
        schema['definitions']['__widget']['required'].remove(k)
    rendered, ctx, _ = _render(schema)
    assert not ctx['fk_write_checks']
    assert 'assertDeleteReferencesReachableWidget' not in rendered


def test_the_service_imports_the_stored_reference_check_only_when_it_deletes():
    rendered, _, _ = _render(_schema())
    assert "import { assertStoredFkReferencesReachable } from '@/lib/_fk_reference';" in rendered
    no_delete, _, _ = _render(_schema(), {'delete': False})
    assert 'assertStoredFkReferencesReachable' not in no_delete


def _delete_entrances(schema: dict) -> dict[str, str]:
    from generate import _make_env
    from generators import actions_context

    entity = {
        'parent': 'widget', 'model': 'widget', 'definition_key': 'widget', 'children': [],
        'generate_config': {**_GEN, 'fields': None},
    }
    ctx = build_context(entity, schema)
    env = _make_env()
    full = {**ctx, **actions_context(ctx)}
    return {
        'detail': env.get_template('api_detail_route.ts.jinja2').render(**ctx),
        'bulk': env.get_template('api_bulk_route.ts.jinja2').render(**ctx),
        'action_imports': full['service_imports'],
    }


def test_every_user_facing_delete_entrance_runs_the_reference_check_before_deleting():
    out = _delete_entrances(_schema())
    detail = out['detail']
    assert 'assertDeleteReferencesReachableWidget(actorId, [id]);' in detail
    assert detail.index('assertDeleteReferencesReachableWidget(actorId') < detail.index('await deleteWidget(')
    bulk = out['bulk']
    assert 'assertDeleteReferencesReachableWidget(actorId, [id]);' in bulk
    assert bulk.index('assertDeleteReferencesReachableWidget(actorId') < bulk.index('await deleteWidget(')
    assert 'assertDeleteReferencesReachableWidget' in out['action_imports']


def test_delete_entrances_do_not_call_the_check_when_there_is_nothing_to_check():
    schema = _schema()
    for k in ('gadget_id', 'unit_id'):
        del schema['definitions']['__widget']['properties'][k]
        schema['definitions']['__widget']['required'].remove(k)
    out = _delete_entrances(schema)
    assert 'assertDeleteReferencesReachable' not in out['detail']
    assert 'assertDeleteReferencesReachable' not in out['bulk']
    assert 'assertDeleteReferencesReachable' not in out['action_imports']


def test_generated_spec_covers_leaving_an_unreachable_reference_and_deleting():
    _, out = _api_spec(primary_target_scoped=True)
    for case in ('G3.12 PUT', 'G3.13 bulk PUT', 'G3.14 DELETE', 'G3.15 bulk DELETE'):
        assert case in out
    # a status code is named, and the DB is read again afterwards
    assert 'expect(res.status).to.eq(403);' in out
    assert 'expect(after.body.gadget_id).to.eq(stored);' in out
