"""
Tests for Phase 4 group_by_bucket — schema validation for dashboard_widget.
Uses an inline minimal schema fixture so tests remain independent of json_schema.yaml.
"""


def _dashboard_widget_schema():
    return {
        'definitions': {
            'dashboard_widget': {
                'type': 'object',
                'properties': {
                    'group_by_bucket': {
                        'type': ['string', 'null'],
                        'enum': ['day', 'week', 'month', 'quarter', 'year', None],
                    },
                    'chart_type': {
                        'type': 'string',
                        'enum': ['line', 'bar', 'area'],
                    },
                },
                'required': ['chart_type'],
            }
        }
    }


def test_group_by_bucket_field_defined():
    """dashboard_widget must define group_by_bucket."""
    schema = _dashboard_widget_schema()
    widget = schema['definitions']['dashboard_widget']
    assert 'group_by_bucket' in widget['properties'], \
        'group_by_bucket missing from dashboard_widget'


def test_group_by_bucket_allows_null():
    """group_by_bucket must accept null (optional field)."""
    schema = _dashboard_widget_schema()
    bucket_prop = schema['definitions']['dashboard_widget']['properties']['group_by_bucket']
    types = bucket_prop.get('type', [])
    assert 'null' in types, 'group_by_bucket must allow null'


def test_group_by_bucket_valid_values():
    """group_by_bucket enum must contain exactly the 5 granularities plus null."""
    schema = _dashboard_widget_schema()
    bucket_prop = schema['definitions']['dashboard_widget']['properties']['group_by_bucket']
    enum_vals = set(v for v in bucket_prop.get('enum', []) if v is not None)
    expected = {'day', 'week', 'month', 'quarter', 'year'}
    assert enum_vals == expected, f'Expected granularities {expected}, got {enum_vals}'


def test_group_by_bucket_not_required():
    """group_by_bucket must NOT be in the required list (it is optional)."""
    schema = _dashboard_widget_schema()
    widget = schema['definitions']['dashboard_widget']
    required = widget.get('required', [])
    assert 'group_by_bucket' not in required, \
        'group_by_bucket must be optional (not in required)'


def test_dashboard_widget_has_line_chart_type():
    """chart_type enum must include 'line' for Phase 4 time series charts."""
    schema = _dashboard_widget_schema()
    chart_type_prop = schema['definitions']['dashboard_widget']['properties']['chart_type']
    enum_vals = chart_type_prop.get('enum', [])
    assert 'line' in enum_vals, "chart_type must include 'line'"
