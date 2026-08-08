"""Jinja2 branch-coverage tests for api_import_route.ts.jinja2.

No real entity, DB, or Next.js build is required — these tests render the
template directly against synthetic context and assert on the emitted
TypeScript source.
"""
import pytest

_BASE_CTX = {
    'parent': 'test_entity',
    'model': 'test_entity',
    'parent_pascal': 'TestEntity',
    'should_filter_by_org': False,
    'import_can_create': True,
    'import_can_update': True,
    'import_key_specs': [
        {'csv_col': 'code', 'is_dotted': False, 'lookup_field': 'code',
         'result_col': 'code', 'fk_nullable': False, 'raw': 'code'},
    ],
    'import_key_fields': ['code'],
    'import_update_fields': ['label'],
    'import_field_specs': [
        {'name': 'code', 'ts_type': 'string', 'nullable': False,
         'is_key': True, 'is_update': False},
        {'name': 'label', 'ts_type': 'string', 'nullable': True,
         'is_key': False, 'is_update': True},
    ],
    # cmd_530: import_fk_specs generalizes dotted-FK resolution beyond
    # x-import-key (see test_import_fk_specs_branches.py for coverage of the
    # non-key FK / fail-loud behavior itself); empty here so pre-existing
    # tests in this file exercise only the plain key-column path.
    'import_fk_specs': [],
    'import_unimportable_columns': [],
    'item_context_select': '{ id: true, creator_id: true }',
}


def _ctx(**overrides):
    return {**_BASE_CTX, **overrides}


@pytest.fixture(scope='module')
def env():
    from generate import _make_env
    return _make_env()


def test_edit_false_generates_update_not_supported(env):
    """import_can_update=False → per-row loop emits ENTITY_IMPORT_UPDATE_NOT_SUPPORTED."""
    ctx = _ctx(import_can_create=True, import_can_update=False)
    rendered = env.get_template('api_import_route.ts.jinja2').render(**ctx)
    # UPDATE branch replaced by error push
    assert 'ENTITY_IMPORT_UPDATE_NOT_SUPPORTED' in rendered
    # CREATE branch IS present (import_can_create=True)
    assert 'Not permitted to create this entity' in rendered
    # Full handler IS generated (not the stub)
    assert 'MAX_IMPORT_ROWS' in rendered
    assert 'assertPermission(permissions,' in rendered
    # No live update data-write object in the per-row loop
    # (top-level imports/consts are unconditional across branches, so
    # `const updateData` — only emitted inside the import_can_update branch —
    # is the precise marker, not the `updater_id: actorId` string, which is
    # also written by the always-present CREATE action).
    assert 'const updateData' not in rendered


def test_both_false_generates_entity_import_not_supported_stub(env):
    """import_can_create=False and import_can_update=False → entity-level stub."""
    ctx = _ctx(import_can_create=False, import_can_update=False)
    rendered = env.get_template('api_import_route.ts.jinja2').render(**ctx)
    # Top-level stub is generated
    assert 'ENTITY_IMPORT_NOT_SUPPORTED' in rendered
    # Full handler is NOT generated — top-level imports/consts (Papa, MAX_IMPORT_ROWS)
    # are unconditional across branches, so check the full-handler-only signature,
    # call sites, and CSV parsing invocation instead.
    assert 'export async function POST(request: NextRequest)' not in rendered
    assert 'assertPermission(permissions,' not in rendered
    assert 'Papa.parse' not in rendered


def test_create_false_update_true(env):
    """import_can_create=False, import_can_update=True → CREATE branch is ENTITY_IMPORT_CREATE_NOT_SUPPORTED."""
    ctx = _ctx(import_can_create=False, import_can_update=True)
    rendered = env.get_template('api_import_route.ts.jinja2').render(**ctx)
    assert 'ENTITY_IMPORT_CREATE_NOT_SUPPORTED' in rendered
    assert 'ENTITY_IMPORT_UPDATE_NOT_SUPPORTED' not in rendered
    # Full handler IS generated
    assert 'MAX_IMPORT_ROWS' in rendered


def test_two_dotted_keys_same_lookup_entity_no_duplicate_const(env):
    """DP-2a (cmd_394 §12): two dotted x-import-key entries whose lookup_entity
    resolves to the SAME Prisma model (e.g. approval_flow's approver_role.name
    and requestor_role.name both target 'role') must render distinct const
    names — var_prefix (not lookup_entity) drives the generated identifier.
    A collision here would be a TypeScript 'Cannot redeclare block-scoped
    variable' build error, invisible to a naive Jinja2-only smoke test."""
    ctx = _ctx(import_key_specs=[
        {'csv_col': 'approver_role_name', 'is_dotted': True, 'lookup_field': 'name',
         'var_prefix': 'approver_role', 'lookup_entity': 'role',
         'result_col': 'approver_role_id', 'fk_nullable': False, 'raw': 'approver_role.name'},
        {'csv_col': 'requestor_role_name', 'is_dotted': True, 'lookup_field': 'name',
         'var_prefix': 'requestor_role', 'lookup_entity': 'role',
         'result_col': 'requestor_role_id', 'fk_nullable': False, 'raw': 'requestor_role.name'},
    ], import_key_fields=[])
    rendered = env.get_template('api_import_route.ts.jinja2').render(**ctx)

    # Both dotted lookups target the correct Prisma model.
    assert rendered.count('await prisma.role.findMany(') == 2
    assert 'prisma.approver_role.findMany(' not in rendered
    assert 'prisma.requestor_role.findMany(' not in rendered

    # Distinct, non-colliding const declarations (the actual bug this guards).
    assert 'const _approver_role_csv_val' in rendered
    assert 'const _requestor_role_csv_val' in rendered
    assert 'const _approver_role_rows' in rendered
    assert 'const _requestor_role_rows' in rendered
    assert 'const _role_csv_val' not in rendered
    assert 'const _role_rows' not in rendered

    declared_names = [
        line.split()[1] for line in rendered.splitlines()
        if line.strip().startswith('const _') and ('_csv_val' in line or '_rows' in line)
    ]
    assert len(declared_names) == len(set(declared_names)), (
        f"duplicate const declaration(s) in rendered import route: {declared_names}"
    )


# ---------------------------------------------------------------------------
# cmd_530: import_fk_specs generalizes dotted-FK resolution beyond
# x-import-key — a non-key screen-editable FK now resolves via lookup and is
# written to BOTH create and update data (筋2), and a key FK is now also
# written to updateData, not only merged into CREATE via keyWhere (筋1).
# ---------------------------------------------------------------------------

def test_non_key_fk_resolved_and_written_on_create_and_update(env):
    """筋2: a non-key FK (absent from x-import-key) must get a real write
    path once it's screen-editable — previously such a CSV column was
    silently accepted and discarded on both CREATE and UPDATE."""
    ctx = _ctx(import_fk_specs=[
        {'csv_col': 'requestor_role_name', 'is_dotted': True, 'lookup_field': 'name',
         'var_prefix': 'requestor_role', 'lookup_entity': 'role', 'lookup_entity_pascal': 'Role',
         'result_col': 'requestor_role_id', 'fk_nullable': True, 'raw': 'requestor_role.name',
         'is_key': False, 'lookup_entity_filter_by_org': False},
    ])
    rendered = env.get_template('api_import_route.ts.jinja2').render(**ctx)

    # Resolved exactly once, in the new non-key fkData block.
    assert rendered.count('await prisma.role.findMany(') == 1
    assert 'fkData.requestor_role_id = _requestor_role_id;' in rendered

    # Written into CREATE via the fkData spread...
    assert '...data, ...keyWhere, ...fkData, creator_id: actorId' in rendered
    # ...and into UPDATE.
    assert 'updateData.requestor_role_id = _requestor_role_id;' in rendered


def test_key_fk_now_also_written_on_update(env):
    """筋1: a *declared* dotted x-import-key FK was previously merged into
    CREATE data (via keyWhere) but never written on UPDATE at all — now both
    key and non-key FK specs are written to updateData."""
    key_spec = {
        'csv_col': 'approver_role_name', 'is_dotted': True, 'lookup_field': 'name',
        'var_prefix': 'approver_role', 'lookup_entity': 'role', 'lookup_entity_pascal': 'Role',
        'result_col': 'approver_role_id', 'fk_nullable': False, 'raw': 'approver_role.name',
        'lookup_entity_filter_by_org': False,
    }
    ctx = _ctx(
        import_key_specs=[key_spec],
        import_key_fields=[],
        import_fk_specs=[{**key_spec, 'is_key': True}],
    )
    rendered = env.get_template('api_import_route.ts.jinja2').render(**ctx)

    assert 'updateData.approver_role_id = _approver_role_id;' in rendered
    # A key spec's resolution code is emitted ONCE (by the keyWhere loop) —
    # the fkData loop must not re-resolve it (no duplicate findMany/const).
    assert rendered.count('await prisma.role.findMany(') == 1


def test_unimportable_column_present_in_header_rejected(env):
    """Fail-loud companion (required independent of root cause): an exported
    FK display column with no write path must reject the import with a
    distinct error code, not silently succeed while dropping the column."""
    ctx = _ctx(import_unimportable_columns=['legacy_owner_name'])
    rendered = env.get_template('api_import_route.ts.jinja2').render(**ctx)
    assert 'UNIMPORTABLE_COLUMN' in rendered
    assert 'const UNIMPORTABLE_COLUMNS: string[] = ["legacy_owner_name"];' in rendered


def test_no_unimportable_columns_renders_empty_array(env):
    """Non-regression: the common case (nothing unimportable) still renders
    a valid, empty TS array — not `Undefined`."""
    ctx = _ctx(import_unimportable_columns=[])
    rendered = env.get_template('api_import_route.ts.jinja2').render(**ctx)
    assert 'const UNIMPORTABLE_COLUMNS: string[] = [];' in rendered


# ---------------------------------------------------------------------------
# cmd_548 (subtask_547a design, option ko): composite/dotted labelField FKs
# are import-resolvable via a pre-built label->id map instead of a per-row
# scalar lookup. See TestCompositeLabelFieldImportOrgFilter /
# TestImportFkSpecsScreenEditableGeneralization in test_build_context.py for
# the Python-side spec-shape coverage; these tests cover the emitted
# TypeScript.
# ---------------------------------------------------------------------------

_COMPOSITE_SPEC = {
    'raw': 'inventory', 'is_dotted': False, 'is_composite': True,
    'csv_col': 'inventory_name', 'var_prefix': 'inventory',
    'lookup_entity': 'inventory', 'lookup_entity_pascal': 'Inventory',
    'result_col': 'inventory_id', 'fk_nullable': True,
    'lookup_entity_filter_by_org': True, 'is_key': False,
    'import_label_expr': "`${(c.product?.name ?? '')} ${(c.location?.name ?? '')}`",
    'prisma_include': {'product': True, 'location': True},
}


def test_composite_fk_map_built_once_outside_row_loop(env):
    """The label->id map must be built ONCE (per-import, not per-row) — the
    whole point of the pre-built-map design (cmd_548 judgment_2_cost) is a
    fixed per-column cost regardless of CSV row count."""
    ctx = _ctx(import_fk_specs=[_COMPOSITE_SPEC])
    rendered = env.get_template('api_import_route.ts.jinja2').render(**ctx)
    assert rendered.count('await prisma.inventory.findMany(') == 1
    map_pos = rendered.index('_inventory_label_map = new Map')
    loop_pos = rendered.index('for (let i = 0; i < rows.length; i++)')
    assert map_pos < loop_pos, 'map construction must precede the per-row loop'


def test_composite_fk_map_build_skipped_when_header_lacks_column(env):
    """cmd_548 requirement 六: an import whose CSV never touches this FK
    must not pay for the full-candidate-table read. Asserted at the
    template level (not just by runtime behavior) so this guarantee is
    machine-checked on every future template edit, not just observed once
    in a live server probe."""
    ctx = _ctx(import_fk_specs=[_COMPOSITE_SPEC])
    rendered = env.get_template('api_import_route.ts.jinja2').render(**ctx)
    guard = "if (headerFields.includes('inventory_name')) {"
    assert guard in rendered
    # The candidate findMany must be textually INSIDE that guard block, not
    # before it — assert via source position of the guard vs. the query.
    guard_pos = rendered.index(guard)
    query_pos = rendered.index('await prisma.inventory.findMany(')
    assert guard_pos < query_pos


def test_composite_fk_candidate_query_org_filtered(env):
    """lookup_entity_filter_by_org=True must carry into the candidate
    findMany's where clause (cmd_548 requirement い — org isolation)."""
    ctx = _ctx(import_fk_specs=[_COMPOSITE_SPEC])
    rendered = env.get_template('api_import_route.ts.jinja2').render(**ctx)
    assert 'where: { organization_id: { in: _importOrgIds } },' in rendered


def test_composite_fk_candidate_query_not_org_filtered_when_flag_false(env):
    """System-global lookup entities (e.g. role) must NOT be org-filtered —
    the composite map generalizes the same org-filter flag the simple
    dotted-FK lookup already respects."""
    ctx = _ctx(import_fk_specs=[{**_COMPOSITE_SPEC, 'lookup_entity_filter_by_org': False}])
    rendered = env.get_template('api_import_route.ts.jinja2').render(**ctx)
    assert 'organization_id: { in: _importOrgIds }' not in rendered


def test_composite_fk_uses_import_label_expr_not_export_label_expr(env):
    """cmd_548 requirement あ: the map is built from import_label_expr
    (candidate-rooted, e.g. `c.product?.name`), never from an
    export-side/row-rooted expression — they come from the same helper call
    with only the root variable differing (see build_context.py), so
    asserting the emitted expression text is present is a direct check that
    codegen wired the correct (candidate-rooted) variant through."""
    ctx = _ctx(import_fk_specs=[_COMPOSITE_SPEC])
    rendered = env.get_template('api_import_route.ts.jinja2').render(**ctx)
    assert "const _lbl = (`${(c.product?.name ?? '')} ${(c.location?.name ?? '')}`).trim();" in rendered
    assert 'row.inventory' not in rendered


def test_composite_fk_not_found_and_multi_match_messages_include_column_and_value(env):
    """cmd_548 judgment_1: ambiguity is rejected at ROW granularity with a
    message carrying column name + value (+ count for MULTI_MATCH) — not a
    bare 'ambiguous' with no actionable detail."""
    ctx = _ctx(import_fk_specs=[_COMPOSITE_SPEC])
    rendered = env.get_template('api_import_route.ts.jinja2').render(**ctx)
    assert "no inventory matches label '${_inventory_csv_val}' (column inventory_name)" in rendered
    assert "${_inventory_ids.length} inventory rows share label '${_inventory_csv_val}' (column inventory_name)" in rendered
    assert "use the 'inventory_id' column to identify rows by ID" in rendered


def test_composite_fk_nullable_empty_value_skips_map_lookup(env):
    """An empty CSV cell on a nullable composite FK resolves straight to
    null without touching the map (mirrors the existing simple dotted-FK
    nullable branch)."""
    ctx = _ctx(import_fk_specs=[_COMPOSITE_SPEC])
    rendered = env.get_template('api_import_route.ts.jinja2').render(**ctx)
    assert "if (_inventory_csv_val === '') {" in rendered
    assert '_inventory_id = null;' in rendered


def test_composite_fk_written_to_fkdata_and_updatedata(env):
    """Composite specs are always non-key (is_key=False) — write path is
    identical in shape to the existing non-key simple-dotted FK: fkData on
    CREATE, updateData on UPDATE."""
    ctx = _ctx(import_fk_specs=[_COMPOSITE_SPEC])
    rendered = env.get_template('api_import_route.ts.jinja2').render(**ctx)
    assert 'fkData.inventory_id = _inventory_id;' in rendered
    assert 'updateData.inventory_id = _inventory_id;' in rendered


# ---------------------------------------------------------------------------
# cmd_611/612: organization-typed lookup targets need a SELF-id filter
# (candidate.id in the actor's associated-org list), not an organization_id
# filter (organization rows have no such column — lookup_entity_filter_by_org
# is structurally always False when lookup_entity == 'organization', which
# previously meant NO filter applied at all: a CSV row naming any
# organization in the system, not just one the actor belongs to, would
# resolve and get attached). See TestImportOrganizationLookupSelfIdFilter in
# test_build_context.py for the Python-side spec-shape coverage; these
# tests cover the emitted TypeScript.
# ---------------------------------------------------------------------------

_ORG_DOTTED_KEY_SPEC = {
    'csv_col': 'organization_name', 'is_dotted': True, 'lookup_field': 'name',
    'var_prefix': 'organization', 'lookup_entity': 'organization',
    'result_col': 'organization_id', 'fk_nullable': False, 'raw': 'organization.name',
    'lookup_entity_filter_by_org': False, 'lookup_entity_filter_by_self_id': True,
}

_ORG_COMPOSITE_SPEC = {
    **_COMPOSITE_SPEC, 'lookup_entity': 'organization', 'lookup_entity_pascal': 'Organization',
    'lookup_entity_filter_by_org': False, 'lookup_entity_filter_by_self_id': True,
}


def test_org_dotted_key_lookup_filtered_by_self_id_not_organization_id(env):
    """A dotted x-import-key resolving 'Organization Name' -> organization_id
    must restrict candidate organization rows to the actor's own associated
    orgs via `id: { in: _importOrgIds }` — organization rows have no
    organization_id column to filter on, so the generic org-filter clause
    can never apply here; before this fix, that meant no filter at all and
    a CSV row could name (and get attached to) ANY organization system-wide."""
    ctx = _ctx(import_key_specs=[_ORG_DOTTED_KEY_SPEC], import_key_fields=[])
    rendered = env.get_template('api_import_route.ts.jinja2').render(**ctx)
    assert 'where: { name: _organization_csv_val, id: { in: _importOrgIds } },' in rendered
    assert 'organization_id: { in: _importOrgIds }' not in rendered


def test_org_dotted_key_deviation_injection_unfiltered_shape_absent(env):
    """Deviation injection: without the fix, this spec (lookup_entity_filter_by_org
    is False because organization rows have no organization_id column) rendered
    a completely unfiltered `where: { name: _organization_csv_val },` — any
    organization in the system would match by name. Confirm that exact
    unfiltered shape is no longer what's emitted."""
    ctx = _ctx(import_key_specs=[_ORG_DOTTED_KEY_SPEC], import_key_fields=[])
    rendered = env.get_template('api_import_route.ts.jinja2').render(**ctx)
    assert 'where: { name: _organization_csv_val },' not in rendered


def test_org_composite_fk_candidate_query_filtered_by_self_id(env):
    """Same self-id filter requirement for the composite/dotted-label FK
    path (cmd_548) when the lookup target is 'organization'."""
    ctx = _ctx(import_fk_specs=[_ORG_COMPOSITE_SPEC])
    rendered = env.get_template('api_import_route.ts.jinja2').render(**ctx)
    assert 'where: { id: { in: _importOrgIds } },' in rendered
    assert 'organization_id: { in: _importOrgIds }' not in rendered


def test_non_organization_lookup_unaffected_by_self_id_filter(env):
    """Sanity check: a lookup target that is neither org-scoped nor
    'organization' itself (e.g. role, system-global) still renders with
    NO filter at all — the self-id filter must not leak onto unrelated
    lookup entities."""
    ctx = _ctx(import_key_specs=[
        {'csv_col': 'role_name', 'is_dotted': True, 'lookup_field': 'name',
         'var_prefix': 'role', 'lookup_entity': 'role', 'result_col': 'role_id',
         'fk_nullable': False, 'raw': 'role.name',
         'lookup_entity_filter_by_org': False, 'lookup_entity_filter_by_self_id': False},
    ], import_key_fields=[])
    rendered = env.get_template('api_import_route.ts.jinja2').render(**ctx)
    assert 'where: { name: _role_csv_val },' in rendered
    assert 'id: { in: _importOrgIds }' not in rendered
    assert 'organization_id: { in: _importOrgIds }' not in rendered
# cmd_607: generator-side lint-debt fix. `fkData` is only ever *read* by the
# CREATE action (spread into the create payload) — declaring it and writing
# to it unconditionally left it as a dead `const` (and dead per-spec writes)
# on any entity with import_can_create=False and >=1 non-key FK spec (real
# example: `user`, discovered via a real generate-code + lint run — see
# docs/knowledge/cmd607-generator-lint-debt-fix.md). The resolved `_xxx`
# value itself (used by updateData) must still be computed regardless.
# ---------------------------------------------------------------------------

_SIMPLE_NON_KEY_SPEC = {
    'csv_col': 'requestor_role_name', 'is_dotted': True, 'lookup_field': 'name',
    'var_prefix': 'requestor_role', 'lookup_entity': 'role', 'lookup_entity_pascal': 'Role',
    'result_col': 'requestor_role_id', 'fk_nullable': True, 'raw': 'requestor_role.name',
    'is_key': False, 'lookup_entity_filter_by_org': False,
}


def test_import_can_create_false_omits_dead_fkdata_const_and_writes(env):
    ctx = _ctx(import_can_create=False, import_fk_specs=[_SIMPLE_NON_KEY_SPEC])
    rendered = env.get_template('api_import_route.ts.jinja2').render(**ctx)
    assert 'const fkData' not in rendered
    assert 'fkData.requestor_role_id' not in rendered
    # The resolved value is still computed — updateData still needs it.
    assert 'let _requestor_role_id: string | null = null;' in rendered
    assert 'updateData.requestor_role_id = _requestor_role_id;' in rendered


def test_import_can_create_false_omits_dead_fkdata_for_composite_spec(env):
    ctx = _ctx(import_can_create=False, import_fk_specs=[_COMPOSITE_SPEC])
    rendered = env.get_template('api_import_route.ts.jinja2').render(**ctx)
    assert 'const fkData' not in rendered
    assert 'fkData.inventory_id' not in rendered
    assert 'updateData.inventory_id = _inventory_id;' in rendered


def test_import_can_create_true_still_declares_and_writes_fkdata(env):
    """Non-regression companion to the two tests above."""
    ctx = _ctx(import_can_create=True, import_fk_specs=[_SIMPLE_NON_KEY_SPEC])
    rendered = env.get_template('api_import_route.ts.jinja2').render(**ctx)
    assert 'const fkData: Record<string, unknown> = {};' in rendered
    assert 'fkData.requestor_role_id = _requestor_role_id;' in rendered


def test_format_label_value_never_imported(env):
    """formatLabelValue was imported unconditionally but never referenced
    anywhere in this template — composite/dotted FK labels are matched via
    import_label_expr (built in build_context.py), not this helper. Dead in
    every entity's generated import route, regardless of branch."""
    for ctx in (
        _ctx(),
        _ctx(import_can_create=False, import_can_update=False),
        _ctx(import_fk_specs=[_COMPOSITE_SPEC]),
    ):
        rendered = env.get_template('api_import_route.ts.jinja2').render(**ctx)
        assert 'formatLabelValue' not in rendered
