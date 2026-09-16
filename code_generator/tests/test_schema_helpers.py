"""Tests for helpers/schema_helpers.py."""
import pytest
from helpers.schema_helpers import (
    is_optional_fk_to_parent,
    get_parent_relationships,
    filter_fields,
    get_detail_properties,
    get_detail_relation_name,
    get_detail_ref_rels,
    get_flatten_rels,
    derive_searchable_relation_fields,
    derive_cross_entity_searchable_fields,
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
                "__resource": {
                    "type": "object",
                    "properties": {"id": {"type": "string"}, "name": {"type": "string"}},
                },
                "resource": {
                    "allOf": [
                        {"$ref": "#/definitions/__resource"},
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
                "booking": {
                    "allOf": [
                        {"$ref": "#/definitions/__booking"},
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


# ---------------------------------------------------------------------------
# get_detail_ref_rels
# ---------------------------------------------------------------------------

class TestGetDetailRefRels:
    def _schema(self):
        return {
            "definitions": {
                "__checkup": {
                    "type": "object",
                    "properties": {
                        "id": {"type": "string"},
                        "patient_rel_id": {
                            "type": "string",
                            "x-relationship": {"type": "many-to-one", "target": "patient_rel", "labelField": "patient_no"},
                        },
                    },
                },
                "checkup": {
                    "allOf": [
                        {"$ref": "#/definitions/__checkup"},
                        {
                            "type": "object",
                            "properties": {
                                "patient_rel": {"$ref": "#/definitions/patient_rel"},
                                "pre_check": {"$ref": "#/definitions/pre_check"},
                                "medicines": {"type": "array", "x-outputType": "list", "items": {"$ref": "#/definitions/medicine"}},
                            },
                        },
                    ]
                },
                "patient_rel": {
                    "type": "object",
                    "properties": {"id": {"type": "string"}, "patient_no": {"type": "string"}},
                },
                "pre_check": {
                    "type": "object",
                    "properties": {
                        "id": {"type": "string"},
                        "checkup_id": {"type": "string"},
                        "ams_score": {"type": ["integer", "null"]},
                    },
                },
                "medicine": {
                    "type": "object",
                    "properties": {"id": {"type": "string"}, "name": {"type": "string"}},
                },
            }
        }

    def test_detects_reverse_oto(self):
        schema = self._schema()
        parent_def = schema["definitions"]["__checkup"]
        rels = get_detail_ref_rels("checkup", parent_def, schema)
        assert len(rels) == 1
        assert rels[0]["prop_name"] == "pre_check"
        assert rels[0]["target"] == "pre_check"

    def test_skips_many_to_one_rel(self):
        schema = self._schema()
        parent_def = schema["definitions"]["__checkup"]
        rels = get_detail_ref_rels("checkup", parent_def, schema)
        prop_names = [r["prop_name"] for r in rels]
        assert "patient_rel" not in prop_names

    def test_skips_array_children(self):
        schema = self._schema()
        parent_def = schema["definitions"]["__checkup"]
        rels = get_detail_ref_rels("checkup", parent_def, schema)
        prop_names = [r["prop_name"] for r in rels]
        assert "medicines" not in prop_names

    def test_label_field_auto_detected(self):
        schema = self._schema()
        parent_def = schema["definitions"]["__checkup"]
        rels = get_detail_ref_rels("checkup", parent_def, schema)
        assert rels[0]["label_field"] == "ams_score"

    def test_label_field_from_x_labelField(self):
        schema = self._schema()
        # Add x-labelField to the detail property
        detail_props = schema["definitions"]["checkup"]["allOf"][1]["properties"]
        detail_props["pre_check"]["x-labelField"] = "custom_field"
        parent_def = schema["definitions"]["__checkup"]
        rels = get_detail_ref_rels("checkup", parent_def, schema)
        assert rels[0]["label_field"] == "custom_field"

    def test_empty_when_no_detail_def(self):
        schema = {"definitions": {"thing": {"type": "object", "properties": {"id": {"type": "string"}}}}}
        parent_def = schema["definitions"]["thing"]
        rels = get_detail_ref_rels("thing", parent_def, schema)
        assert rels == []

    def test_skips_flatten_properties(self):
        """Properties with x-outputType: flatten are excluded from reverse OTO rels."""
        schema = self._schema()
        detail_props = schema["definitions"]["checkup"]["allOf"][1]["properties"]
        detail_props["pre_check"]["x-outputType"] = "flatten"
        parent_def = schema["definitions"]["__checkup"]
        rels = get_detail_ref_rels("checkup", parent_def, schema)
        prop_names = [r["prop_name"] for r in rels]
        assert "pre_check" not in prop_names


# ---------------------------------------------------------------------------
# get_flatten_rels
# ---------------------------------------------------------------------------

class TestGetFlattenRels:
    def _schema(self):
        return {
            "definitions": {
                "__checkup": {
                    "type": "object",
                    "properties": {
                        "id": {"type": "string"},
                        "patient_rel_id": {
                            "type": "string",
                            "x-relationship": {"type": "many-to-one", "target": "patient_rel", "labelField": "patient_no"},
                        },
                    },
                },
                "checkup": {
                    "allOf": [
                        {"$ref": "#/definitions/__checkup"},
                        {
                            "type": "object",
                            "properties": {
                                "patient_rel": {
                                    "x-outputType": "flatten",
                                    "$ref": "#/definitions/patient_rel",
                                },
                                "pre_check": {
                                    "x-outputType": "flatten",
                                    "$ref": "#/definitions/pre_check",
                                },
                                "lifestyle": {
                                    "$ref": "#/definitions/lifestyle",  # no flatten — should be excluded
                                },
                                "medicines": {
                                    "type": "array",
                                    "x-outputType": "flatten",
                                    "items": {"$ref": "#/definitions/medicine"},
                                },
                            },
                        },
                    ]
                },
                "patient_rel": {
                    "type": "object",
                    "properties": {
                        "id": {"type": "string"},
                        "patient_id": {
                            "type": "string",
                            "x-relationship": {"type": "many-to-one", "target": "patient", "labelField": "name"},
                        },
                        "patient_no": {"type": "string"},
                    },
                },
                "pre_check": {
                    "type": "object",
                    "properties": {
                        "id": {"type": "string"},
                        "checkup_id": {
                            "type": "string",
                            "x-relationship": {"type": "one-to-one", "target": "checkup", "labelField": "name"},
                        },
                        "ams_score": {"type": ["integer", "null"]},
                    },
                },
                "lifestyle": {
                    "type": "object",
                    "properties": {
                        "id": {"type": "string"},
                        "checkup_id": {"type": "string"},
                        "quolity_of_sleep": {"type": "integer"},
                    },
                },
                "medicine": {
                    "type": "object",
                    "properties": {"id": {"type": "string"}, "name": {"type": "string"}},
                },
                "patient": {
                    "type": "object",
                    "properties": {"id": {"type": "string"}, "name": {"type": "string"}},
                },
            }
        }

    def test_returns_only_flatten_annotated_properties(self):
        schema = self._schema()
        parent_def = schema["definitions"]["__checkup"]
        rels = get_flatten_rels("checkup", parent_def, schema)
        prop_names = [r["prop_name"] for r in rels]
        assert "patient_rel" in prop_names
        assert "pre_check" in prop_names
        # lifestyle has no x-outputType: flatten
        assert "lifestyle" not in prop_names

    def test_skips_array_properties(self):
        """Arrays with x-outputType: flatten should still be skipped."""
        schema = self._schema()
        parent_def = schema["definitions"]["__checkup"]
        rels = get_flatten_rels("checkup", parent_def, schema)
        prop_names = [r["prop_name"] for r in rels]
        assert "medicines" not in prop_names

    def test_m2o_flag_when_fk_in_parent(self):
        """patient_rel is m2o because patient_rel_id exists in checkup base props."""
        schema = self._schema()
        parent_def = schema["definitions"]["__checkup"]
        rels = get_flatten_rels("checkup", parent_def, schema)
        patient_rel_entry = next(r for r in rels if r["prop_name"] == "patient_rel")
        assert patient_rel_entry["is_m2o"] is True

    def test_non_m2o_when_fk_not_in_parent(self):
        """pre_check is non-m2o because pre_check_id is not in checkup base props."""
        schema = self._schema()
        parent_def = schema["definitions"]["__checkup"]
        rels = get_flatten_rels("checkup", parent_def, schema)
        pre_check_entry = next(r for r in rels if r["prop_name"] == "pre_check")
        assert pre_check_entry["is_m2o"] is False

    def test_extracts_fields_from_target(self):
        """Fields from target entity are returned, excluding back-refs and system fields."""
        schema = self._schema()
        parent_def = schema["definitions"]["__checkup"]
        rels = get_flatten_rels("checkup", parent_def, schema)
        pre_check_entry = next(r for r in rels if r["prop_name"] == "pre_check")
        field_names = [f["name"] for f in pre_check_entry["fields"]]
        # ams_score should be included
        assert "ams_score" in field_names
        # checkup_id (back-ref to parent) should be excluded
        assert "checkup_id" not in field_names
        # id (system field) should be excluded
        assert "id" not in field_names

    def test_fk_field_in_target_marked_as_is_fk(self):
        """FK field (patient_id in patient_rel) should have is_fk=True."""
        schema = self._schema()
        parent_def = schema["definitions"]["__checkup"]
        rels = get_flatten_rels("checkup", parent_def, schema)
        patient_rel_entry = next(r for r in rels if r["prop_name"] == "patient_rel")
        fk_fields = [f for f in patient_rel_entry["fields"] if f.get("is_fk")]
        assert len(fk_fields) == 1
        assert fk_fields[0]["name"] == "patient_id"
        assert fk_fields[0]["fk_target"] == "patient"
        assert fk_fields[0]["fk_label_field"] == "name"
        assert fk_fields[0]["relation_name"] == "patient"

    def test_x_relation_name_override(self):
        """x-relationName annotation overrides the relation name."""
        schema = self._schema()
        detail_props = schema["definitions"]["checkup"]["allOf"][1]["properties"]
        detail_props["pre_check"]["x-relationName"] = "preCheckOverride"
        parent_def = schema["definitions"]["__checkup"]
        rels = get_flatten_rels("checkup", parent_def, schema)
        pre_check_entry = next(r for r in rels if r["prop_name"] == "pre_check")
        assert pre_check_entry["relation_name"] == "preCheckOverride"

    def test_empty_when_no_flatten_properties(self):
        """Returns empty list when no detail properties have x-outputType: flatten."""
        schema = {
            "definitions": {
                "thing": {"type": "object", "properties": {"id": {"type": "string"}}},
                "thing_detail": {
                    "allOf": [
                        {"$ref": "#/definitions/thing"},
                        {"type": "object", "properties": {"other": {"$ref": "#/definitions/other"}}},
                    ]
                },
                "other": {"type": "object", "properties": {"id": {"type": "string"}}},
            }
        }
        parent_def = schema["definitions"]["thing"]
        rels = get_flatten_rels("thing", parent_def, schema)
        assert rels == []

    def test_empty_when_no_detail_def(self):
        """Returns empty list when there is no _detail definition."""
        schema = {"definitions": {"thing": {"type": "object", "properties": {"id": {"type": "string"}}}}}
        parent_def = schema["definitions"]["thing"]
        rels = get_flatten_rels("thing", parent_def, schema)
        assert rels == []


# ---------------------------------------------------------------------------
# get_flatten_rels — flatten $ref targets a *_detail definition
# ---------------------------------------------------------------------------

class TestGetFlattenRelsRefToDetail:
    """When a flatten property's $ref points at `<base>_detail` (an allOf
    of `[base, {extension properties}]`), the extracted fields should
    represent the *merged* view — both the base entity's scalars and any
    extension-only fields (incl. array `$ref` items). Back-references to
    the parent (whether via x-relationship or a plain `$ref` to the
    parent) are filtered out so they don't show up in the inline
    accordion as a self-evident link.
    """

    def _schema(self):
        return {
            "definitions": {
                # Parent
                "__checkup": {
                    "type": "object",
                    "properties": {
                        "id": {"type": "string"},
                    },
                },
                "checkup": {
                    "allOf": [
                        {"$ref": "#/definitions/__checkup"},
                        {
                            "type": "object",
                            "properties": {
                                "pre_check": {
                                    "x-outputType": "flatten",
                                    "$ref": "#/definitions/pre_check",
                                },
                            },
                        },
                    ]
                },
                # Flatten target: raw + view extension
                "__pre_check": {
                    "type": "object",
                    "properties": {
                        "id": {"type": "string"},
                        "checkup_id": {
                            "type": "string",
                            "x-relationship": {
                                "type": "one-to-one",
                                "target": "checkup",
                                "labelField": "checkup_date",
                            },
                        },
                        "ams_score": {"type": ["integer", "null"]},
                    },
                },
                "pre_check": {
                    "allOf": [
                        {"$ref": "#/definitions/__pre_check"},
                        {
                            "type": "object",
                            "properties": {
                                # Plain $ref back to the parent — should be
                                # filtered out as self-evident.
                                "checkup": {"$ref": "#/definitions/checkup"},
                                # Array $ref → surfaced with is_array=True.
                                "symptoms": {
                                    "type": "array",
                                    "x-outputType": "list",
                                    "items": {"$ref": "#/definitions/symptom"},
                                },
                            },
                        },
                    ]
                },
                "symptom": {
                    "type": "object",
                    "properties": {
                        "id": {"type": "string"},
                        "pre_check_id": {"type": "string"},
                        "name": {"type": "string"},
                    },
                },
            }
        }

    def test_merges_base_and_detail_properties(self):
        """A scalar inherited from `pre_check` (ams_score) must surface
        even when the flatten target is `pre_check_detail`."""
        schema = self._schema()
        parent_def = schema["definitions"]["__checkup"]
        rels = get_flatten_rels("checkup", parent_def, schema)
        pre_check_entry = next(r for r in rels if r["prop_name"] == "pre_check")
        names = [f["name"] for f in pre_check_entry["fields"]]
        assert "ams_score" in names, (
            "ams_score is defined on the *base* pre_check; merging the "
            "*_detail allOf should expose it through the flatten fields."
        )

    def test_includes_array_ref_field_from_detail_extension(self):
        """`symptoms` (array of $ref in the detail extension) must be
        present with `is_array=True` and the item target name attached so
        renderers can build a list-widget against it."""
        schema = self._schema()
        parent_def = schema["definitions"]["__checkup"]
        rels = get_flatten_rels("checkup", parent_def, schema)
        pre_check_entry = next(r for r in rels if r["prop_name"] == "pre_check")
        symptoms_field = next(
            (f for f in pre_check_entry["fields"] if f["name"] == "symptoms"),
            None,
        )
        assert symptoms_field is not None
        assert symptoms_field.get("is_array") is True
        assert symptoms_field.get("item_target") == "symptom"
        # Array items are *not* FKs even though their target is another entity.
        assert symptoms_field.get("is_fk") is False

    def test_filters_ref_back_reference_to_parent(self):
        """The plain `$ref: checkup` inside pre_check_detail is a
        self-evident back-reference to the parent and must be excluded —
        the parent is the form being rendered."""
        schema = self._schema()
        parent_def = schema["definitions"]["__checkup"]
        rels = get_flatten_rels("checkup", parent_def, schema)
        pre_check_entry = next(r for r in rels if r["prop_name"] == "pre_check")
        names = [f["name"] for f in pre_check_entry["fields"]]
        assert "checkup" not in names

    def test_filters_xrelationship_back_reference_to_parent(self):
        """The base entity's `checkup_id` (x-relationship → checkup) is
        also a back-reference. The pre-existing rule covered this for
        plain flatten targets; verify it still applies after merging."""
        schema = self._schema()
        parent_def = schema["definitions"]["__checkup"]
        rels = get_flatten_rels("checkup", parent_def, schema)
        pre_check_entry = next(r for r in rels if r["prop_name"] == "pre_check")
        names = [f["name"] for f in pre_check_entry["fields"]]
        assert "checkup_id" not in names

    def test_filters_ref_back_reference_via_parent_raw_name(self):
        """When the detail extension references `__<parent>` (the raw
        entity, not the bare view), that's still a back-reference."""
        schema = self._schema()
        # Replace the plain `checkup` $ref with a `__checkup` $ref.
        detail_extension = schema["definitions"]["pre_check"]["allOf"][1]
        detail_extension["properties"]["checkup"] = {
            "$ref": "#/definitions/__checkup",
        }
        parent_def = schema["definitions"]["__checkup"]
        rels = get_flatten_rels("checkup", parent_def, schema)
        pre_check_entry = next(r for r in rels if r["prop_name"] == "pre_check")
        names = [f["name"] for f in pre_check_entry["fields"]]
        assert "checkup" not in names

    def test_array_field_with_no_name_in_item_falls_through(self):
        """`is_array` requires an `$ref` on the array items; bare arrays
        of primitives (no $ref) are skipped so the renderer can ignore
        them without special-casing."""
        schema = self._schema()
        detail_extension = schema["definitions"]["pre_check"]["allOf"][1]
        detail_extension["properties"]["raw_tags"] = {
            "type": "array",
            "items": {"type": "string"},
        }
        parent_def = schema["definitions"]["__checkup"]
        rels = get_flatten_rels("checkup", parent_def, schema)
        pre_check_entry = next(r for r in rels if r["prop_name"] == "pre_check")
        names = [f["name"] for f in pre_check_entry["fields"]]
        assert "raw_tags" not in names

    def test_scalar_and_array_fields_coexist(self):
        """Sanity check: a single flatten entry can carry both a scalar
        field (ams_score) and an array field (symptoms) — the renderers
        downstream pick the right widget based on `is_array`."""
        schema = self._schema()
        parent_def = schema["definitions"]["__checkup"]
        rels = get_flatten_rels("checkup", parent_def, schema)
        pre_check_entry = next(r for r in rels if r["prop_name"] == "pre_check")
        by_name = {f["name"]: f for f in pre_check_entry["fields"]}
        assert "ams_score" in by_name
        assert "symptoms" in by_name
        assert by_name["ams_score"].get("is_array") is not True
        assert by_name["symptoms"].get("is_array") is True

    def test_target_field_is_bare_view_name(self):
        """The `target` on the flatten entry is the bare view entity name
        — downstream code uses it as the TypeScript type label
        (PreCheckDetail via pascal_case) and the module path
        (lib/pre_check/types) alike, since Stage4 retired the `_detail`
        suffix that used to distinguish the two."""
        schema = self._schema()
        parent_def = schema["definitions"]["__checkup"]
        rels = get_flatten_rels("checkup", parent_def, schema)
        pre_check_entry = next(r for r in rels if r["prop_name"] == "pre_check")
        assert pre_check_entry["target"] == "pre_check"


# ---------------------------------------------------------------------------
# derive_searchable_relation_fields (cmd_552: labelField-derived, searchField retired)
# ---------------------------------------------------------------------------

class TestDeriveSearchableRelationFields:
    def _schema(self, extra_definitions=None):
        definitions = {
            "purchase_order": {"properties": {"po_number": {"type": "string"}}},
            "item": {"properties": {"sku": {"type": "string"}}},
            "asn": {"properties": {"asn_number": {"type": "string"}}},
            "goods_receipt": {"properties": {"receipt_number": {"type": "string"}}},
            "destination_bin": {"properties": {"code": {"type": "string"}}},
            "purchase_order_line": {
                "properties": {
                    "id": {"type": "string", "pattern": "^c[a-z0-9]{24,}$"},
                }
            },
            "purchase_order_status": {
                "properties": {
                    "status": {
                        "type": "string",
                        "enum": ["draft", "approved"],
                    }
                }
            },
            "supplier": {
                "properties": {
                    "founded_on": {"type": "string", "format": "date"},
                    "employee_count": {"type": "integer"},
                    "approver_role": {
                        "type": "string",
                        "x-relationship": {"type": "many-to-one", "target": "role"},
                    },
                }
            },
        }
        if extra_definitions:
            definitions.update(extra_definitions)
        return {"definitions": definitions}

    def test_reproduces_proj_g_goods_receipt_line_cases(self):
        """cmd_552 zero-loss requirement: the 5 FK+labelField pairs that used
        to also carry an explicit (identical) searchField must still resolve
        to the same {relation, field} once searchField is gone."""
        schema = self._schema()
        properties = {
            "purchase_order_id": {
                "type": "string",
                "x-relationship": {"type": "many-to-one", "target": "purchase_order", "labelField": "po_number"},
            },
            "item_id": {
                "type": "string",
                "x-relationship": {"type": "many-to-one", "target": "item", "labelField": "sku"},
            },
            "goods_receipt_id": {
                "type": "string",
                "x-relationship": {"type": "many-to-one", "target": "goods_receipt", "labelField": "receipt_number"},
            },
            "destination_bin_id": {
                "type": "string",
                "x-relationship": {"type": "many-to-one", "target": "destination_bin", "labelField": "code"},
            },
        }
        result = derive_searchable_relation_fields(properties, schema)
        assert {"relation": "purchase_order", "field": "po_number"} in result
        assert {"relation": "item", "field": "sku"} in result
        assert {"relation": "goods_receipt", "field": "receipt_number"} in result
        assert {"relation": "destination_bin", "field": "code"} in result
        assert len(result) == 4

    def test_reproduces_proj_g_asn_line_cases(self):
        schema = self._schema()
        properties = {
            "asn_id": {
                "type": "string",
                "x-relationship": {"type": "many-to-one", "target": "asn", "labelField": "asn_number"},
            },
            "item_id": {
                "type": "string",
                "x-relationship": {"type": "many-to-one", "target": "item", "labelField": "sku"},
            },
        }
        result = derive_searchable_relation_fields(properties, schema)
        assert result == [
            {"relation": "asn", "field": "asn_number"},
            {"relation": "item", "field": "sku"},
        ]

    def test_cuid_id_labelfield_excluded(self):
        """purchase_order_line_id.labelField: id — id matches the CUID
        pattern derive_text_fields already treats as non-searchable noise;
        an opaque identifier is not a meaningful substring-search target."""
        schema = self._schema()
        properties = {
            "purchase_order_line_id": {
                "type": "string",
                "x-relationship": {"type": "many-to-one", "target": "purchase_order_line", "labelField": "id"},
            },
        }
        assert derive_searchable_relation_fields(properties, schema) == []

    def test_enum_labelfield_excluded(self):
        """cmd_493-style trap: the screen shows the i18n-translated enum
        label, the DB stores the untranslated literal — a substring search
        against the raw value could never match what the user typed."""
        schema = self._schema()
        properties = {
            "status_id": {
                "type": "string",
                "x-relationship": {"type": "many-to-one", "target": "purchase_order_status", "labelField": "status"},
            },
        }
        assert derive_searchable_relation_fields(properties, schema) == []

    def test_date_labelfield_excluded(self):
        schema = self._schema()
        properties = {
            "supplier_id": {
                "type": "string",
                "x-relationship": {"type": "many-to-one", "target": "supplier", "labelField": "founded_on"},
            },
        }
        assert derive_searchable_relation_fields(properties, schema) == []

    def test_number_labelfield_excluded(self):
        schema = self._schema()
        properties = {
            "supplier_id": {
                "type": "string",
                "x-relationship": {"type": "many-to-one", "target": "supplier", "labelField": "employee_count"},
            },
        }
        assert derive_searchable_relation_fields(properties, schema) == []

    def test_dotted_labelfield_path_excluded(self):
        """One-hop only: getters.ts.jinja2 renders a single nested `where`
        level. A dotted labelField would need a second hop the template
        doesn't emit, so it's excluded rather than silently mis-rendered."""
        schema = self._schema()
        properties = {
            "supplier_id": {
                "type": "string",
                "x-relationship": {"type": "many-to-one", "target": "supplier", "labelField": "approver_role.name"},
            },
        }
        assert derive_searchable_relation_fields(properties, schema) == []

    def test_composite_labelfield_evaluated_per_element(self):
        """A composite labelField mixes a searchable element (sku) with a
        non-searchable one (employee_count) — only the qualifying element
        contributes an entry."""
        schema = self._schema()
        properties = {
            "item_id": {
                "type": "string",
                "x-relationship": {
                    "type": "many-to-one",
                    "target": "item",
                    "labelField": ["sku"],
                },
            },
            "supplier_id": {
                "type": "string",
                "x-relationship": {
                    "type": "many-to-one",
                    "target": "supplier",
                    "labelField": ["employee_count", "founded_on"],
                },
            },
        }
        result = derive_searchable_relation_fields(properties, schema)
        assert result == [{"relation": "item", "field": "sku"}]

    def test_no_labelfield_yields_no_entry(self):
        schema = self._schema()
        properties = {
            "purchase_order_id": {
                "type": "string",
                "x-relationship": {"type": "many-to-one", "target": "purchase_order"},
            },
        }
        assert derive_searchable_relation_fields(properties, schema) == []

    def test_no_x_relationship_skipped(self):
        schema = self._schema()
        properties = {"note": {"type": "string"}}
        assert derive_searchable_relation_fields(properties, schema) == []

    def test_searchfield_key_alone_no_longer_recognized(self):
        """searchField is retired — a schema that (incorrectly) still only
        declares searchField without labelField derives nothing; validate.py
        is what must catch and reject this case (see TestValidateSearchField
        in test_validate.py), not silent tolerance here."""
        schema = self._schema()
        properties = {
            "purchase_order_id": {
                "type": "string",
                "x-relationship": {"type": "many-to-one", "target": "purchase_order", "searchField": "po_number"},
            },
        }
        assert derive_searchable_relation_fields(properties, schema) == []

    def test_missing_target_definition_returns_empty_not_crash(self):
        schema = self._schema()
        properties = {
            "ghost_id": {
                "type": "string",
                "x-relationship": {"type": "many-to-one", "target": "nonexistent_entity", "labelField": "name"},
            },
        }
        assert derive_searchable_relation_fields(properties, schema) == []


# ---------------------------------------------------------------------------
# derive_cross_entity_searchable_fields (cmd_627: proj_g goods_receipt_line
# regression — inventory_id.labelField: [item.sku, location.code, ...]
# declared on goods_receipt_line only, never seen by
# derive_searchable_relation_fields(inventory's own properties, ...))
# ---------------------------------------------------------------------------

class TestDeriveCrossEntitySearchableFields:
    def test_reproduces_proj_g_inventory_location_code_case(self):
        """inventory's own location_id has no explicit labelField (defaults
        to 'name' elsewhere), but goods_receipt_line's inventory_id declares
        a composite labelField using location.code — a dotted path relative
        to goods_receipt_line but a plain one-hop field relative to
        inventory (location is inventory's own relation). Search for
        'inventory' must pick up location.code so the Cypress fixture's
        typed search text (built from goods_receipt_line's labelField) and
        the server's actual query stop disagreeing (cmd_627)."""
        schema = {
            "definitions": {
                "location": {
                    "properties": {
                        "code": {"type": "string"},
                        "name": {"type": "string"},
                    }
                },
                "item": {"properties": {"sku": {"type": "string"}}},
                "inventory": {
                    "properties": {
                        "item_id": {
                            "type": "string",
                            "x-relationship": {"type": "many-to-one", "target": "item", "labelField": "sku"},
                        },
                        "location_id": {
                            "type": "string",
                            "x-relationship": {"type": "many-to-one", "target": "location", "labelField": "name"},
                        },
                        "lot_number": {"type": "string"},
                    }
                },
                "goods_receipt_line": {
                    "properties": {
                        "inventory_id": {
                            "type": "string",
                            "x-relationship": {
                                "type": "many-to-one",
                                "target": "inventory",
                                "labelField": ["item.sku", "location.code", "lot_number", "expiration_date"],
                            },
                        },
                    }
                },
            }
        }
        result = derive_cross_entity_searchable_fields("inventory", schema)
        assert result == [
            {"relation": "item", "field": "sku"},
            {"relation": "location", "field": "code"},
        ]

    def test_reproduces_proj_g_approval_flow_self_ref_case(self):
        """approval_flow's preceded_by/followed_by (many-to-many, self-ref)
        declare labelField: [entity_name, approver_role.name] — a dotted
        path through approval_flow's own approver_role relation."""
        schema = {
            "definitions": {
                "role": {"properties": {"name": {"type": "string"}}},
                "approval_flow": {
                    "properties": {
                        "entity_name": {"type": "string"},
                        "approver_role_id": {
                            "type": "string",
                            "x-relationship": {"type": "many-to-one", "target": "role", "labelField": "name"},
                        },
                        "preceded_by": {
                            "type": "array",
                            "x-relationship": {
                                "type": "many-to-many",
                                "target": "approval_flow",
                                "labelField": ["entity_name", "approver_role.name"],
                            },
                        },
                    }
                },
            }
        }
        result = derive_cross_entity_searchable_fields("approval_flow", schema)
        assert result == [{"relation": "approver_role", "field": "name"}]

    def test_no_dotted_labelfield_yields_nothing_extra(self):
        """No referencing entity uses a dotted labelField segment through
        one of the target's own relations -> no additions (matches
        derive_searchable_relation_fields' existing coverage exactly)."""
        schema = {
            "definitions": {
                "item": {"properties": {"sku": {"type": "string"}}},
                "asn_line": {
                    "properties": {
                        "item_id": {
                            "type": "string",
                            "x-relationship": {"type": "many-to-one", "target": "item", "labelField": "sku"},
                        },
                    }
                },
            }
        }
        assert derive_cross_entity_searchable_fields("item", schema) == []

    def test_dotted_segment_prefix_not_a_known_relation_is_skipped(self):
        """A dotted labelField segment whose prefix doesn't match any of the
        target's own relation names can't be resolved one-hop from the
        target -- skipped rather than guessed at."""
        schema = {
            "definitions": {
                "unrelated": {"properties": {"name": {"type": "string"}}},
                "inventory": {"properties": {}},
                "goods_receipt_line": {
                    "properties": {
                        "inventory_id": {
                            "type": "string",
                            "x-relationship": {
                                "type": "many-to-one",
                                "target": "inventory",
                                "labelField": ["unrelated.name"],
                            },
                        },
                    }
                },
            }
        }
        assert derive_cross_entity_searchable_fields("inventory", schema) == []

    def test_non_string_final_segment_excluded(self):
        """Mirrors derive_searchable_relation_fields: a date/enum final
        field is excluded even when the relation-name prefix resolves."""
        schema = {
            "definitions": {
                "location": {"properties": {"opened_on": {"type": "string", "format": "date"}}},
                "inventory": {
                    "properties": {
                        "location_id": {
                            "type": "string",
                            "x-relationship": {"type": "many-to-one", "target": "location", "labelField": "opened_on"},
                        },
                    }
                },
                "goods_receipt_line": {
                    "properties": {
                        "inventory_id": {
                            "type": "string",
                            "x-relationship": {
                                "type": "many-to-one",
                                "target": "inventory",
                                "labelField": ["location.opened_on"],
                            },
                        },
                    }
                },
            }
        }
        assert derive_cross_entity_searchable_fields("inventory", schema) == []
