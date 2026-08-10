"""
Regression test (cmd_640): cross-entity search (`buildSearchQuery()` in
search_helpers.ts.jinja2) must surface a row whose `organization` relationship
is NULL to every caller, including one who belongs to no organization at all.

Before this fix, both org-filter sites in search_helpers.ts.jinja2 (the
per-entity access clause and its parent-qualified sibling used for
no_page_children) built `{{ org_id_field }} IN (${ ...associatedOrgIds })`
with no `IS NULL` branch. SQL's `IN (...)` never matches NULL, so once an
org-scoped entity's `organization` relationship became optional (see
build_context.py's `org_relationship_optional`, already wired into
actions.ts.jinja2/getters.ts.jinja2/api_detail_route.ts.jinja2/
api_import_route.ts.jinja2 by cmd_611/612/632/634), an org-less row was
permanently invisible to global search — even to its own creator. Confirmed
against a real Postgres DB via proj_c's api/parent1.cy.ts N10 spec: FAILED
before this fix (`expected false to equal true`), PASSED after.

The fix branches on `org_relationship_optional` (mirroring the sibling
templates) and adds an unconditional `OR {{ org_id_field }} IS NULL` — no
`associatedOrgIds.length > 0` admission guard, matching cmd_634's ruling that
gating null-row admission on the actor's own org-membership count wrongly
excludes that row's own (possibly org-less) creator. The
`associatedOrgIds.length > 0` branch that remains is purely a SQL-construction
necessity (Prisma.join over an empty array cannot form a valid `IN (...)`
list), not an access guard — both branches admit NULL rows.

Run:
    cd code_generator && python3 -m pytest tests/test_search_org_null_row.py -v
"""
from pathlib import Path

from jinja2 import Environment, FileSystemLoader


def _env() -> Environment:
    return Environment(
        loader=FileSystemLoader(Path(__file__).parent.parent / 'templates'),
        trim_blocks=True,
        lstrip_blocks=True,
        keep_trailing_newline=True,
    )


def _search_entity(*, org_relationship_optional: bool, no_page_children: list | None = None) -> dict:
    return {
        'entity_type': 'widget',
        'model': 'widget',
        'text_fields': ['name'],
        'snippet_field': 'name',
        'ts_vector_fields_sql': "COALESCE(name, '')",
        'similarity_fields_sql': "similarity(COALESCE(name, ''), ${q})",
        'similarity_where_sql': "similarity(COALESCE(name, ''), ${q}) > 0.3",
        'should_filter_by_org': True,
        'org_id_field': 'organization_id',
        'org_relationship_optional': org_relationship_optional,
        'has_assignee_id': False,
        'is_self_only': False,
        'perms_ts_var': 'widgetPerms',
        'general_read_ts_var': 'widgetGeneralRead',
        'access_clauses_ts_var': 'widgetAccessClauses',
        'access_where_ts_var': 'widgetAccessWhere',
        'or_clauses_ts_var': 'widgetOrClauses',
        'bigm_where_sql': "COALESCE(name, '') ILIKE '%' || ${q} || '%'",
        'bigm_similarity_fields_sql': "CASE WHEN COALESCE(name, '') ILIKE '%' || ${q} || '%' THEN 1.0 ELSE 0.0 END::float8",
        'no_page_children': no_page_children or [],
        'parent_access_clauses_ts_var': 'widgetParentAccessClauses',
        'parent_access_where_ts_var': 'widgetParentAccessWhere',
        'parent_or_clauses_ts_var': 'widgetParentOrClauses',
        'bigm_fields': ['name'],
    }


def _render(org_relationship_optional: bool, no_page_children: list | None = None) -> str:
    ctx = {'search_entities': [_search_entity(
        org_relationship_optional=org_relationship_optional,
        no_page_children=no_page_children,
    )]}
    return _env().get_template('search_helpers.ts.jinja2').render(**ctx)


def test_org_optional_search_admits_null_org_row():
    rendered = _render(org_relationship_optional=True)

    assert (
        'widgetAccessClauses.push(Prisma.sql`(organization_id IN (${ Prisma.join('
        in rendered
    ), rendered
    assert 'OR organization_id IS NULL)`);' in rendered
    assert 'widgetAccessClauses.push(Prisma.sql`organization_id IS NULL`);' in rendered


def test_org_required_search_unchanged():
    """Required-organization entity: byte-identical to the pre-fix shape —
    organization_id is never null there, so no OR-null branch should render."""
    rendered = _render(org_relationship_optional=False)

    assert (
        'widgetAccessClauses.push(Prisma.sql`organization_id IN (${ Prisma.join('
        in rendered
    )
    assert 'IS NULL' not in rendered
    assert 'widgetAccessClauses.push(Prisma.sql`1=0`);' in rendered


def test_org_optional_search_deviation_injection():
    """Deviation injection: without the fix, the pre-fix unconditional
    `1=0`-on-empty shape (no OR-null admission at all) is what renders —
    confirm that specific shape is no longer present, not just that some
    OR-null string exists somewhere in the file."""
    rendered = _render(org_relationship_optional=True)

    pre_fix_shape = (
        'if (associatedOrgIds.length > 0) {\n'
        '      widgetAccessClauses.push(Prisma.sql`organization_id IN (${ Prisma.join(associatedOrgIds.map((id) => Prisma.sql`${ id }`)) })`);\n'
        '    } else {\n'
        '      widgetAccessClauses.push(Prisma.sql`1=0`);\n'
        '    }\n'
    )
    assert pre_fix_shape not in rendered, (
        'Pre-fix shape (no OR-null admission for an org-optional entity) is '
        'still being rendered — the fix was not actually applied.'
    )


def test_org_optional_search_parent_qualified_admits_null_org_row():
    """no_page_children: the parent-qualified ACL sibling block gets the same
    OR-null treatment, `parent.`-prefixed."""
    rendered = _render(
        org_relationship_optional=True,
        no_page_children=[{'entity_type': 'widget_child', 'model': 'widget_child'}],
    )

    assert (
        'widgetParentAccessClauses.push(Prisma.sql`(parent.organization_id IN (${ Prisma.join('
        in rendered
    ), rendered
    assert 'OR parent.organization_id IS NULL)`);' in rendered
    assert 'widgetParentAccessClauses.push(Prisma.sql`parent.organization_id IS NULL`);' in rendered
