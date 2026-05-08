"""
Tests for build_context.py — selection targets, embedded_ch filtering,
use_connect logic, and field categorisation.
"""
import pytest
from build_context import build_context, _get_selection_targets, _categorize_form_fields


# ---------------------------------------------------------------------------
# Minimal schema helpers (shared with other test modules)
# ---------------------------------------------------------------------------

def _base_props(extra: dict = None) -> dict:
    props = {"id": {"type": "string", "pattern": "^c[a-z0-9]{24,}$"}, "name": {"type": "string"}}
    props.update(extra or {})
    return props


def _fk_field(target: str, nullable: bool = False, label: str = "name") -> dict:
    t = ["string", "null"] if nullable else "string"
    return {
        "type": t,
        "pattern": "^c[a-z0-9]{24,}$",
        "x-relationship": {"type": "many-to-one", "target": target, "labelField": label},
    }


def _child_entry(name: str, prop: str, output_type: str = None, rel_type: str = None, rel_target: str = None) -> dict:
    """Build a child entry as extract_entities would produce it."""
    relationship = None
    if rel_type:
        relationship = {"type": rel_type, "target": rel_target or name}
    return {
        "name": name,
        "property_name": prop,
        "output_type": output_type,
        "file_type": None,
        "relationship": relationship,
    }


def _entity(model: str, children: list = None, gen_cfg: dict = None, parent: str = None) -> dict:
    return {
        "parent": parent or model,
        "model": model,
        "definition_key": f"{model}_detail",
        "children": children or [],
        "generate_config": gen_cfg or {
            "list": True, "view": True, "new": True, "edit": True,
            "delete": True, "api": False, "test": False, "fields": None,
        },
    }


# ---------------------------------------------------------------------------
# _get_selection_targets
# ---------------------------------------------------------------------------

class TestGetSelectionTargets:
    """Unit tests for the _get_selection_targets helper."""

    def _run(self, children_raw, parent_rels_raw, schema_defs, model="parent"):
        schema = {"definitions": schema_defs}
        return _get_selection_targets(children_raw, parent_rels_raw, schema, model)

    def test_m2m_child_included(self):
        children = [_child_entry("role", "roles", output_type="list",
                                  rel_type="many-to-many", rel_target="role")]
        targets = self._run(children, [], {"role": {}})
        assert "role" in targets

    def test_optional_fk_list_child_included(self):
        """Bug linked to feature via optional FK — should appear in selection targets."""
        bug_def = {
            "properties": {
                "feature_id": _fk_field("feature", nullable=True),
            }
        }
        children = [_child_entry("bug", "bugs", output_type="list")]
        targets = self._run(children, [], {"bug": bug_def}, model="feature")
        assert "bug" in targets

    def test_mandatory_fk_list_child_excluded(self):
        """Mandatory FK list child — never in selection_targets, regardless of own-page status."""
        feature_def = {
            "properties": {
                "epic_id": _fk_field("epic", nullable=False),
            }
        }
        children = [_child_entry("feature", "features", output_type="list")]
        targets = self._run(children, [], {"feature": feature_def}, model="epic")
        assert "feature" not in targets

    def test_non_independent_mandatory_fk_list_child_excluded(self):
        """Non-independent mandatory FK list child (no own page) also not in selection_targets."""
        tag_def = {
            "properties": {
                "parent1_id": _fk_field("parent1", nullable=False),
            }
        }
        children = [_child_entry("tag", "tags", output_type="list")]
        targets = self._run(children, [], {"tag": tag_def}, model="parent1")
        assert "tag" not in targets

    def test_many_to_one_parent_rel_included(self):
        from helpers.schema_helpers import get_parent_relationships
        epic_def = {"required": ["epic_id"], "properties": {"epic_id": _fk_field("epic")}}
        parent_rels = get_parent_relationships(epic_def)
        targets = self._run([], parent_rels, {"parent": epic_def})
        assert "epic" in targets

    def test_inline_child_with_own_rels_included(self):
        """Inline child (no output_type) whose def has a FK — the FK target should appear."""
        child_def = {
            "properties": {
                "organization_id": _fk_field("organization"),
            }
        }
        children = [_child_entry("inline_child", "items")]  # no output_type
        targets = self._run(children, [], {"inline_child": child_def}, model="parent")
        assert "organization" in targets

    def test_deduplication(self):
        """Same target appearing via m2m and parent rel should appear only once."""
        children = [_child_entry("role", "roles", output_type="list",
                                  rel_type="many-to-many", rel_target="role")]
        from helpers.schema_helpers import get_parent_relationships
        parent_def = {"properties": {"role_id": _fk_field("role")}}
        parent_rels = get_parent_relationships(parent_def)
        targets = self._run(children, parent_rels, {"role": {}})
        assert targets.count("role") == 1


# ---------------------------------------------------------------------------
# build_context — embedded_ch and use_connect
# ---------------------------------------------------------------------------

class TestEmbeddedChFiltering:
    """Tests that build_context correctly filters children into embedded_ch."""

    def _schema_with_children(self, bug_nullable: bool) -> tuple[dict, dict]:
        """Returns (entity dict, schema dict) for epic→feature (mandatory) + feature→bug (configurable)."""
        bug_feature_fk = _fk_field("feature", nullable=bug_nullable)
        feature_epic_fk = _fk_field("epic", nullable=False)

        schema = {
            "definitions": {
                "epic": {
                    "type": "object",
                    "required": ["id", "name"],
                    "properties": _base_props(),
                },
                "feature": {
                    "type": "object",
                    "required": ["id", "name", "epic_id"],
                    "properties": {**_base_props(), "epic_id": feature_epic_fk},
                },
                "bug": {
                    "type": "object",
                    "required": (["id", "name"] if bug_nullable else ["id", "name", "feature_id"]),
                    "properties": {**_base_props(), "feature_id": bug_feature_fk},
                },
                "feature_detail": {
                    "allOf": [
                        {"$ref": "#/definitions/feature"},
                        {"type": "object", "properties": {
                            "epic": {"$ref": "#/definitions/epic"},
                            "bugs": {
                                "type": "array",
                                "x-outputType": "list",
                                "items": {"$ref": "#/definitions/bug"},
                            },
                        }}
                    ]
                },
            }
        }

        entity = _entity(
            model="feature",
            children=[_child_entry("bug", "bugs", output_type="list")],
        )
        return entity, schema

    def _mandatory_fk_schema(self, child_name: str, parent_name: str,
                              with_own_page: bool) -> tuple[dict, dict]:
        """Return (entity, schema) for a parent with a mandatory-FK list child."""
        fk_prop = f"{parent_name}_id"
        child_def = {
            "type": "object",
            "required": ["id", "name", fk_prop],
            "properties": {**_base_props(), fk_prop: _fk_field(parent_name, nullable=False)},
        }
        defs = {
            parent_name: {"type": "object", "required": ["id", "name"], "properties": _base_props()},
            child_name: child_def,
        }
        if with_own_page:
            defs[f"{child_name}_detail"] = {
                "x-generate": {"list": True, "view": True, "new": True, "edit": True, "delete": True, "api": False, "test": False},
                "allOf": [{"$ref": f"#/definitions/{child_name}"}],
            }
        entity = _entity(
            model=parent_name,
            children=[_child_entry(child_name, f"{child_name}s", output_type="list")],
        )
        return entity, {"definitions": defs}

    def test_independent_mandatory_fk_list_child_excluded_from_embedded_ch(self):
        """Independent child (has own page) with mandatory FK → excluded from embedded_ch (read-only)."""
        entity, schema = self._mandatory_fk_schema("user_story", "feature", with_own_page=True)
        ctx = build_context(entity, schema)
        embedded = ctx["non_comment_ch"]
        assert all(c["name"] != "user_story" for c in embedded), \
            "Independent mandatory-FK list child should be excluded from embedded_ch (shown read-only)"

    def test_non_independent_mandatory_fk_list_child_included_in_embedded_ch(self):
        """Non-independent child (no own page) with mandatory FK → included in embedded_ch with use_connect=False."""
        entity, schema = self._mandatory_fk_schema("tag", "parent1", with_own_page=False)
        ctx = build_context(entity, schema)
        embedded = ctx["non_comment_ch"]
        tag_ch = next((c for c in embedded if c["name"] == "tag"), None)
        assert tag_ch is not None, \
            "Non-independent mandatory-FK list child should be in embedded_ch (full CRUD inline)"
        assert tag_ch["use_connect"] is False, \
            "Non-independent mandatory-FK list child should use inline create (use_connect=False)"
        assert tag_ch["is_independent"] is False

    def test_optional_fk_list_child_included_in_embedded_ch(self):
        """Feature's list of bugs (optional FK) must appear in embedded_ch with use_connect=True."""
        entity, schema = self._schema_with_children(bug_nullable=True)
        ctx = build_context(entity, schema)
        embedded = ctx["non_comment_ch"]
        bug_ch = next((c for c in embedded if c["name"] == "bug"), None)
        assert bug_ch is not None, "Optional FK list child should be in embedded_ch"
        assert bug_ch["use_connect"] is True

    def test_inline_child_always_in_embedded_ch(self):
        """An inline child (no output_type) is always in embedded_ch."""
        schema = {
            "definitions": {
                "parent": {"type": "object", "required": ["id"], "properties": {"id": {"type": "string"}}},
                "field": {"type": "object", "required": ["id"], "properties": {
                    "id": {"type": "string"},
                    "label": {"type": "string"},
                    "parent_id": {"type": "string", "pattern": "^c[a-z0-9]{24,}$"},
                }},
            }
        }
        entity = _entity(
            model="parent",
            children=[_child_entry("field", "fields")],  # no output_type
        )
        ctx = build_context(entity, schema)
        embedded = ctx["non_comment_ch"]
        field_ch = next((c for c in embedded if c["name"] == "field"), None)
        assert field_ch is not None
        assert field_ch["use_connect"] is False

    def test_m2m_child_in_embedded_ch_with_use_connect(self):
        """M2m child is in embedded_ch and use_connect=True."""
        schema = {
            "definitions": {
                "user_account": {"type": "object", "required": ["id", "name"], "properties": _base_props()},
                "role": {"type": "object", "required": ["id", "name"], "properties": _base_props()},
            }
        }
        entity = _entity(
            model="user_account",
            children=[_child_entry("role", "roles", output_type="list",
                                    rel_type="many-to-many", rel_target="role")],
        )
        ctx = build_context(entity, schema)
        embedded = ctx["non_comment_ch"]
        role_ch = next((c for c in embedded if c["name"] == "role"), None)
        assert role_ch is not None
        assert role_ch["use_connect"] is True


# ---------------------------------------------------------------------------
# _categorize_form_fields — component type based on field type
# ---------------------------------------------------------------------------

class TestCategorizeFormFields:
    """Tests that fields are assigned to the right form component category."""

    def _categorize(self, props: dict) -> dict:
        return _categorize_form_fields(props, parent_rels_raw=[], generate_config={})

    def test_plain_string_is_text(self):
        cats = self._categorize({"name": {"type": "string"}})
        assert "name" in cats["text"]

    def test_nullable_string_is_text(self):
        cats = self._categorize({"desc": {"type": ["string", "null"]}})
        assert "desc" in cats["text"]

    def test_date_time_format_is_date_time(self):
        cats = self._categorize({"start_time": {"type": "string", "format": "date-time"}})
        assert "start_time" in cats["date_time"]

    def test_date_format_is_date_time(self):
        cats = self._categorize({"due_date": {"type": "string", "format": "date"}})
        assert "due_date" in cats["date_time"]

    def test_time_format_is_date_time(self):
        cats = self._categorize({"open_time": {"type": "string", "format": "time"}})
        assert "open_time" in cats["date_time"]

    def test_integer_with_enum_is_enum_integer(self):
        cats = self._categorize({
            "status": {"type": "integer", "enum": ["Backlog", "Done"], "minimum": 0, "maximum": 1}
        })
        assert "status" in cats["enum_integer"]

    def test_integer_without_enum_is_number(self):
        cats = self._categorize({"quantity": {"type": "integer"}})
        assert "quantity" in cats["number"]

    def test_float_is_number(self):
        cats = self._categorize({"price": {"type": "number"}})
        assert "price" in cats["number"]

    def test_boolean_is_boolean(self):
        cats = self._categorize({"is_active": {"type": "boolean"}})
        assert "is_active" in cats["boolean"]

    def test_uri_format_is_image(self):
        cats = self._categorize({"photo": {"type": "string", "format": "uri"}})
        assert "photo" in cats["image"]

    def test_custom_component_removed_from_other_categories(self):
        cats = self._categorize({
            "password": {
                "type": "string",
                "x-custom-component": {"target": ["upsert"]},
            }
        })
        assert "password" in cats["custom_upsert"]
        assert "password" not in cats["text"]

    def test_system_fields_excluded(self):
        """id, created_at, updated_at, creator_id are always excluded from form categories."""
        cats = self._categorize({
            "id": {"type": "string"},
            "created_at": {"type": "string", "format": "date-time"},
            "updated_at": {"type": "string", "format": "date-time"},
            "creator_id": {"type": "string"},
            "name": {"type": "string"},
        })
        all_fields = set(sum(cats.values(), []))
        assert "id" not in all_fields
        assert "created_at" not in all_fields
        assert "updated_at" not in all_fields
        assert "creator_id" not in all_fields
        assert "name" in all_fields

    def test_fk_field_excluded_when_in_parent_rels(self):
        """FK fields (handled as Autocomplete via parent_rels) must not appear in text/number."""
        from helpers.schema_helpers import get_parent_relationships
        props = {
            "id": {"type": "string"},
            "name": {"type": "string"},
            "epic_id": _fk_field("epic"),
        }
        merged_def = {"properties": props}
        parent_rels_raw = get_parent_relationships(merged_def)
        cats = _categorize_form_fields(props, parent_rels_raw, {})
        all_fields = set(sum(cats.values(), []))
        assert "epic_id" not in all_fields


# ---------------------------------------------------------------------------
# build_context — selection_targets integration
# ---------------------------------------------------------------------------

class TestBuildContextSelectionTargets:
    def test_optional_fk_list_child_in_selection_targets(self):
        """Optional FK list child (bug→feature) must be in selection_targets for allBugs prop."""
        schema = {
            "definitions": {
                "feature": {"type": "object", "required": ["id", "name"], "properties": _base_props()},
                "bug": {
                    "type": "object",
                    "required": ["id", "name"],
                    "properties": {
                        **_base_props(),
                        "feature_id": _fk_field("feature", nullable=True),
                    },
                },
            }
        }
        entity = _entity(
            model="feature",
            children=[_child_entry("bug", "bugs", output_type="list")],
        )
        ctx = build_context(entity, schema)
        assert "bug" in ctx["selection_targets"]

    def test_mandatory_fk_list_child_not_in_selection_targets(self):
        """Mandatory FK list child must NOT be in selection_targets — regardless of whether
        it has its own page. Mandatory FK children use inline CRUD or are read-only,
        never autocomplete-based."""
        schema = {
            "definitions": {
                "epic": {"type": "object", "required": ["id", "name"], "properties": _base_props()},
                "feature": {
                    "type": "object",
                    "required": ["id", "name", "epic_id"],
                    "properties": {
                        **_base_props(),
                        "epic_id": _fk_field("epic", nullable=False),
                    },
                },
                # feature has its own page (independent) — still not in selection targets
                "feature_detail": {
                    "x-generate": {"list": True, "view": True, "new": True, "edit": True,
                                   "delete": True, "api": False, "test": False},
                    "allOf": [{"$ref": "#/definitions/feature"}],
                },
            }
        }
        entity = _entity(
            model="epic",
            children=[_child_entry("feature", "features", output_type="list")],
        )
        ctx = build_context(entity, schema)
        assert "feature" not in ctx["selection_targets"]

    def test_non_independent_mandatory_fk_list_child_not_in_selection_targets(self):
        """Non-independent mandatory-FK list child (no own page) also not in selection_targets.
        It uses inline CRUD, not autocomplete."""
        schema = {
            "definitions": {
                "parent1": {"type": "object", "required": ["id", "name"], "properties": _base_props()},
                "tag": {
                    "type": "object",
                    "required": ["id", "name", "parent1_id"],
                    "properties": {
                        **_base_props(),
                        "parent1_id": _fk_field("parent1", nullable=False),
                    },
                },
            }
        }
        entity = _entity(
            model="parent1",
            children=[_child_entry("tag", "tags", output_type="list")],
        )
        ctx = build_context(entity, schema)
        assert "tag" not in ctx["selection_targets"]

    def test_many_to_one_parent_rel_in_selection_targets(self):
        """A many-to-one FK on the entity itself (e.g. epic_id on feature) is in selection_targets."""
        schema = {
            "definitions": {
                "epic": {"type": "object", "required": ["id", "name"], "properties": _base_props()},
                "feature": {
                    "type": "object",
                    "required": ["id", "name", "epic_id"],
                    "properties": {
                        **_base_props(),
                        "epic_id": _fk_field("epic"),
                    },
                },
                "feature_detail": {
                    "allOf": [
                        {"$ref": "#/definitions/feature"},
                        {"type": "object", "properties": {"epic": {"$ref": "#/definitions/epic"}}},
                    ]
                },
            }
        }
        entity = {
            **_entity(model="feature"),
            "definition_key": "feature_detail",
        }
        ctx = build_context(entity, schema)
        assert "epic" in ctx["selection_targets"]
