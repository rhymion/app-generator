"""
Regression test: an org-scoped entity whose `organization` relationship is
declared OPTIONAL must still type-check and behave correctly on create.

Before this fix, service.ts.jinja2's add{{Parent}}() rendered an unconditional
`_createOrgIds.includes(organizationId)` check. That's fine when organizationId
is a required (non-nullable) param, but once a schema author removes
`organization` from an entity's `required` list, organizationId becomes
`string | null` and the unconditional `.includes(organizationId)` call is a
TypeScript compile error (Array.includes expects `string`, not
`string | null`) — a real `next build` failure, not just a lint nit.

The fix mirrors update{{Parent}}()'s existing `if (organizationId) { ... }`
guard (already present for the UPDATE path before this change) onto the
CREATE path, so an org-optional entity may be created without an
organization, while an org-required entity's behavior is unchanged (the
guard is always-true there, since TypeScript guarantees a non-null value).

Run:
    cd code_generator && python3 -m pytest tests/test_org_optional_create_guard.py -v
"""
from pathlib import Path

from jinja2 import Environment, FileSystemLoader

from build_context import build_context
from generators import service_context


def _schema(organization_required: bool) -> dict:
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
            'required': ['id', 'name'] + (['organization_id'] if organization_required else []),
            'properties': {
                'id': {'type': 'string', 'pattern': '^c[a-z0-9]{24,}$'},
                'name': {'type': 'string', 'minLength': 1},
                'organization_id': {
                    'type': ['string', 'null'] if not organization_required else 'string',
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


def _render_service(organization_required: bool) -> str:
    schema = _schema(organization_required)
    ctx = build_context(_entity('widget'), schema)
    svc_ctx = {**ctx, **service_context(ctx, schema)}
    env = Environment(
        loader=FileSystemLoader(Path(__file__).parent.parent / 'templates'),
        trim_blocks=True,
        lstrip_blocks=True,
    )
    return env.get_template('service.ts.jinja2').render(**svc_ctx)


def _add_function_body(rendered: str) -> str:
    start = rendered.index('export async function addWidget')
    end = rendered.index('export async function', start + 1)
    return rendered[start:end]


def test_org_optional_create_guards_membership_check():
    """Optional-organization entity: CREATE wraps the org-membership check in
    `if (organizationId)`, matching UPDATE's existing pattern — no client can
    ever be handed a raw `string | null` that fails Array.includes()'s type."""
    rendered = _render_service(organization_required=False)
    add_body = _add_function_body(rendered)

    assert 'if (organizationId) {' in add_body, (
        f'Expected an organizationId truthiness guard around the org-membership '
        f'check for an optional-org entity. Got:\n{add_body}'
    )
    assert '_createOrgIds.includes(organizationId)' in add_body


def test_org_required_create_still_checks_membership():
    """Required-organization entity: the guard is still present (harmless,
    since TypeScript guarantees organizationId is always a truthy string
    there) and the membership check still fires."""
    rendered = _render_service(organization_required=True)
    add_body = _add_function_body(rendered)

    assert 'if (organizationId) {' in add_body
    assert '_createOrgIds.includes(organizationId)' in add_body


def test_org_optional_create_guard_deviation_injection():
    """Deviation injection: without the fix, the guard line is absent and
    the unconditional check sits directly under `{% if should_filter_by_org %}`
    — confirm the *specific* pre-fix shape is no longer what's rendered, not
    just that some string is present."""
    rendered = _render_service(organization_required=False)
    add_body = _add_function_body(rendered)

    pre_fix_unconditional = (
        "  const _createOrgIds = (await getAssociatedOrganizations(actorId)).map((o) => o.id);\n"
        "  if (!_createOrgIds.includes(organizationId)) {"
    )
    assert pre_fix_unconditional not in add_body, (
        'Pre-fix unconditional org-membership check shape is still being '
        'rendered — the guard was not actually applied.'
    )
