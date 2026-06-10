"""
Unit tests for x-bridge validation (validate.py section 6).

Clean break: old array form (role/via/kind) is rejected; new object form
(name/child/parents) is the only accepted format.

Run:
    cd code_generator && python -m pytest tests/test_bridge_validation.py -v
"""
import pytest
from validate import validate_schema, SchemaValidationError


# ---------------------------------------------------------------------------
# Minimal schema builder helpers
# ---------------------------------------------------------------------------

def _base_schema_with_bridge(bridge: object = None) -> dict:
    """Build a minimal schema with a 'child_entity' that may have x-bridge."""
    child_def = {
        "type": "object",
        "required": ["id", "name"],
        "properties": {
            "id": {"type": "string", "pattern": "^c[a-z0-9]{24,}$"},
            "name": {"type": "string"},
        },
    }
    if bridge is not None:
        child_def["x-bridge"] = bridge

    return {
        "definitions": {
            "child_entity_bridge": {
                "type": "object",
                "required": ["id"],
                "properties": {"id": {"type": "string", "pattern": "^c[a-z0-9]{24,}$"}},
            },
            "child_entity_bridge_detail": {
                "x-generate": {
                    "list": False, "view": False, "new": False, "edit": False,
                    "delete": False, "api": False, "test": False,
                },
                "allOf": [{"$ref": "#/definitions/child_entity_bridge"}],
            },
            "parent_a": {
                "type": "object",
                "required": ["id", "name"],
                "properties": {
                    "id": {"type": "string", "pattern": "^c[a-z0-9]{24,}$"},
                    "name": {"type": "string"},
                },
            },
            "parent_a_detail": {
                "x-generate": {
                    "list": True, "view": True, "new": True, "edit": True,
                    "delete": True, "api": True, "test": True,
                },
                "allOf": [{"$ref": "#/definitions/parent_a"}],
            },
            "child_entity": child_def,
            "child_entity_detail": {
                "x-generate": {
                    "list": True, "view": True, "new": True, "edit": True,
                    "delete": True, "api": True, "test": True,
                },
                "allOf": [{"$ref": "#/definitions/child_entity"}],
            },
        }
    }


def _valid_object_bridge(
    name: str = 'child_entity_bridge',
    child: str = 'child_entity',
    parents: list | None = None,
) -> dict:
    """Build a valid new-form object x-bridge."""
    if parents is None:
        parents = [{"role": "parent_a_hub", "target": "parent_a", "labelField": "name"}]
    return {
        "name": name,
        "child": child,
        "parentCardinality": "exactlyOne",
        "parents": parents,
    }


def _assert_valid(schema: dict) -> None:
    validate_schema(schema)


def _assert_invalid(schema: dict, fragment: str) -> None:
    with pytest.raises(SchemaValidationError) as exc_info:
        validate_schema(schema)
    assert fragment in str(exc_info.value), (
        f"Expected error containing {fragment!r}, got:\n{exc_info.value}"
    )


# ---------------------------------------------------------------------------
# Happy-path: new object form passes
# ---------------------------------------------------------------------------

def test_valid_object_xbridge_single_parent():
    """Valid new object x-bridge with one parent passes validation."""
    schema = _base_schema_with_bridge(_valid_object_bridge())
    _assert_valid(schema)


def test_valid_object_xbridge_multiple_parents():
    """Valid new object x-bridge with multiple parents passes validation."""
    schema = _base_schema_with_bridge(_valid_object_bridge(
        parents=[
            {"role": "parent_a_hub", "target": "parent_a", "labelField": "name"},
        ]
    ))
    _assert_valid(schema)


def test_valid_object_xbridge_optional_parentCardinality():
    """parentCardinality is optional in new object x-bridge."""
    bridge = {
        "name": "child_entity_bridge",
        "child": "child_entity",
        "parents": [{"role": "parent_a_hub", "target": "parent_a", "labelField": "name"}],
    }
    schema = _base_schema_with_bridge(bridge)
    _assert_valid(schema)


def test_valid_schema_no_xbridge():
    """Schema without x-bridge is unaffected."""
    schema = _base_schema_with_bridge()
    _assert_valid(schema)


# ---------------------------------------------------------------------------
# Clean break: old array form is now rejected
# ---------------------------------------------------------------------------

def test_old_array_form_rejected():
    """Old array x-bridge form raises a validation error (clean break)."""
    schema = _base_schema_with_bridge([
        {"role": "parent_a_hub", "target": "parent_a", "via": "parent_a_id", "kind": "one_to_one_bridge"}
    ])
    _assert_invalid(schema, "must be an object (new form)")


def test_old_array_form_with_hyphen_kind_rejected():
    """Old array x-bridge with hyphen kind is also rejected (clean break)."""
    schema = _base_schema_with_bridge([
        {"role": "parent_a_hub", "target": "parent_a", "via": "parent_a_id", "kind": "one-to-one_bridge"}
    ])
    _assert_invalid(schema, "must be an object (new form)")


def test_old_array_form_multiple_entries_rejected():
    """Multiple old array entries are also rejected (clean break)."""
    schema = _base_schema_with_bridge([
        {"role": "parent_a_hub", "target": "parent_a", "via": "parent_a_id", "kind": "one_to_one_bridge"},
        {"role": "other_hub", "target": "parent_a", "via": "parent_a_id", "kind": "one_to_one_bridge"},
    ])
    _assert_invalid(schema, "must be an object (new form)")


# ---------------------------------------------------------------------------
# Error-path: invalid object form
# ---------------------------------------------------------------------------

def test_invalid_object_xbridge_wrong_type():
    """x-bridge that is neither list nor dict raises a validation error."""
    schema = _base_schema_with_bridge("not-a-dict")
    _assert_invalid(schema, "must be an object mapping")


def test_invalid_object_xbridge_missing_name():
    """Object x-bridge missing 'name' key raises a validation error."""
    bridge = {"child": "child_entity", "parents": [{"role": "r", "target": "parent_a"}]}
    schema = _base_schema_with_bridge(bridge)
    _assert_invalid(schema, "missing required key 'name'")


def test_invalid_object_xbridge_missing_child():
    """Object x-bridge missing 'child' key raises a validation error."""
    bridge = {"name": "child_entity_bridge", "parents": [{"role": "r", "target": "parent_a"}]}
    schema = _base_schema_with_bridge(bridge)
    _assert_invalid(schema, "missing required key 'child'")


def test_invalid_object_xbridge_missing_parents():
    """Object x-bridge missing 'parents' key raises a validation error."""
    bridge = {"name": "child_entity_bridge", "child": "child_entity"}
    schema = _base_schema_with_bridge(bridge)
    _assert_invalid(schema, "missing required key 'parents'")


def test_invalid_object_xbridge_bridge_not_in_defs():
    """Object x-bridge name pointing to undefined bridge model raises error."""
    bridge = _valid_object_bridge(name="undefined_bridge")
    schema = _base_schema_with_bridge(bridge)
    _assert_invalid(schema, "not found in definitions")


def test_invalid_object_xbridge_child_mismatch():
    """Object x-bridge child that doesn't match the declaring entity raises error."""
    bridge = _valid_object_bridge(child="wrong_entity")
    schema = _base_schema_with_bridge(bridge)
    _assert_invalid(schema, "must match the declaring entity name")


def test_invalid_object_xbridge_parent_missing_role():
    """Object x-bridge parents entry missing 'role' raises error."""
    bridge = _valid_object_bridge(parents=[{"target": "parent_a"}])
    schema = _base_schema_with_bridge(bridge)
    _assert_invalid(schema, "missing required key 'role'")


def test_invalid_object_xbridge_parent_missing_target():
    """Object x-bridge parents entry missing 'target' raises error."""
    bridge = _valid_object_bridge(parents=[{"role": "hub"}])
    schema = _base_schema_with_bridge(bridge)
    _assert_invalid(schema, "missing required key 'target'")


def test_invalid_object_xbridge_parent_target_not_in_defs():
    """Object x-bridge parents entry with undefined target entity raises error."""
    bridge = _valid_object_bridge(parents=[{"role": "hub", "target": "nonexistent_entity"}])
    schema = _base_schema_with_bridge(bridge)
    _assert_invalid(schema, "not found in definitions")


def test_invalid_object_xbridge_parents_not_a_list():
    """Object x-bridge with parents as a non-list raises error."""
    bridge = {"name": "child_entity_bridge", "child": "child_entity", "parents": "not-a-list"}
    schema = _base_schema_with_bridge(bridge)
    _assert_invalid(schema, "parents must be a list")


def test_invalid_object_xbridge_parent_entry_not_a_dict():
    """Object x-bridge with non-dict parent entry raises error."""
    bridge = {"name": "child_entity_bridge", "child": "child_entity", "parents": ["not-a-dict"]}
    schema = _base_schema_with_bridge(bridge)
    _assert_invalid(schema, "must be a mapping")
