"""
Unit tests for x-bridge validation (validate.py section 6).

Run:
    cd code_generator && python -m pytest tests/test_bridge_validation.py -v
"""
import pytest
from validate import validate_schema, SchemaValidationError


# ---------------------------------------------------------------------------
# Minimal schema builder helpers
# ---------------------------------------------------------------------------

def _base_schema(entity_extra: dict = None, bridge_entries: list = None) -> dict:
    """Build a minimal schema with a 'sample' entity that has x-bridge."""
    sample_def = {
        "type": "object",
        "required": ["id", "name"],
        "properties": {
            "id": {"type": "string", "pattern": "^c[a-z0-9]{24,}$"},
            "name": {"type": "string"},
            "bridge_target_id": {
                "type": "string",
                "pattern": "^c[a-z0-9]{24,}$",
            },
        },
    }
    if entity_extra:
        sample_def.update(entity_extra)
    if bridge_entries is not None:
        sample_def["x-bridge"] = bridge_entries

    return {
        "definitions": {
            "bridge_target": {
                "type": "object",
                "required": ["id"],
                "properties": {"id": {"type": "string"}},
            },
            "bridge_target_detail": {
                "x-generate": {
                    "list": False, "view": False, "new": False, "edit": False,
                    "delete": False, "api": False, "test": False,
                },
                "allOf": [{"$ref": "#/definitions/bridge_target"}],
            },
            "sample": sample_def,
            "sample_detail": {
                "x-generate": {
                    "list": True, "view": True, "new": True, "edit": True,
                    "delete": True, "api": True, "test": True,
                },
                "allOf": [{"$ref": "#/definitions/sample"}],
            },
        }
    }


def _assert_valid(schema: dict) -> None:
    """Assert that validate_schema raises no error."""
    validate_schema(schema)


def _assert_invalid(schema: dict, fragment: str) -> None:
    """Assert that validate_schema raises SchemaValidationError containing fragment."""
    with pytest.raises(SchemaValidationError) as exc_info:
        validate_schema(schema)
    assert fragment in str(exc_info.value), (
        f"Expected error containing {fragment!r}, got:\n{exc_info.value}"
    )


# ---------------------------------------------------------------------------
# Happy-path tests
# ---------------------------------------------------------------------------

def test_valid_xbridge_single_entry():
    """Valid x-bridge array with one entry passes validation."""
    schema = _base_schema(bridge_entries=[
        {"role": "bridge_target", "target": "bridge_target", "via": "bridge_target_id", "kind": "one_to_one_bridge"}
    ])
    _assert_valid(schema)


def test_valid_xbridge_hyphen_kind():
    """'one-to-one_bridge' (hyphen) is also an accepted kind value."""
    schema = _base_schema(bridge_entries=[
        {"role": "bridge_target", "target": "bridge_target", "via": "bridge_target_id", "kind": "one-to-one_bridge"}
    ])
    _assert_valid(schema)


def test_valid_schema_no_xbridge():
    """Schema without x-bridge is unaffected (backward compat)."""
    schema = _base_schema()
    _assert_valid(schema)


def test_valid_xbridge_multiple_entries():
    """Multiple x-bridge entries (with distinct via fields) passes validation."""
    schema = _base_schema()
    schema["definitions"]["sample"]["properties"]["second_id"] = {
        "type": "string", "pattern": "^c[a-z0-9]{24,}$"
    }
    schema["definitions"]["second_target"] = {
        "type": "object",
        "required": ["id"],
        "properties": {"id": {"type": "string"}},
    }
    schema["definitions"]["second_target_detail"] = {
        "x-generate": {
            "list": False, "view": False, "new": False, "edit": False,
            "delete": False, "api": False, "test": False,
        },
        "allOf": [{"$ref": "#/definitions/second_target"}],
    }
    schema["definitions"]["sample"]["x-bridge"] = [
        {"role": "bridge_target", "target": "bridge_target", "via": "bridge_target_id", "kind": "one_to_one_bridge"},
        {"role": "second_target", "target": "second_target", "via": "second_id", "kind": "one_to_one_bridge"},
    ]
    _assert_valid(schema)


# ---------------------------------------------------------------------------
# Error-path tests
# ---------------------------------------------------------------------------

def test_invalid_xbridge_not_a_list():
    """x-bridge that is not a list raises a validation error."""
    schema = _base_schema()
    schema["definitions"]["sample"]["x-bridge"] = {"role": "bridge_target"}
    _assert_invalid(schema, "x-bridge must be a list")


def test_invalid_xbridge_missing_role():
    """Entry missing 'role' raises a validation error."""
    schema = _base_schema(bridge_entries=[
        {"target": "bridge_target", "via": "bridge_target_id", "kind": "one_to_one_bridge"}
    ])
    _assert_invalid(schema, "missing required key 'role'")


def test_invalid_xbridge_missing_target():
    """Entry missing 'target' raises a validation error."""
    schema = _base_schema(bridge_entries=[
        {"role": "bridge_target", "via": "bridge_target_id", "kind": "one_to_one_bridge"}
    ])
    _assert_invalid(schema, "missing required key 'target'")


def test_invalid_xbridge_missing_via():
    """Entry missing 'via' raises a validation error."""
    schema = _base_schema(bridge_entries=[
        {"role": "bridge_target", "target": "bridge_target", "kind": "one_to_one_bridge"}
    ])
    _assert_invalid(schema, "missing required key 'via'")


def test_invalid_xbridge_missing_kind():
    """Entry missing 'kind' raises a validation error."""
    schema = _base_schema(bridge_entries=[
        {"role": "bridge_target", "target": "bridge_target", "via": "bridge_target_id"}
    ])
    _assert_invalid(schema, "missing required key 'kind'")


def test_invalid_xbridge_target_not_in_schema():
    """Entry with a target entity not defined in the schema raises a validation error."""
    schema = _base_schema(bridge_entries=[
        {"role": "nonexistent", "target": "nonexistent", "via": "bridge_target_id", "kind": "one_to_one_bridge"}
    ])
    _assert_invalid(schema, "target entity 'nonexistent' is not defined")


def test_invalid_xbridge_via_field_not_in_properties():
    """Entry whose via field is not in the entity's properties raises a validation error."""
    schema = _base_schema(bridge_entries=[
        {"role": "bridge_target", "target": "bridge_target", "via": "missing_field_id", "kind": "one_to_one_bridge"}
    ])
    _assert_invalid(schema, "via field 'missing_field_id' does not exist")


def test_invalid_xbridge_bad_kind():
    """Entry with an invalid kind value raises a validation error."""
    schema = _base_schema(bridge_entries=[
        {"role": "bridge_target", "target": "bridge_target", "via": "bridge_target_id", "kind": "many_to_many"}
    ])
    _assert_invalid(schema, "not a valid bridge kind")
