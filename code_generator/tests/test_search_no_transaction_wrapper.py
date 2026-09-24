"""
Regression test (P2028 hotfix): cross-entity search (`buildSearchQuery()`
in search_helpers.ts.jinja2) must run its count, facet, and main-select
queries as independent `prisma.$queryRaw` calls, NOT serialized inside a
single `prisma.$transaction(...)`.

Before this fix, all three queries ran inside `prisma.$transaction(async
(tx) => {...})` with a `SET LOCAL pg_trgm.similarity_threshold` call and no
explicit `timeout` option, so Prisma's 5000ms interactive-transaction
default applied. At real data scale (N=30,000) the full search UNION
(count + facet + main, serialized onto one connection) could exceed
5000ms end-to-end, producing `P2028` on the search endpoint — reproduced
3/3 times against a clean test database with no other load.

The fix relies on `pg_trgm.similarity_threshold`'s own PostgreSQL default
(0.3) already matching `_SEARCH_SIMILARITY_THRESHOLD` (generate.py), with
no per-schema override existing today — so no explicit SET is needed, and
the three queries can run independently (and in parallel via
`Promise.all`) instead of being forced onto one connection.

Run:
    cd code_generator && python3 -m pytest tests/test_search_no_transaction_wrapper.py -v
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
        'similarity_where_sql': "COALESCE(name, '') % ${q}",
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
        'similarity_threshold': 0.3,
    }
    return _env().get_template('search_helpers.ts.jinja2').render(**ctx)


def test_no_transaction_or_set_local_in_rendered_output():
    """Deviation injection: the pre-fix shape wrapped the count/facet/main
    queries in prisma.$transaction(...) with a SET LOCAL call. Confirm that
    shape is entirely gone, not just that Promise.all appears somewhere.

    Checks actual invocation syntax (`await prisma.$transaction(`,
    `$executeRawUnsafe('SET LOCAL`), not a bare substring match — the fixed
    template's own explanatory comment mentions these strings in prose when
    describing what the old design did and why it changed, which a bare
    substring check would false-positive on.
    """
    rendered = _render(['widget', 'gadget'])

    assert 'await prisma.$transaction(' not in rendered, (
        'buildSearchQuery still wraps its queries in prisma.$transaction — '
        'this is exactly the P2028-at-scale regression the hotfix removed '
        "(no explicit timeout was ever passed, so Prisma's 5000ms default "
        'interactive-transaction timeout applied).'
    )
    assert "$executeRawUnsafe('SET LOCAL" not in rendered, (
        'buildSearchQuery still issues SET LOCAL pg_trgm.similarity_threshold — '
        "this GUC already defaults to _SEARCH_SIMILARITY_THRESHOLD's value with "
        'no per-schema override existing, so no explicit SET is needed today.'
    )
    assert 'tx.$queryRaw' not in rendered and 'tx.$executeRawUnsafe' not in rendered, (
        'buildSearchQuery still calls a transaction-client (tx.*) method — '
        'count/facet/main should call prisma.$queryRaw directly.'
    )


def test_count_facet_main_run_independently_via_promise_all():
    rendered = _render(['widget', 'gadget'])

    assert 'const [countFacetResult, rows] = await Promise.all([' in rendered, rendered
    # Count and facet both use prisma.$queryRaw directly (not a tx client).
    assert 'prisma.$queryRaw<[{ count: bigint }]>' in rendered
    assert 'prisma.$queryRaw<Array<{ entity_type: string; count: bigint }>>' in rendered
    assert 'prisma.$queryRaw<SearchResult[]>' in rendered
    # shouldCount still gates count/facet; main select is unconditional.
    assert 'shouldCount\n      ? Promise.all([' in rendered


def test_zero_entity_case_returns_before_reaching_query_section():
    rendered = _render([])
    assert "return { results: [], total: 0, page, pageSize, facets: {} };" in rendered
    assert 'await prisma.$transaction(' not in rendered
