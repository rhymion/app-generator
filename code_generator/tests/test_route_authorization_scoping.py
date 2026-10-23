"""The bulk PUT/DELETE routes and the split action route must apply the same
organization scoping and permission checks as the single-record routes.

Before this was enforced, the bulk routes looked records up by id alone (an
ordinary member could update or delete another organization's rows) and the
split route only authenticated the caller (any signed-in user could split any
record). The Cypress G3.6/G3.7 cases cover the bulk routes end to end; these
tests pin the rendered shape so a template edit cannot silently drop the
checks, and keep the legitimate (unscoped / own-organization) shape intact.
"""
import pytest
import pathlib

from jinja2 import Environment, FileSystemLoader

from build_context import build_context

TEMPLATES_DIR = pathlib.Path(__file__).resolve().parents[1] / 'templates'


def _env() -> Environment:
    from helpers.naming import to_pascal_case, to_camel_case
    env = Environment(
        loader=FileSystemLoader(str(TEMPLATES_DIR)),
        trim_blocks=True, lstrip_blocks=True,
    )
    env.filters['pascal_case'] = to_pascal_case
    env.filters['camel_case'] = to_camel_case
    return env


def _org_schema(optional_org: bool) -> dict:
    org_prop = {
        "type": "string",
        "pattern": "^c[a-z0-9]{24,}$",
        "x-relationship": {"type": "many-to-one", "target": "organization"},
    }
    required = ["id", "name"] + ([] if optional_org else ["organization_id"])
    return {
        "definitions": {
            "organization": {
                "type": "object", "required": ["id", "name"],
                "properties": {"id": {"type": "string"}, "name": {"type": "string"}},
            },
            "thing": {
                "type": "object",
                "required": required,
                "properties": {
                    "id": {"type": "string", "pattern": "^c[a-z0-9]{24,}$"},
                    "name": {"type": "string"},
                    "organization_id": org_prop,
                },
            },
            "thing_detail": {
                "x-generate": {
                    "list": True, "view": True, "new": True, "edit": True,
                    "delete": True, "api": True, "test": False,
                },
                "allOf": [{"$ref": "#/definitions/thing"}],
            },
        },
    }


def _entity() -> dict:
    return {
        "parent": "thing", "model": "thing", "definition_key": "thing_detail",
        "children": [],
        "generate_config": {
            "list": True, "view": True, "new": True, "edit": True,
            "delete": True, "api": True, "test": False, "fields": None,
        },
    }


def _render_bulk(optional_org: bool = False) -> str:
    ctx = build_context(_entity(), _org_schema(optional_org))
    assert ctx['should_filter_by_org'] is True
    return _env().get_template('api_bulk_route.ts.jinja2').render(**ctx)


def _render_bulk_unscoped() -> str:
    ctx = build_context(_entity(), _org_schema(False))
    ctx['should_filter_by_org'] = False
    return _env().get_template('api_bulk_route.ts.jinja2').render(**ctx)


def test_bulk_put_and_delete_scope_the_lookup_to_the_actors_organizations():
    out = _render_bulk()
    assert "import { getAssociatedOrganizations } from '@/lib/organization/getters_associated';" in out
    scoped = "where: { id: { in: requestedIds }, organization_id: { in: _assocOrgIds } },"
    # One scoped lookup each for PUT and DELETE, and no unscoped one left.
    assert out.count(scoped) == 2
    assert out.count('const _assocOrgIds = (await getAssociatedOrganizations(actorId))') == 2
    assert 'where: { id: { in: requestedIds } },' not in out


def test_bulk_scoping_admits_org_less_rows_only_when_the_relation_is_optional():
    out = _render_bulk(optional_org=True)
    assert out.count(
        "where: { id: { in: requestedIds }, OR: [{ organization_id: { in: _assocOrgIds } }, { organization_id: null }] },"
    ) == 2


def test_bulk_route_without_an_organization_relation_keeps_the_plain_lookup():
    out = _render_bulk_unscoped()
    assert 'getAssociatedOrganizations' not in out
    assert out.count('where: { id: { in: requestedIds } },') == 2


def _split_ctx(**overrides) -> dict:
    ctx = {
        'entity_name': 'thing', 'pascal_name': 'Thing',
        'status_split_value': 'split', 'status_rejected_value': 'rejected',
        'has_approvable': False, 'approval_create_block': '',
        'has_quantity_check': False, 'quantity_field': None,
        'per_part_required': [], 'parent_field': None, 'split_result_field': None,
        'inherited_fields': [], 'has_inventory_bridge': False,
        'split_reserves_inventory': False, 'per_part_required_mandatory': [],
        'should_filter_by_org': True, 'org_relationship_optional': False,
        'is_self_only': False, 'split_permission_op': 'update',
    }
    ctx.update(overrides)
    return ctx


def _render_split(**overrides) -> str:
    return _env().get_template('split_action_route.ts.jinja2').render(**_split_ctx(**overrides))


def test_split_route_requires_update_permission_before_reading_the_record():
    out = _render_split()
    perm = out.index("await requireApiPermission(userId, 'thing', 'update')")
    read = out.index('prisma.thing.findFirst(')
    assert perm < read, 'the permission check must run before the record is read'
    assert 'requireCaller' in out and 'requireApiPermission' in out


def test_split_route_scopes_the_record_to_the_callers_organizations():
    out = _render_split()
    assert 'getAssociatedOrganizations(userId)' in out
    assert 'organization_id: { in: _assocOrgIds },' in out
    assert 'findUnique' not in out.split('const parent =')[1].split('if (!parent)')[0]
    assert "if (!parent) throw new ApiError(404, 'Not found');" in out


def test_split_route_resolves_record_level_permission_like_the_single_record_put():
    out = _render_split()
    assert 'resolvePermissions(_basePerms, parent as Record<string, unknown>, userId)' in out
    assert "throw new ApiError(403, 'Access denied: thing.update')" in out


def test_split_route_for_an_optional_organization_admits_org_less_rows_only():
    out = _render_split(org_relationship_optional=True)
    assert 'OR: [{ organization_id: { in: _assocOrgIds } }, { organization_id: null }],' in out


def test_split_route_without_an_organization_relation_still_checks_permission():
    out = _render_split(should_filter_by_org=False)
    assert 'getAssociatedOrganizations' not in out
    assert "await requireApiPermission(userId, 'thing', 'update')" in out
    assert 'resolvePermissions(' in out


def test_split_route_for_a_self_only_entity_gates_on_ownership():
    out = _render_split(is_self_only=True)
    assert 'parent.creator_id !== userId' in out
    assert 'resolvePermissions(' not in out


@pytest.mark.parametrize('op', ['update', 'create', 'read'])
def test_split_route_uses_the_permission_chosen_for_the_entity(op):
    out = _render_split(split_permission_op=op)
    assert f"await requireApiPermission(userId, 'thing', '{op}')" in out
    assert f"if (!_resolved.{op}) throw new ApiError(403, 'Access denied: thing.{op}')" in out
    for other in {'update', 'create', 'read'} - {op}:
        assert f"'thing', '{other}')" not in out
        assert f'_resolved.{other}' not in out
