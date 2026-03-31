"""Tests for helpers/schema_helpers.py."""
import pytest
from helpers.schema_helpers import (
    is_optional_fk_to_parent,
    get_parent_relationships,
    filter_fields,
    get_detail_properties,
    get_detail_relation_name,
)


# ---------------------------------------------------------------------------
# Fixtures / helpers
# ---------------------------------------------------------------------------

def _fk_field(target: str, nullable: bool = False) -> dict:
    t = ["string", "null"] if nullable else "string"
    return {
        "type": t,
        "pattern": "^c[a-z0-9]{24,}$",
        "x-relationship": {"type": "many-to-one", "target": target, "labelField": "name"},
    }


# ---------------------------------------------------------------------------
# is_optional_fk_to_parent
# ---------------------------------------------------------------------------

class TestIsOptionalFkToParent:
    def test_mandatory_fk_returns_false(self):
        child_def = {
            "properties": {
                "epic_id": _fk_field("epic", nullable=False),
            }
        }
        assert is_optional_fk_to_parent(child_def, "epic") is False

    def test_optional_fk_returns_true(self):
        child_def = {
            "properties": {
                "feature_id": _fk_field("feature", nullable=True),
            }
        }
        assert is_optional_fk_to_parent(child_def, "feature") is True

    def test_no_fk_to_parent_returns_false(self):
        child_def = {
            "properties": {
                "other_id": _fk_field("other", nullable=False),
            }
        }
        assert is_optional_fk_to_parent(child_def, "epic") is False

    def test_empty_properties_returns_false(self):
        assert is_optional_fk_to_parent({}, "epic") is False

    def test_no_properties_key_returns_false(self):
        assert is_optional_fk_to_parent({"required": ["id"]}, "epic") is False

    def test_multiple_fks_only_matching_target_checked(self):
        # bug has FK to both feature (optional) and user_story (optional)
        child_def = {
            "properties": {
                "feature_id": _fk_field("feature", nullable=True),
                "user_story_id": _fk_field("user_story", nullable=True),
            }
        }
        assert is_optional_fk_to_parent(child_def, "feature") is True
        assert is_optional_fk_to_parent(child_def, "user_story") is True
        assert is_optional_fk_to_parent(child_def, "epic") is False


# ---------------------------------------------------------------------------
# get_parent_relationships
# ---------------------------------------------------------------------------

class TestGetParentRelationships:
    def test_finds_many_to_one_relationship(self):
        parent_def = {
            "required": ["id", "name", "epic_id"],
            "properties": {
                "id": {"type": "string"},
                "name": {"type": "string"},
                "epic_id": _fk_field("epic"),
            }
        }
        rels = get_parent_relationships(parent_def)
        assert len(rels) == 1
        assert rels[0]["prop_name"] == "epic_id"
        assert rels[0]["target"] == "epic"
        assert rels[0]["label_field"] == "name"
        assert rels[0]["required"] is True

    def test_optional_fk_required_false(self):
        parent_def = {
            "required": ["id"],
            "properties": {
                "id": {"type": "string"},
                "feature_id": _fk_field("feature", nullable=True),
            }
        }
        rels = get_parent_relationships(parent_def)
        assert rels[0]["required"] is False

    def test_excludes_creator_id(self):
        parent_def = {
            "properties": {
                "creator_id": _fk_field("user_account"),
                "epic_id": _fk_field("epic"),
            }
        }
        rels = get_parent_relationships(parent_def)
        assert all(r["prop_name"] != "creator_id" for r in rels)
        assert len(rels) == 1

    def test_excludes_non_relationship_fields(self):
        parent_def = {
            "properties": {
                "name": {"type": "string"},
                "count": {"type": "integer"},
                "epic_id": _fk_field("epic"),
            }
        }
        rels = get_parent_relationships(parent_def)
        assert len(rels) == 1

    def test_custom_label_field(self):
        parent_def = {
            "properties": {
                "order_id": {
                    "type": "string",
                    "x-relationship": {"type": "many-to-one", "target": "purchase_order", "labelField": "order_no"},
                }
            }
        }
        rels = get_parent_relationships(parent_def)
        assert rels[0]["label_field"] == "order_no"

    def test_empty_properties(self):
        assert get_parent_relationships({}) == []
        assert get_parent_relationships({"properties": {}}) == []


# ---------------------------------------------------------------------------
# filter_fields
# ---------------------------------------------------------------------------

class TestFilterFields:
    def _props(self):
        return {
            "id": {"type": "string"},
            "name": {"type": "string"},
            "description": {"type": "string"},
            "created_at": {"type": "string", "format": "date-time"},
            "updated_at": {"type": "string", "format": "date-time"},
            "creator_id": {"type": "string"},
        }

    def test_no_whitelist_returns_all(self):
        props = self._props()
        assert filter_fields(props) == props
        assert filter_fields(props, None) == props

    def test_whitelist_includes_only_listed_plus_system_fields(self):
        props = self._props()
        result = filter_fields(props, ["name"])
        assert "name" in result
        assert "id" in result
        assert "created_at" in result
        assert "updated_at" in result
        assert "creator_id" in result
        assert "description" not in result

    def test_whitelist_empty_list_treated_as_no_filter(self):
        # An empty list [] is falsy in Python, so filter_fields treats it the same
        # as None and returns all fields without filtering.
        props = self._props()
        result = filter_fields(props, [])
        assert result == props

    def test_whitelist_with_multiple_fields(self):
        props = self._props()
        result = filter_fields(props, ["name", "description"])
        assert "name" in result
        assert "description" in result
        assert "id" in result


# ---------------------------------------------------------------------------
# get_detail_properties
# ---------------------------------------------------------------------------

class TestGetDetailProperties:
    def _schema(self):
        return {
            "definitions": {
                "resource": {
                    "type": "object",
                    "properties": {"id": {"type": "string"}, "name": {"type": "string"}},
                },
                "resource_detail": {
                    "allOf": [
                        {"$ref": "#/definitions/resource"},
                        {"type": "object", "properties": {"organization": {"$ref": "#/definitions/organization"}}},
                    ]
                }
            }
        }

    def test_returns_properties_from_allof(self):
        schema = self._schema()
        props = get_detail_properties("resource", schema)
        assert props is not None
        assert "organization" in props

    def test_returns_none_when_detail_missing(self):
        assert get_detail_properties("nonexistent", {"definitions": {}}) is None

    def test_custom_detail_key(self):
        schema = {
            "definitions": {
                "my_detail": {
                    "properties": {"org": {"type": "string"}}
                }
            }
        }
        props = get_detail_properties("something", schema, detail_key="my_detail")
        assert props is not None
        assert "org" in props


# ---------------------------------------------------------------------------
# get_detail_relation_name
# ---------------------------------------------------------------------------

class TestGetDetailRelationName:
    def _schema(self):
        return {
            "definitions": {
                "booking_detail": {
                    "allOf": [
                        {"$ref": "#/definitions/booking"},
                        {
                            "type": "object",
                            "properties": {
                                "resource": {"$ref": "#/definitions/resource"},
                                "location": {"$ref": "#/definitions/location"},
                            }
                        }
                    ]
                }
            }
        }

    def test_finds_ref_by_target(self):
        assert get_detail_relation_name("booking", "resource", self._schema()) == "resource"

    def test_finds_differently_named_ref(self):
        assert get_detail_relation_name("booking", "location", self._schema()) == "location"

    def test_falls_back_to_target_when_not_found(self):
        assert get_detail_relation_name("booking", "missing", self._schema()) == "missing"
