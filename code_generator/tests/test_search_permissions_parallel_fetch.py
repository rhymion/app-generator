"""
Regression test (cmd_1157, superseded by cmd_1171): cross-entity search
(`buildSearchQuery()` in search_helpers.ts.jinja2) must fetch permission
data for all N search entities with exactly one DB query, not N.

History:
- cmd_1157 batched N sequential `getModelPermissions()` calls into one
  `Promise.all([...])`, relying on React `cache()`'s concurrent-call dedup
  to collapse the underlying `getPermissionRowsForUser(userId)` fetch (each
  `getModelPermissions()` call shares that same-argument inner call) down to
  one query.
- cmd_1170 measured this empirically (both Route Handler and Server Action
  paths, dev/test and fresh-production-process conditions) and found the
  dedup does NOT happen: N=3 search entities issued 3 separate
  `permission.findMany` queries, identical to the pre-cmd_1157 baseline.
- cmd_1171 removes the dependency on that dedup entirely: `buildSearchQuery`
  now calls `getPermissionRowsForUser(userId)` explicitly, exactly once,
  before any per-entity work, then derives each entity's RichPermissions
  synchronously from the already-resolved row array via
  `deriveRichPermissionsFromRows()` (shared with `getModelPermissions` in
  lib/authz.ts) — no `Promise.all`, no per-entity `getModelPermissions()`
  call, and no dependence on `cache()` behavior at all.

Run:
    cd code_generator && python3 -m pytest tests/test_search_permissions_parallel_fetch.py -v
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


def _search_entity(name: str) -> dict:
    return {
        'entity_type': name,
        'model': name,
        'text_fields': ['name'],
        'snippet_field': 'name',
        'ts_vector_fields_sql': "COALESCE(name, '')",
        'similarity_fields_sql': "similarity(COALESCE(name, ''), ${q})",
        'similarity_where_sql': "similarity(COALESCE(name, ''), ${q}) > 0.3",
        'should_filter_by_org': False,
        'org_relationship_optional': False,
        'has_assignee_id': False,
        'is_self_only': False,
        'perms_ts_var': f'{name}Perms',
        'general_read_ts_var': f'{name}GeneralRead',
        'access_clauses_ts_var': f'{name}AccessClauses',
        'access_where_ts_var': f'{name}AccessWhere',
        'or_clauses_ts_var': f'{name}OrClauses',
        'bigm_where_sql': "COALESCE(name, '') ILIKE '%' || ${q} || '%'",
        'bigm_similarity_fields_sql': "CASE WHEN COALESCE(name, '') ILIKE '%' || ${q} || '%' THEN 1.0 ELSE 0.0 END::float8",
        'no_page_children': [],
        'parent_access_clauses_ts_var': f'{name}ParentAccessClauses',
        'parent_access_where_ts_var': f'{name}ParentAccessWhere',
        'parent_or_clauses_ts_var': f'{name}ParentOrClauses',
        'filter_values': None,
        'bigm_fields': ['name'],
    }


def _render(entity_names: list[str]) -> str:
    ctx = {
        'search_entities': [_search_entity(n) for n in entity_names],
        'has_org_filtered_search_entity': False,
    }
    return _env().get_template('search_helpers.ts.jinja2').render(**ctx)


def test_permission_rows_fetched_exactly_once_regardless_of_entity_count():
    rendered = _render(['widget', 'gadget', 'sprocket'])

    assert rendered.count('await getPermissionRowsForUser(userId);') == 1, (
        'getPermissionRowsForUser(userId) must be awaited exactly once no '
        'matter how many search entities exist — this is what guarantees '
        'exactly 1 permission query, not N.\n' + rendered
    )
    assert 'const searchPermissionRows = await getPermissionRowsForUser(userId);' in rendered


def test_no_per_entity_getmodelpermissions_call():
    """The pre-cmd_1171 shape (cmd_1157's fix) called getModelPermissions()
    once per entity, batched via Promise.all. Confirm that call is gone
    entirely — the new shape derives permissions synchronously from the
    single fetched row array instead."""
    rendered = _render(['widget', 'gadget', 'sprocket'])

    assert "getModelPermissions('" not in rendered, (
        'A per-entity getModelPermissions() call is still being rendered — '
        'the single-query consolidation fix was not actually applied.\n' + rendered
    )
    assert (
        "import { getPermissionRowsForUser, deriveRichPermissionsFromRows } from '@/lib/authz';"
        in rendered
    ), 'getModelPermissions must no longer be imported by the search template.\n' + rendered
    assert 'Promise.all([\n    getPermissionRowsForUser' not in rendered


def test_each_entity_derives_permissions_from_the_shared_row_array():
    rendered = _render(['widget', 'gadget', 'sprocket'])

    for name in ('widget', 'gadget', 'sprocket'):
        assert (
            f"const {name}Perms = {{ permissions: await deriveRichPermissionsFromRows("
            f"searchPermissionRows.filter((row) => row.name === '{name}')) }};"
            in rendered
        ), rendered
        assert f'const {name}GeneralRead = {name}Perms.permissions.general.read === true;' in rendered


def test_single_entity_still_uses_the_shared_fetch():
    """N=1 search app must use the same shape as N>1 — no special-casing
    that reverts to a per-entity call for the trivial case."""
    rendered = _render(['widget'])

    assert rendered.count('await getPermissionRowsForUser(userId);') == 1
    assert (
        "const widgetPerms = { permissions: await deriveRichPermissionsFromRows("
        "searchPermissionRows.filter((row) => row.name === 'widget')) };"
        in rendered
    )


def test_imports_deriverichpermissionsfromrows_and_getpermissionrowsforuser():
    rendered = _render(['widget'])

    assert (
        "import { getPermissionRowsForUser, deriveRichPermissionsFromRows } from '@/lib/authz';"
        in rendered
    ), rendered
