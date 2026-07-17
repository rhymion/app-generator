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
