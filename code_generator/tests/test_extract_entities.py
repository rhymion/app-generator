"""
Tests for generate_types.extract_entities() — schema parsing, entity inclusion
logic, x-generate flag defaults, and validation rules.
"""
import pytest
from generate_types import extract_entities


# ---------------------------------------------------------------------------
# Minimal schema builders
# ---------------------------------------------------------------------------

def _base_entity(name: str, extra_props: dict = None, extra_required: list = None) -> dict:
    """Minimal base entity definition with id + name."""
    props = {
        "id": {"type": "string", "pattern": "^c[a-z0-9]{24,}$"},
        "name": {"type": "string"},
    }
    props.update(extra_props or {})
    required = ["id", "name"] + (extra_required or [])
    return {"type": "object", "required": required, "properties": props}


def _detail_entity(base_name: str, children: dict = None, x_relationships: dict = None) -> dict:
    """Minimal _detail entity that allOf-refs the base and adds children."""
    allof = [{"$ref": f"#/definitions/{base_name}"}]
    if children:
        allof.append({"type": "object", "properties": children})
    defn: dict = {"allOf": allof}
    if x_relationships:
        defn["x-relationships"] = x_relationships
    return defn


def _x_gen(**flags) -> dict:
    base = {"list": True, "view": True, "new": True, "edit": True, "delete": True}
    base.update(flags)
    return base


def _schema(*pairs) -> dict:
    """Build a schema dict from (name, defn) pairs."""
    return {"definitions": dict(pairs)}


# ---------------------------------------------------------------------------
# Basic entity inclusion
# ---------------------------------------------------------------------------

class TestBasicEntityInclusion:
    def test_parent_only_entity_included(self):
        """An entity with x-generate directly on its base definition (no children)."""
        schema = _schema(
            ("resource", {**_base_entity("resource"), "x-generate": _x_gen()}),
        )
        entities = extract_entities(schema)
        assert len(entities) == 1
        assert entities[0]["model"] == "resource"

    def test_detail_entity_included(self):
        """An entity with x-generate on its _detail definition."""
        schema = _schema(
            ("resource", _base_entity("resource")),
            ("resource_detail", {**_detail_entity("resource"), "x-generate": _x_gen()}),
        )
        entities = extract_entities(schema)
        assert len(entities) == 1
        assert entities[0]["model"] == "resource"

    def test_entity_without_x_generate_excluded(self):
        schema = _schema(
            ("resource", _base_entity("resource")),
        )
        assert extract_entities(schema) == []

    def test_entity_without_id_excluded(self):
        schema = _schema(
            ("resource", {
                "x-generate": _x_gen(),
                "type": "object",
                "properties": {"name": {"type": "string"}},
            }),
        )
        assert extract_entities(schema) == []

    def test_multiple_entities_all_included(self):
        schema = _schema(
            ("epic", {**_base_entity("epic"), "x-generate": _x_gen()}),
            ("feature", {**_base_entity("feature"), "x-generate": _x_gen()}),
        )
        models = {e["model"] for e in extract_entities(schema)}
        assert models == {"epic", "feature"}


# ---------------------------------------------------------------------------
# Child entity inclusion/exclusion logic
# ---------------------------------------------------------------------------

class TestChildEntityInclusion:
    def _epic_feature_schema(
        self,
        feature_output_type: str = "list",
        feature_has_x_generate: bool = True,
    ) -> dict:
        """Epic with a 'features' list child. Feature may or may not have x-generate."""
        feature_fk = {
            "type": "string",
            "pattern": "^c[a-z0-9]{24,}$",
            "x-relationship": {"type": "many-to-one", "target": "epic", "labelField": "name"},
        }
        feature_def = _base_entity("feature", extra_props={"epic_id": feature_fk}, extra_required=["epic_id"])
        if feature_has_x_generate:
            feature_def["x-generate"] = _x_gen()

        children = {
            "features": {
                "type": "array",
                "x-outputType": feature_output_type,
                "items": {"$ref": "#/definitions/feature"},
            }
        }
        return _schema(
            ("epic", _base_entity("epic")),
            ("epic_detail", {**_detail_entity("epic", children=children), "x-generate": _x_gen()}),
            ("feature", feature_def),
            ("feature_detail", {**_detail_entity("feature"), "x-generate": _x_gen()})
            if feature_has_x_generate else ("feature", feature_def),
        )

    def test_inline_child_without_x_generate_excluded(self):
        """A child with no x-generate and no m2m pairing is not a standalone entity."""
        field_def = _base_entity("field", extra_props={
            "table_id": {"type": "string", "pattern": "^c[a-z0-9]{24,}$"},
        })
        children = {
            "fields": {
                "type": "array",
                "items": {"$ref": "#/definitions/field"},
            }
        }
        schema = _schema(
            ("db_table", _base_entity("db_table")),
            ("db_table_detail", {**_detail_entity("db_table", children=children), "x-generate": _x_gen()}),
            ("field", field_def),
        )
        entities = extract_entities(schema)
        models = {e["model"] for e in entities}
        assert "db_table" in models
        assert "field" not in models

    def test_independent_child_with_x_generate_included(self):
        """A child with its own _detail + x-generate IS included as a standalone entity."""
        schema = _schema(
            ("epic", _base_entity("epic")),
            ("epic_detail", {
                **_detail_entity("epic", children={
                    "features": {
                        "type": "array",
                        "x-outputType": "list",
                        "items": {"$ref": "#/definitions/feature"},
                    }
                }),
                "x-generate": _x_gen(),
            }),
            ("feature", _base_entity("feature")),
            ("feature_detail", {**_detail_entity("feature"), "x-generate": _x_gen()}),
        )
        models = {e["model"] for e in extract_entities(schema)}
        assert "epic" in models
        assert "feature" in models

    def test_m2m_child_included_as_standalone(self):
        """An entity that is a m2m child of a generated entity is itself included."""
        schema = _schema(
            ("user_account", _base_entity("user_account")),
            ("role", _base_entity("role")),
            ("user_account_detail", {
                "x-generate": _x_gen(),
                "x-relationships": {"roles": {"type": "many-to-many", "target": "role"}},
                "allOf": [
                    {"$ref": "#/definitions/user_account"},
                    {"type": "object", "properties": {
                        "roles": {
                            "type": "array",
                            "x-outputType": "list",
                            "items": {"$ref": "#/definitions/role"},
                        }
                    }}
                ],
            }),
            ("role_detail", {**_detail_entity("role"), "x-generate": _x_gen()}),
        )
        models = {e["model"] for e in extract_entities(schema)}
        assert "user_account" in models
        assert "role" in models


# ---------------------------------------------------------------------------
# x-generate flag defaults and values
# ---------------------------------------------------------------------------

class TestXGenerateFlags:
    def _entity_with_flags(self, **flags) -> dict:
        # Always include at least one truthy value so the dict is not falsy (empty dict
        # is falsy in Python and would cause extract_entities to skip the entity).
        x_gen = {"list": True, **flags}
        schema = _schema(
            ("resource", {**_base_entity("resource"), "x-generate": x_gen}),
        )
        return extract_entities(schema)[0]["generate_config"]

    def test_all_flags_true_by_default_when_omitted(self):
        # Only 'list' is explicit; view/new/edit/delete should still default to True
        cfg = self._entity_with_flags()
        for flag in ("list", "view", "new", "edit", "delete"):
            assert cfg[flag] is True, f"{flag} should default to True"

    def test_api_and_test_default_false(self):
        # api and test are opt-in only — default False when not set
        cfg = self._entity_with_flags()
        assert cfg["api"] is False
        assert cfg["test"] is False

    def test_api_true_when_set(self):
        cfg = self._entity_with_flags(api=True)
        assert cfg["api"] is True

    def test_test_true_when_set(self):
        cfg = self._entity_with_flags(test=True)
        assert cfg["test"] is True

    def test_individual_crud_flags_can_be_disabled(self):
        cfg = self._entity_with_flags(list=False, new=False, delete=False)
        assert cfg["list"] is False
        assert cfg["new"] is False
        assert cfg["delete"] is False
        assert cfg["view"] is True
        assert cfg["edit"] is True

    def test_fields_whitelist_passed_through(self):
        cfg = self._entity_with_flags(fields=["name", "description"])
        assert cfg["fields"] == ["name", "description"]

    def test_no_fields_whitelist_is_none(self):
        cfg = self._entity_with_flags()
        assert cfg["fields"] is None

    def test_entity_name_derived_correctly_from_detail_key(self):
        schema = _schema(
            ("resource", _base_entity("resource")),
            ("resource_detail", {**_detail_entity("resource"), "x-generate": _x_gen()}),
        )
        entity = extract_entities(schema)[0]
        assert entity["parent"] == "resource"
        assert entity["model"] == "resource"


# ---------------------------------------------------------------------------
# Validation: generated child must use x-outputType: list
# ---------------------------------------------------------------------------

class TestXGenerateChildValidation:
    def test_valid_list_output_type_does_not_raise(self):
        schema = _schema(
            ("epic", _base_entity("epic")),
            ("epic_detail", {
                "x-generate": _x_gen(),
                "allOf": [
                    {"$ref": "#/definitions/epic"},
                    {"type": "object", "properties": {
                        "features": {
                            "type": "array",
                            "x-outputType": "list",
                            "items": {"$ref": "#/definitions/feature"},
                        }
                    }}
                ],
            }),
            ("feature", _base_entity("feature")),
            ("feature_detail", {**_detail_entity("feature"), "x-generate": _x_gen()}),
        )
        # Should not raise
        extract_entities(schema)

    def test_generated_child_with_table_output_type_raises(self):
        schema = _schema(
            ("epic", _base_entity("epic")),
            ("epic_detail", {
                "x-generate": _x_gen(),
                "allOf": [
                    {"$ref": "#/definitions/epic"},
                    {"type": "object", "properties": {
                        "features": {
                            "type": "array",
                            "x-outputType": "table",  # invalid for generated child
                            "items": {"$ref": "#/definitions/feature"},
                        }
                    }}
                ],
            }),
            ("feature", _base_entity("feature")),
            ("feature_detail", {**_detail_entity("feature"), "x-generate": _x_gen()}),
        )
        with pytest.raises(ValueError, match="must be 'list'"):
            extract_entities(schema)

    def test_generated_child_with_comments_output_type_raises(self):
        schema = _schema(
            ("epic", _base_entity("epic")),
            ("epic_detail", {
                "x-generate": _x_gen(),
                "allOf": [
                    {"$ref": "#/definitions/epic"},
                    {"type": "object", "properties": {
                        "features": {
                            "type": "array",
                            "x-outputType": "comments",  # invalid for generated child
                            "items": {"$ref": "#/definitions/feature"},
                        }
                    }}
                ],
            }),
            ("feature", _base_entity("feature")),
            ("feature_detail", {**_detail_entity("feature"), "x-generate": _x_gen()}),
        )
        with pytest.raises(ValueError, match="must be 'list'"):
            extract_entities(schema)

    def test_non_generated_child_can_use_any_output_type(self):
        """Non-generated children (no x-generate) are not subject to the validation."""
        inline_child = _base_entity("field")
        schema = _schema(
            ("parent", _base_entity("parent")),
            ("parent_detail", {
                "x-generate": _x_gen(),
                "allOf": [
                    {"$ref": "#/definitions/parent"},
                    {"type": "object", "properties": {
                        "fields": {
                            "type": "array",
                            "x-outputType": "table",
                            "items": {"$ref": "#/definitions/field"},
                        }
                    }}
                ],
            }),
            ("field", inline_child),
        )
        # Should not raise — field has no x-generate
        extract_entities(schema)
