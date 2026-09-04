"""
Regression test for #486 (cmd_945)/#486-regression fix (cmd_946d): an
org-scoped entity whose `organization_id` FK is declared in
x-readonly-fields must not render service.ts.jinja2's
`if (organizationId) { ... }` org-membership guard.

Root cause: #486 excluded readonly fields from client_prop_infos (and
therefore from parent_params_with_types, the add{Parent}/update{Parent}
service function's own parameter list) so a plain readonly field is never
read from client input at all. should_filter_by_org's guard block was never
updated to match — it still unconditionally references an `organizationId`
identifier, assuming it is always in scope as a function parameter. For an
org-scoped entity with organization_id declared readonly (e.g. a Proxy View
like the real-world asn_status, which edits only `status` on an existing
`asn` row), that identifier no longer exists — the generated service.ts
fails to compile with TS2304: Cannot find name 'organizationId'.

The fix (build_context.py's org_id_client_writable) only emits the guard
when organization_id is still one of the function's real parameters (i.e.
not excluded as readonly). This is not a loss of enforcement: the guard
only ever validated a CLIENT-SUPPLIED organization_id value about to be
written — when the field is readonly there is no such client-supplied
value, and the entity's actual org-scope enforcement for reads/writes on an
existing row lives in the org-filtered `findFirst` pre-fetch (cmd_452's
GAP-2 fix, present in every should_filter_by_org REST route / Server Action
update path regardless of this guard).

Run:
    cd code_generator && python3 -m pytest tests/test_org_readonly_field_write_guard.py -v
"""
from pathlib import Path

from jinja2 import Environment, FileSystemLoader

from build_context import build_context
from generators import service_context


def _schema(organization_id_readonly: bool) -> dict:
    defs: dict = {
        '__organization': {
            'type': 'object',
            'required': ['id', 'name'],
            'properties': {
                'id': {'type': 'string', 'pattern': '^c[a-z0-9]{24,}$'},
                'name': {'type': 'string', 'minLength': 1},
            },
        },
        'organization': {
            'x-generate': {
                'list': True, 'view': True, 'new': True, 'edit': True,
                'delete': True, 'api': True, 'test': True,
            },
            'allOf': [{'$ref': '#/definitions/__organization'}],
        },
        '__widget': {
            'type': 'object',
            'required': ['id', 'name', 'organization_id'],
            'properties': {
                'id': {'type': 'string', 'pattern': '^c[a-z0-9]{24,}$'},
                'name': {'type': 'string', 'minLength': 1},
                'organization_id': {
                    'type': 'string',
                    'pattern': '^c[a-z0-9]{24,}$',
                    'x-relationship': {
                        'type': 'many-to-one', 'target': 'organization', 'labelField': 'name',
                    },
                },
            },
        },
        'widget': {
            'x-generate': {
                'list': True, 'view': True, 'new': True, 'edit': True,
                'delete': True, 'api': True, 'test': True,
            },
            'allOf': [{'$ref': '#/definitions/__widget'}],
            **({'x-readonly-fields': ['organization_id']} if organization_id_readonly else {}),
        },
    }
    return {'definitions': defs}


def _entity(model: str) -> dict:
    return {
        'parent': model,
        'model': model,
        'definition_key': model,
        'children': [],
        'generate_config': {
            'list': True, 'view': True, 'new': True, 'edit': True,
            'delete': True, 'api': True, 'test': True, 'fields': None,
        },
    }


def _render_service(organization_id_readonly: bool) -> tuple[str, dict]:
    schema = _schema(organization_id_readonly)
    ctx = build_context(_entity('widget'), schema)
    svc_ctx = {**ctx, **service_context(ctx, schema)}
    env = Environment(
        loader=FileSystemLoader(Path(__file__).parent.parent / 'templates'),
        trim_blocks=True,
        lstrip_blocks=True,
    )
    return env.get_template('service.ts.jinja2').render(**svc_ctx), svc_ctx


def _function_body(rendered: str, fn_name: str) -> str:
    start = rendered.index(f'export async function {fn_name}')
    end = rendered.index('export async function', start + 1)
    return rendered[start:end]


def test_readonly_org_id_omits_write_guard_and_stays_compilable():
    """organization_id readonly: add/update must not reference the
    now-nonexistent `organizationId` parameter at all (the TS2304 repro)."""
    rendered, svc_ctx = _render_service(organization_id_readonly=True)

    assert svc_ctx['org_id_client_writable'] is False
    assert 'organizationId' not in rendered, (
        f'organization_id is readonly (excluded from parent_params_with_types) '
        f'yet the rendered service.ts still references organizationId — this '
        f'is the TS2304 regression. Got:\n{rendered}'
    )
    # The import backing the guard must be dropped too, or it becomes an
    # unused import (a separate compile/lint failure of its own).
    assert 'getAssociatedOrganizations' not in rendered

    add_body = _function_body(rendered, 'addWidget')
    update_body = _function_body(rendered, 'updateWidget')
    assert 'organizationId' not in add_body
    assert 'organizationId' not in update_body


def test_writable_org_id_keeps_existing_write_guard():
    """organization_id NOT readonly (the common case): unchanged from
    pre-fix behavior — guard still fires on both add and update."""
    rendered, svc_ctx = _render_service(organization_id_readonly=False)

    assert svc_ctx['org_id_client_writable'] is True

    add_body = _function_body(rendered, 'addWidget')
    update_body = _function_body(rendered, 'updateWidget')
    for body, org_ids_var in ((add_body, '_createOrgIds'), (update_body, '_updateOrgIds')):
        assert 'if (organizationId) {' in body
        assert f'{org_ids_var} = (await getAssociatedOrganizations(actorId)).map((o) => o.id);' in body
        assert f'{org_ids_var}.includes(organizationId)' in body
    assert "import { getAssociatedOrganizations } from '@/lib/organization/getters_associated';" in rendered


def test_readonly_org_id_deviation_injection():
    """Deviation injection: without the fix (gating on should_filter_by_org
    alone, not org_id_client_writable), the readonly case would still
    render the broken guard referencing an out-of-scope organizationId.
    Confirm that specific pre-fix shape is absent."""
    rendered, _ = _render_service(organization_id_readonly=True)

    pre_fix_broken_guard = (
        "  if (organizationId) {\n"
        "    const _updateOrgIds = (await getAssociatedOrganizations(actorId)).map((o) => o.id);\n"
        "    if (!_updateOrgIds.includes(organizationId)) {"
    )
    assert pre_fix_broken_guard not in rendered, (
        'Pre-fix broken guard (referencing organizationId despite it being '
        'excluded as a readonly-field parameter) is still being rendered.'
    )
