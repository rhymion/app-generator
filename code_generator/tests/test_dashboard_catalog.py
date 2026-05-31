"""
Tests for build_dashboard_catalog — catalog generation for dashboardable entities.
Covers existing kinds (fk, boolean, enum) and the new number/datetime kinds.
Also tests the dashboard_aggregate_route.ts.jinja2 template (Phase 5).
"""
import pytest
from pathlib import Path
from jinja2 import Environment, FileSystemLoader
from generators import build_dashboard_catalog

REPO_ROOT = Path(__file__).resolve().parents[2]
TEMPLATES_DIR = REPO_ROOT / 'code_generator' / 'templates'


def _schema(entities: dict) -> dict:
    """Wrap entity definitions into a minimal schema dict."""
    return {'definitions': entities}


def _entity(props: dict, dashboard: bool = True) -> dict:
    """Build a minimal entity definition."""
    return {
        'type': 'object',
        'x-display': {'dashboard': dashboard} if dashboard else {},
        'properties': {'id': {'type': 'string'}, **props},
    }


# ---------------------------------------------------------------------------
# Basic kind detection
# ---------------------------------------------------------------------------

def test_boolean_field_produces_boolean_kind():
    schema = _schema({
        'task': _entity({'is_done': {'type': 'boolean'}}),
    })
    catalog = build_dashboard_catalog(schema)
    assert len(catalog) == 1
    field = catalog[0]['groupable_fields'][0]
    assert field['name'] == 'is_done'
    assert field['kind'] == 'boolean'


def test_integer_with_enum_produces_enum_kind():
    schema = _schema({
        'task': _entity({'status': {'type': 'integer', 'enum': [0, 1, 2]}}),
    })
    catalog = build_dashboard_catalog(schema)
    field = catalog[0]['groupable_fields'][0]
    assert field['kind'] == 'enum'
    assert field['enum_values'] == ['0', '1', '2']


def test_fk_field_produces_fk_kind():
    schema = _schema({
        'booking': _entity({
            'user_id': {
                'type': 'string',
                'x-relationship': {'type': 'many-to-one', 'target': 'user', 'labelField': 'name'},
            }
        }),
    })
    catalog = build_dashboard_catalog(schema)
    field = catalog[0]['groupable_fields'][0]
    assert field['kind'] == 'fk'
    assert field['fk_target'] == 'user'
    assert field['fk_label_field'] == 'name'


# ---------------------------------------------------------------------------
# New kinds: number and datetime
# ---------------------------------------------------------------------------

def test_integer_without_enum_produces_number_kind():
    schema = _schema({
        'product': _entity({'price': {'type': 'integer'}}),
    })
    catalog = build_dashboard_catalog(schema)
    assert len(catalog) == 1
    field = catalog[0]['groupable_fields'][0]
    assert field['name'] == 'price'
    assert field['kind'] == 'number'
    assert 'enum_values' not in field


def test_number_type_without_enum_produces_number_kind():
    schema = _schema({
        'metric': _entity({'score': {'type': 'number'}}),
    })
    catalog = build_dashboard_catalog(schema)
    field = catalog[0]['groupable_fields'][0]
    assert field['kind'] == 'number'


def test_string_with_date_format_produces_datetime_kind():
    schema = _schema({
        'leave_request': _entity({'start_date': {'type': 'string', 'format': 'date'}}),
    })
    catalog = build_dashboard_catalog(schema)
    field = catalog[0]['groupable_fields'][0]
    assert field['name'] == 'start_date'
    assert field['kind'] == 'datetime'
    assert field['datetime_format'] == 'date'


def test_string_with_datetime_format_produces_datetime_kind():
    schema = _schema({
        'booking': _entity({'start_time': {'type': 'string', 'format': 'date-time'}}),
    })
    catalog = build_dashboard_catalog(schema)
    field = catalog[0]['groupable_fields'][0]
    assert field['kind'] == 'datetime'
    assert field['datetime_format'] == 'date-time'


def test_plain_string_field_excluded():
    """Plain strings without date format should not appear as groupable fields."""
    schema = _schema({
        'resource': _entity({'name': {'type': 'string'}}),
    })
    catalog = build_dashboard_catalog(schema)
    # Entity has no groupable fields → dropped from catalog.
    assert len(catalog) == 0


# ---------------------------------------------------------------------------
# Exclusion rules
# ---------------------------------------------------------------------------

def test_entity_without_dashboard_flag_excluded():
    schema = _schema({
        'hidden': _entity({'price': {'type': 'integer'}}, dashboard=False),
    })
    assert build_dashboard_catalog(schema) == []


def test_detail_and_input_variants_excluded():
    schema = _schema({
        'task_detail': _entity({'is_done': {'type': 'boolean'}}),
        'task_input': _entity({'is_done': {'type': 'boolean'}}),
        'task': _entity({'is_done': {'type': 'boolean'}}),
    })
    catalog = build_dashboard_catalog(schema)
    assert len(catalog) == 1
    assert catalog[0]['name'] == 'task'


def test_system_fields_excluded():
    """id, created_at, updated_at, creator_id, updater_id should never appear."""
    schema = _schema({
        'task': _entity({
            'created_at': {'type': 'string', 'format': 'date-time'},
            'updated_at': {'type': 'string', 'format': 'date-time'},
            'creator_id': {'type': 'string'},
            'updater_id': {'type': 'string'},
            'is_done': {'type': 'boolean'},
        }),
    })
    catalog = build_dashboard_catalog(schema)
    field_names = [f['name'] for f in catalog[0]['groupable_fields']]
    assert 'created_at' not in field_names
    assert 'updated_at' not in field_names
    assert 'is_done' in field_names


# ---------------------------------------------------------------------------
# Fixture schema integration — uses the actual json_schema.yaml
# ---------------------------------------------------------------------------

def test_fixture_schema_number_and_datetime_kinds():
    """product.price → number kind; booking.start_time → datetime kind."""
    import yaml
    from pathlib import Path

    schema_path = Path(__file__).parent.parent / 'json_schema.yaml'
    if not schema_path.exists():
        pytest.skip('json_schema.yaml not found')

    with open(schema_path) as f:
        schema = yaml.safe_load(f)

    catalog = build_dashboard_catalog(schema)
    by_name = {e['name']: e for e in catalog}

    # product.price should be number kind
    assert 'product' in by_name, 'product entity not in catalog'
    product_fields = {f['name']: f for f in by_name['product']['groupable_fields']}
    assert 'price' in product_fields
    assert product_fields['price']['kind'] == 'number'

    # booking.start_time and end_time should be datetime kind
    assert 'booking' in by_name, 'booking entity not in catalog'
    booking_fields = {f['name']: f for f in by_name['booking']['groupable_fields']}
    assert 'start_time' in booking_fields
    assert booking_fields['start_time']['kind'] == 'datetime'
    assert booking_fields['start_time']['datetime_format'] == 'date-time'

    # leave_request.start_date should be datetime kind
    assert 'leave_request' in by_name, 'leave_request entity not in catalog'
    lr_fields = {f['name']: f for f in by_name['leave_request']['groupable_fields']}
    assert 'start_date' in lr_fields
    assert lr_fields['start_date']['kind'] == 'datetime'
    assert lr_fields['start_date']['datetime_format'] == 'date'


# ---------------------------------------------------------------------------
# Phase 5: dashboard_aggregate_route.ts.jinja2 template
# ---------------------------------------------------------------------------

def _make_env() -> Environment:
    env = Environment(
        loader=FileSystemLoader(str(TEMPLATES_DIR)),
        trim_blocks=True,
        lstrip_blocks=True,
        keep_trailing_newline=True,
    )
    return env


def test_aggregate_route_template_renders():
    """Template renders without error with an empty context."""
    env = _make_env()
    result = env.get_template('dashboard_aggregate_route.ts.jinja2').render()
    assert 'aggregateForWidgetCore' in result


def test_aggregate_route_enforces_api_key_auth():
    """Route must authenticate via API key, not session."""
    env = _make_env()
    result = env.get_template('dashboard_aggregate_route.ts.jinja2').render()
    assert 'authenticateApiKey' in result
    # Must NOT call getServerSession — the API-key path must be used.
    assert 'getServerSession' not in result


def test_aggregate_route_enforces_permission_check():
    """Route must call requireApiPermission to enforce entity-level authz."""
    env = _make_env()
    result = env.get_template('dashboard_aggregate_route.ts.jinja2').render()
    assert 'requireApiPermission' in result


def test_aggregate_route_validates_required_fields():
    """Route must validate entity_name and group_by_field presence."""
    env = _make_env()
    result = env.get_template('dashboard_aggregate_route.ts.jinja2').render()
    assert 'entity_name' in result
    assert 'group_by_field' in result
    assert '400' in result


def test_aggregate_route_returns_json():
    """Route must return NextResponse.json with the aggregate result."""
    env = _make_env()
    result = env.get_template('dashboard_aggregate_route.ts.jinja2').render()
    assert 'NextResponse.json' in result
    assert 'handleApiError' in result


# ---------------------------------------------------------------------------
# Phase 5 security: rejection tests — unknown field/bucket → 400
# ---------------------------------------------------------------------------

def test_aggregate_route_delegates_to_core():
    """Route must delegate to aggregateForWidgetCore, which validates fields."""
    env = _make_env()
    result = env.get_template('dashboard_aggregate_route.ts.jinja2').render()
    # aggregateForWidgetCore throws ApiError(400) for unknown field/bucket;
    # handleApiError converts it to a 400 JSON response.
    assert 'aggregateForWidgetCore' in result
    assert 'handleApiError' in result


def test_aggregate_route_no_raw_sql():
    """Route template must not contain any $queryRaw or Prisma.raw references."""
    env = _make_env()
    result = env.get_template('dashboard_aggregate_route.ts.jinja2').render()
    assert '$queryRaw' not in result
    assert '$executeRaw' not in result
    assert 'Prisma.raw' not in result
    assert '$queryRawUnsafe' not in result


def test_aggregate_route_handles_401_403():
    """Route must enforce auth before calling aggregateForWidgetCore."""
    env = _make_env()
    result = env.get_template('dashboard_aggregate_route.ts.jinja2').render()
    # authenticateApiKey raises ApiError(401) for missing/invalid key.
    # requireApiPermission raises ApiError(403) for insufficient permissions.
    assert 'authenticateApiKey' in result
    assert 'requireApiPermission' in result
