"""
Regression test: the generated 4.4/4.5 FK-read-permission graceful-degradation
tests (test_api_spec.cy.ts.jinja2) must not 404 on the organization-isolation
existence check before ever reaching the scenario under test.

Before this fix, db:createApiUserWithPermission (test_db_helpers.ts.jinja2)
built its actor with an RBAC permission row on the parent entity but zero
organization memberships. For a should_filter_by_org entity whose organization
relationship is required, api_detail_route.ts.jinja2's PUT/DELETE existence
check (`organization_id: { in: _assocOrgIds } }`, no NULL fallback) rejected
the request with 404 before the FK-preservation assertion the test exists for
was ever reached — an org-required entity could never actually pass 4.4/4.5.

The fix: 4.4/4.5 now pass the target row's own organization_id to
db:createApiUserWithPermission for should_filter_by_org entities, and the
fixture enrolls the new actor in that one organization (still granting no
read permission on the `organization` entity itself, so the RBAC-denial
scenario 4.4/4.5 exist to test is unchanged).

Run:
    cd code_generator && python3 -m pytest tests/test_org_membership_fk_preservation.py -v
"""
import json
from pathlib import Path

from jinja2 import Environment, FileSystemLoader

from generators_test import api_spec_context, db_helpers_context
from helpers.naming import to_pascal_case, to_camel_case


def _make_env() -> Environment:
    """Mirrors generate.py's _make_env() — the real filters must be
    registered or {{ x | pascal_case }} etc. raise TemplateRuntimeError."""
    env = Environment(
        loader=FileSystemLoader(Path(__file__).parent.parent / 'templates'),
        trim_blocks=True,
        lstrip_blocks=True,
        keep_trailing_newline=True,
    )
    env.filters['pascal_case'] = to_pascal_case
    env.filters['camel_case'] = to_camel_case
    env.filters['tojson'] = json.dumps
    return env


def _schema(with_organization: bool) -> dict:
    widget_required = ['id', 'name', 'category_id']
    widget_props = {
        'id': {'type': 'string', 'pattern': '^c[a-z0-9]{24,}$'},
        'name': {'type': 'string', 'minLength': 1},
        'category_id': {
            'type': 'string',
            'pattern': '^c[a-z0-9]{24,}$',
            'x-relationship': {'type': 'many-to-one', 'target': 'category', 'labelField': 'name'},
        },
    }
    if with_organization:
        widget_required.append('organization_id')
        widget_props['organization_id'] = {
            'type': 'string',
            'pattern': '^c[a-z0-9]{24,}$',
            'x-relationship': {'type': 'many-to-one', 'target': 'organization', 'labelField': 'name'},
        }

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
        '__category': {
            'type': 'object',
            'required': ['id', 'name'],
            'properties': {
                'id': {'type': 'string', 'pattern': '^c[a-z0-9]{24,}$'},
                'name': {'type': 'string', 'minLength': 1},
            },
        },
        'category': {
            'x-generate': {
                'list': True, 'view': True, 'new': True, 'edit': True,
                'delete': True, 'api': True, 'test': True,
            },
            'allOf': [{'$ref': '#/definitions/__category'}],
        },
        '__widget': {
            'type': 'object',
            'required': widget_required,
            'properties': widget_props,
            'x-display': {'table': [{'name': {'primary': True}}]},
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


def _entity_gen_cfg() -> dict:
    return {
        'list': True, 'view': True, 'new': True, 'edit': True,
        'delete': True, 'api': True, 'test': True, 'fields': None,
    }


def _render_api_spec(with_organization: bool) -> tuple[dict, str]:
    schema = _schema(with_organization)
    ctx = api_spec_context('widget', [], schema, 'widget', 'widget', _entity_gen_cfg())
    return ctx, _make_env().get_template('test_api_spec.cy.ts.jinja2').render(**ctx)


def _fk_preservation_block(rendered: str) -> str:
    start = rendered.index("describe('FK read-permission graceful degradation")
    end = rendered.index('\n  });', start) + len('\n  });')
    return rendered[start:end]


def test_should_filter_by_org_entity_gets_fk_preservation_relation_excluding_organization():
    """widget has two required many-to-one relations (organization, category).
    fk_preservation_relation must pick category, never organization (cmd_576),
    and should_filter_by_org must be True."""
    ctx, _ = _render_api_spec(with_organization=True)
    assert ctx['should_filter_by_org'] is True
    assert ctx['fk_preservation_relation'] is not None
    assert ctx['fk_preservation_relation']['target'] == 'category'


def test_4_4_and_4_5_pass_organization_id_for_should_filter_by_org_entity():
    """The fixture calls in both 4.4 and 4.5 must pass organizationId, sourced
    from the target row's own organization_id, when the entity is org-scoped —
    otherwise the actor is enrolled in zero organizations and the org-isolation
    existence check 404s before the FK-preservation scenario is reached."""
    _, rendered = _render_api_spec(with_organization=True)
    block = _fk_preservation_block(rendered)

    assert block.count("organizationId: original.organization_id,") == 2, (
        f'Expected both 4.4 and 4.5 to pass organizationId. Got:\n{block}'
    )
    assert "it('4.4 preserves category_id" in block
    assert "it('4.5 returns 200 for GET" in block


def test_fk_preservation_fixture_omits_organization_id_for_non_org_entity():
    """An entity with a required non-org FK but no organization relationship at
    all (should_filter_by_org False) must not pass organizationId — there is no
    row.organization_id to source it from, and no org-isolation check to clear."""
    _, rendered = _render_api_spec(with_organization=False)
    block = _fk_preservation_block(rendered)

    assert 'organizationId:' not in block, (
        f'organizationId should only be emitted for should_filter_by_org entities. Got:\n{block}'
    )
    assert "it('4.4 preserves category_id" in block


def test_db_helpers_create_api_user_accepts_organization_id():
    """cypress/support/db-helpers.ts: createApiUserWithPermission must accept an
    optional organizationId and connect the new actor to that organization —
    the fixture-side half of the fix."""
    ctx = db_helpers_context(_schema(with_organization=True), test_entity_names=['widget', 'organization', 'category'])
    rendered = _make_env().get_template('test_db_helpers.ts.jinja2').render(**ctx)

    start = rendered.index('export async function createApiUserWithPermission')
    end = rendered.index('\n}\n', start) + len('\n}\n')
    fn_body = rendered[start:end]

    assert 'organizationId?: string' in fn_body
    assert 'organizations: { connect: [{ id: organizationId }] }' in fn_body
