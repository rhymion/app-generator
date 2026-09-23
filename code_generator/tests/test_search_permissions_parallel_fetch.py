"""
Regression test (cmd_1157): cross-entity search (`buildSearchQuery()` in
search_helpers.ts.jinja2) must fetch each entity's model permissions
concurrently, not one at a time.

Before this fix, the entity loop rendered a sequential
`const {{ perms }} = await getModelPermissions(...)` line per entity — with
N search entities, each search request paid N round trips to
`getModelPermissions()` back-to-back (its own `permission.findMany()` DB
query on a cache miss) before any SQL subquery was even built. proj_h wires
roughly 25 searchable entities, so a single search request could pay up to
25 sequential permission-fetch round trips.

The fix batches every entity's `getModelPermissions()` call into one
`Promise.all([...])` and destructures the results back into the same
per-entity variable names the rest of the template already relies on
(`{{ entity.perms_ts_var }}`) — no downstream template code changes.

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


def test_multi_entity_permission_fetch_is_batched_via_promise_all():
    rendered = _render(['widget', 'gadget', 'sprocket'])

    assert (
        '] = await Promise.all([\n'
        "    getModelPermissions('widget', userId),\n"
        "    getModelPermissions('gadget', userId),\n"
        "    getModelPermissions('sprocket', userId),\n"
        '  ]);'
        in rendered
    ), rendered
    assert (
        '  const [\n'
        '    widgetPerms,\n'
        '    gadgetPerms,\n'
        '    sprocketPerms,\n'
        '  ] = await Promise.all(['
        in rendered
    ), rendered

    # Each entity still gets its own general-read boolean, derived after the
    # batched fetch resolves, with no change to that downstream shape.
    assert 'const widgetGeneralRead = widgetPerms.permissions.general.read === true;' in rendered
    assert 'const gadgetGeneralRead = gadgetPerms.permissions.general.read === true;' in rendered
    assert 'const sprocketGeneralRead = sprocketPerms.permissions.general.read === true;' in rendered


def test_sequential_await_per_entity_shape_is_gone():
    """Deviation injection: the pre-fix shape awaited each entity's
    permissions one at a time, inline with its own `const {{ perms }} =`
    declaration. Confirm that shape is gone, not just that Promise.all
    appears somewhere in the file."""
    rendered = _render(['widget', 'gadget'])

    pre_fix_shape = "const widgetPerms = await getModelPermissions('widget', userId);"
    assert pre_fix_shape not in rendered, (
        'Pre-fix sequential per-entity await shape is still being rendered — '
        'the parallelization fix was not actually applied.'
    )


def test_single_entity_still_batches_through_promise_all():
    """A single-entity search app (N=1) should still route through
    Promise.all rather than reverting to a bare await for the N=1 case —
    keeps the generator's output shape uniform regardless of entity count."""
    rendered = _render(['widget'])

    assert (
        '  const [\n'
        '    widgetPerms,\n'
        '  ] = await Promise.all([\n'
        "    getModelPermissions('widget', userId),\n"
        '  ]);'
        in rendered
    ), rendered
