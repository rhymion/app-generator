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
