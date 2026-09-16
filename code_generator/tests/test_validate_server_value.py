"""Tests for x-server-value shape validation (cmd_556/cmd_565, Section 2f of
validate_schema).

x-server-value is either the string 'actor' or a dict
{source: 'actor', override_permission?: <Operation>}. Only 'actor' is an
implemented source today -- an unrecognized source is silently a no-op in
build_context.py (the field keeps behaving like a normal client-writable
field), so validate_schema must catch it here instead of letting a schema
author believe protection is applied when it is not.
"""
import pytest
from validate import validate_schema, SchemaValidationError


def _schema_with_server_value(sv) -> dict:
    return {
        'definitions': {
            'leave_request': {
                'properties': {
                    'id': {'type': 'string', 'pattern': '^c[a-z0-9]{24,}$'},
                    'applicant_id': {
                        'type': 'string',
                        'pattern': '^c[a-z0-9]{24,}$',
                        'x-relationship': {'type': 'many-to-one', 'target': 'user', 'labelField': 'name'},
                        'x-server-value': sv,
                    },
                },
            },
            'user': {'properties': {'id': {'type': 'string'}, 'name': {'type': 'string'}}},
        },
    }


class TestValidServerValueShapes:
    def test_string_actor_accepted(self):
        validate_schema(_schema_with_server_value('actor'))  # must not raise

    def test_dict_source_actor_accepted(self):
        validate_schema(_schema_with_server_value({'source': 'actor'}))

    def test_dict_with_valid_override_permission_accepted(self):
        for op in ('create', 'read', 'update', 'delete', 'import'):
            validate_schema(_schema_with_server_value({'source': 'actor', 'override_permission': op}))


class TestInvalidServerValueShapes:
    def test_unsupported_string_value_rejected(self):
        with pytest.raises(SchemaValidationError) as exc_info:
            validate_schema(_schema_with_server_value('org'))
        msg = str(exc_info.value)
        assert 'leave_request' in msg
        assert 'applicant_id' in msg
        assert 'x-server-value' in msg

    def test_dict_unsupported_source_rejected(self):
        with pytest.raises(SchemaValidationError) as exc_info:
            validate_schema(_schema_with_server_value({'source': 'now'}))
        assert 'source' in str(exc_info.value)

    def test_dict_unknown_key_rejected(self):
        with pytest.raises(SchemaValidationError) as exc_info:
            validate_schema(_schema_with_server_value({'source': 'actor', 'typo_key': 'delete'}))
        assert 'unknown key' in str(exc_info.value)

    def test_dict_invalid_override_permission_rejected(self):
        with pytest.raises(SchemaValidationError) as exc_info:
            validate_schema(_schema_with_server_value({'source': 'actor', 'override_permission': 'manage'}))
        msg = str(exc_info.value)
        assert 'override_permission' in msg
        assert 'manage' in msg

    def test_non_string_non_dict_rejected(self):
        with pytest.raises(SchemaValidationError) as exc_info:
            validate_schema(_schema_with_server_value(['actor']))
        assert 'x-server-value' in str(exc_info.value)
