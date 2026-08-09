"""
Tests for build_context.py — selection targets, embedded_ch filtering,
use_connect logic, and field categorisation.
"""
import pytest
from build_context import (
    build_context,
    _get_selection_targets,
    _categorize_form_fields,
    _build_form_data_gets,
    get_uri_kind,
)


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
        if with_own_page:
            # is_independent (build_context.py) checks x-generate directly on
            # the bare child entity — no separate `_detail` sibling (Stage 4,
            # cmd406-409 retired that convention).
            child_def["x-generate"] = {
                "list": True, "view": True, "new": True, "edit": True,
                "delete": True, "api": False, "test": False,
            }
        defs = {
            parent_name: {"type": "object", "required": ["id", "name"], "properties": _base_props()},
            child_name: child_def,
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
        assert "photo" not in cats.get("link_uri", [])

    def test_uri_format_explicit_image_kind(self):
        cats = self._categorize({"photo": {"type": "string", "format": "uri", "x-uri-kind": "image"}})
        assert "photo" in cats["image"]
        assert "photo" not in cats.get("link_uri", [])

    def test_uri_format_link_kind(self):
        cats = self._categorize({"url": {"type": "string", "format": "uri", "x-uri-kind": "link"}})
        assert "url" in cats["link_uri"]
        assert "url" not in cats["image"]

    def test_get_uri_kind_default_image(self):
        assert get_uri_kind({"type": "string", "format": "uri"}) == "image"

    def test_get_uri_kind_explicit_link(self):
        assert get_uri_kind({"type": "string", "format": "uri", "x-uri-kind": "link"}) == "link"

    def test_get_uri_kind_non_uri_returns_none(self):
        assert get_uri_kind({"type": "string"}) is None

    def test_get_uri_kind_invalid_raises(self):
        import pytest
        with pytest.raises(ValueError, match="x-uri-kind must be"):
            get_uri_kind({"type": "string", "format": "uri", "x-uri-kind": "foo"})

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

    def test_string_with_enum_is_string_enum(self):
        cats = self._categorize({
            "chart_type": {
                "type": "string",
                "enum": ["pie", "column", "bar", "line"],
                "default": "column",
            }
        })
        assert "chart_type" in cats["enum_string"]
        assert "chart_type" not in cats["text"]

    def test_string_without_enum_is_text(self):
        cats = self._categorize({"status": {"type": "string"}})
        assert "status" in cats["text"]
        assert "status" not in cats.get("enum_string", [])

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


# ---------------------------------------------------------------------------
# build_context — entity-level x-custom-components (plural, list of objects)
# ---------------------------------------------------------------------------

class TestEntityCustomComponents:
    """Entity-level `x-custom-components` is a list. Each item is split into
    `entity_custom_components` / `entity_view_components` / `entity_edit_components`
    by its `target`. Property-level `x-custom-component` (singular dict) is unrelated
    to this section and stays as-is."""

    def _schema(self, xcc_list):
        defs = {
            "thing": {"type": "object", "required": ["id"], "properties": _base_props()},
            "thing_detail": {"allOf": [{"$ref": "#/definitions/thing"}]},
        }
        if xcc_list is not None:
            defs["thing_detail"]["x-custom-components"] = xcc_list
        return {"definitions": defs}

    def test_multiple_components_split_by_target(self):
        """Three components on the entity, each with multiple targets — appear in
        every list their target names."""
        schema = self._schema([
            {"name": "AggregateScore", "path": "@/components/thing/aggregate_score",
             "target": ["view", "edit"]},
            {"name": "JudgeResult", "path": "@/components/thing/judge_result",
             "target": ["edit"]},
            {"name": "CreatePDF", "path": "@/components/thing/create_pdf",
             "target": ["view", "edit", "list"]},
        ])
        ctx = build_context(_entity("thing"), schema)
        view_names = [c["name"] for c in ctx["entity_view_components"]]
        edit_names = [c["name"] for c in ctx["entity_edit_components"]]
        list_names = [c["name"] for c in ctx["entity_custom_components"]]
        assert view_names == ["AggregateScore", "CreatePDF"]
        assert edit_names == ["AggregateScore", "JudgeResult", "CreatePDF"]
        assert list_names == ["CreatePDF"]

    def test_path_carried_through(self):
        """Explicit `path` is preserved; omitted `path` is None (template default)."""
        schema = self._schema([
            {"name": "WithPath", "path": "@/components/_standard/WithPath", "target": ["view"]},
            {"name": "NoPath", "target": ["view"]},
        ])
        ctx = build_context(_entity("thing"), schema)
        comps = {c["name"]: c["path"] for c in ctx["entity_view_components"]}
        assert comps["WithPath"] == "@/components/_standard/WithPath"
        assert comps["NoPath"] is None

    def test_default_target_is_list(self):
        """Omitting `target` defaults to `[list]` (backward compat with the singular form)."""
        schema = self._schema([{"name": "BarButton"}])
        ctx = build_context(_entity("thing"), schema)
        list_names = [c["name"] for c in ctx["entity_custom_components"]]
        assert list_names == ["BarButton"]
        assert ctx["entity_view_components"] == []
        assert ctx["entity_edit_components"] == []

    def test_missing_key_produces_empty_lists(self):
        """No `x-custom-components` on the entity → all three lists are empty."""
        schema = self._schema(None)
        ctx = build_context(_entity("thing"), schema)
        assert ctx["entity_custom_components"] == []
        assert ctx["entity_view_components"] == []
        assert ctx["entity_edit_components"] == []

    def test_non_list_value_raises(self):
        """A bare dict under the plural key is a schema error — we used to silently
        accept it, but now `x-custom-components` must be a list."""
        schema = self._schema(None)
        schema["definitions"]["thing_detail"]["x-custom-components"] = {
            "name": "Whoops", "target": ["view"],
        }
        with pytest.raises(ValueError, match="must be a list"):
            build_context(_entity("thing"), schema)

    def test_property_level_singular_key_still_works(self):
        """Property-level `x-custom-component` (singular dict) is independent of the
        entity-level rename and still routes the field into `custom_upsert`."""
        cats = _categorize_form_fields(
            {"password": {"type": "string", "x-custom-component": {"target": ["upsert"]}}},
            parent_rels_raw=[],
            generate_config={},
        )
        assert "password" in cats["custom_upsert"]
        assert "password" not in cats["text"]


# ---------------------------------------------------------------------------
# build_context — deep labelField prisma include merge (commit 7aab3c9)
# ---------------------------------------------------------------------------

class TestChildIncludeDeepLabelFieldMerge:
    """Tests for the deep labelField include merge added in commit 7aab3c9.

    When a parent entity declares a label_field on a child relation that walks
    deep nested relations (e.g. 'buyer.user.name'), build_context() merges the
    resulting Prisma include chain into the child's own include map so nested
    data is fetched server-side.
    """

    # Schema: Main → Item(child). Item FKs → Buyer → User/Org chain.
    SCHEMA = {
        "definitions": {
            "Main": {
                "type": "object",
                "required": ["id"],
                "properties": {
                    "id": {"type": "string"},
                    "name": {"type": "string"},
                },
            },
            "Item": {
                "type": "object",
                "required": ["id", "main_id"],
                "properties": {
                    "id": {"type": "string"},
                    "main_id": {
                        "type": "string",
                        "x-relationship": {"type": "many-to-one", "target": "Main"},
                    },
                    "buyer_id": {
                        "type": "string",
                        "x-relationship": {"type": "many-to-one", "target": "Buyer"},
                    },
                },
            },
            "Buyer": {
                "type": "object",
                "required": ["id"],
                "properties": {
                    "id": {"type": "string"},
                    "name": {"type": "string"},
                    "user_id": {
                        "type": "string",
                        "x-relationship": {"type": "many-to-one", "target": "User"},
                    },
                    "org_id": {
                        "type": "string",
                        "x-relationship": {"type": "many-to-one", "target": "Org"},
                    },
                },
            },
            "User": {
                "type": "object",
                "required": ["id"],
                "properties": {
                    "id": {"type": "string"},
                    "name": {"type": "string"},
                },
            },
            "Org": {
                "type": "object",
                "required": ["id"],
                "properties": {
                    "id": {"type": "string"},
                    "name": {"type": "string"},
                },
            },
        }
    }

    def _entity(self, label_field=None, label_field_key="label_field"):
        relationship = {"type": "one-to-many", "target": "Item"}
        if label_field is not None:
            relationship[label_field_key] = label_field
        return {
            "parent": "Main",
            "model": "Main",
            "definition_key": "Main_detail",
            "children": [
                {
                    "name": "Item",
                    "property_name": "items",
                    "output_type": None,
                    "file_type": None,
                    "relationship": relationship,
                }
            ],
            "generate_config": {
                "list": True, "view": True, "new": True, "edit": True,
                "delete": True, "api": False, "test": False, "fields": None,
            },
        }

    def _items_entry(self, ctx) -> str | None:
        return next((e for e in ctx["include_entries_detail"] if e.startswith("items:")), None)

    def test_no_label_field_uses_basic_child_includes(self):
        """Without label_field, child include uses only the child's own FK relations."""
        ctx = build_context(self._entity(), self.SCHEMA)
        entry = self._items_entry(ctx)
        assert entry is not None
        assert "main: true" in entry
        assert "buyer: true" in entry
        assert "buyer: { include:" not in entry  # no deep merge

    def test_label_field_name_only_is_skipped(self):
        """label_field='name' is the trivial case — deep merge is skipped."""
        ctx = build_context(self._entity(label_field="name"), self.SCHEMA)
        entry = self._items_entry(ctx)
        assert entry is not None
        assert "buyer: true" in entry
        assert "buyer: { include:" not in entry

    def test_deep_label_field_merges_nested_include(self):
        """label_field 'buyer.user.name' causes buyer→user to be merged into child includes."""
        ctx = build_context(self._entity(label_field="buyer.user.name"), self.SCHEMA)
        entry = self._items_entry(ctx)
        assert entry is not None
        assert "buyer: { include: { user: true } }" in entry
        assert "main: true" in entry  # child's other FK unaffected

    def test_existing_true_promoted_to_include_dict(self):
        """When child FK and label_field share the same root relation (buyer), the
        existing True in child_include_map gets promoted to {include: {user: true}}."""
        ctx = build_context(self._entity(label_field="buyer.user.name"), self.SCHEMA)
        entry = self._items_entry(ctx)
        assert "buyer: { include: { user: true } }" in entry
        assert "buyer: true" not in entry  # True was promoted; plain true must not remain

    def test_value_error_falls_back_to_basic_child_includes(self):
        """An invalid label_field path (ValueError from build_label_expression) is
        silently ignored — child include reverts to child's own FK relations."""
        ctx = build_context(
            self._entity(label_field="nonexistent.deep.path"),
            self.SCHEMA,
        )
        entry = self._items_entry(ctx)
        assert entry is not None
        assert "main: true" in entry
        assert "buyer: true" in entry
        assert "buyer: { include:" not in entry

    def test_camelcase_label_field_key_also_recognized(self):
        """labelField (camelCase) in the relationship dict is treated the same as label_field."""
        ctx = build_context(
            self._entity(label_field="buyer.user.name", label_field_key="labelField"),
            self.SCHEMA,
        )
        entry = self._items_entry(ctx)
        assert "buyer: { include: { user: true } }" in entry


def test_merge_into_child_inner_dict_merge():
    """Unit test: _merge_into_child inner-dict merge branch (elif path).

    This branch merges new keys into an already-dict ci[k]. Since child_include_map
    always starts with True values in build_context, this branch is tested here
    by replicating the function with a pre-seeded dict to verify the algorithm.
    """
    def _merge_into_child(ci, src):
        for k, v in src.items():
            if v is True:
                ci[k] = True
            else:
                include_val = v.get("include") if isinstance(v, dict) and "include" in v else v
                existing = ci.get(k)
                if existing is True or existing is None:
                    ci[k] = {"include": include_val}
                elif isinstance(existing, dict) and "include" in existing:
                    inner = existing["include"]
                    for kk, vv in (include_val.items() if isinstance(include_val, dict) else []):
                        if kk not in inner:
                            inner[kk] = vv
                        else:
                            if isinstance(inner[kk], dict) and isinstance(vv, dict):
                                inner[kk].setdefault("include", {}).update(vv.get("include", vv))

    # ci already has buyer as a dict (existing {include: {user: True}})
    ci = {"buyer": {"include": {"user": True}}, "main": True}
    # src adds org to buyer's inner include
    src = {"buyer": {"include": {"org": True}}}
    _merge_into_child(ci, src)

    assert ci["buyer"] == {"include": {"user": True, "org": True}}
    assert ci["main"] is True  # unrelated key untouched


# ---------------------------------------------------------------------------
# Virtual column detection tests
# ---------------------------------------------------------------------------

class TestVirtualColumns:
    """Virtual columns: fields in x-display.table but absent from properties."""

    def _make_schema(self, extra_props=None, table_cols=None):
        props = {"id": {"type": "string"}, "name": {"type": "string"}}
        props.update(extra_props or {})
        schema = {
            "definitions": {
                "parent1": {
                    "type": "object",
                    "properties": props,
                },
            }
        }
        if table_cols is not None:
            schema["definitions"]["parent1"]["x-display"] = {"table": table_cols}
        return schema

    def test_no_virtual_columns_when_all_props_present(self):
        """No virtual columns when all x-display.table fields exist in properties."""
        schema = self._make_schema(table_cols=[{"name": {"width": 150}}])
        entity = {
            "parent": "parent1", "model": "parent1",
            "definition_key": "parent1", "generate_config": {},
        }
        ctx = build_context(entity, schema)
        assert ctx["virtual_columns"] == []

    def test_relation_field_not_virtual(self):
        """A field whose _id counterpart exists in properties is a relation, not virtual."""
        schema = self._make_schema(
            extra_props={"role_id": {"type": "string"}},
            table_cols=[{"name": {"width": 150}}, {"role": {"width": 200}}],
        )
        entity = {
            "parent": "parent1", "model": "parent1",
            "definition_key": "parent1", "generate_config": {},
        }
        ctx = build_context(entity, schema)
        assert ctx["virtual_columns"] == []

    def test_virtual_column_detected_when_no_property_or_fk(self):
        """Fields in table with no matching property or {field}_id are virtual."""
        schema = self._make_schema(
            table_cols=[{"name": {"width": 150}}, {"extra_info": {"width": 200}}],
        )
        entity = {
            "parent": "parent1", "model": "parent1",
            "definition_key": "parent1", "generate_config": {},
        }
        ctx = build_context(entity, schema)
        assert len(ctx["virtual_columns"]) == 1
        vc = ctx["virtual_columns"][0]
        assert vc["field_name"] == "extra_info"
        assert vc["field_pascal"] == "ExtraInfo"

    def test_non_virtual_entities_unaffected(self):
        """Entities without x-display.table have empty virtual_columns."""
        schema = self._make_schema()  # no x-display
        entity = {
            "parent": "parent1", "model": "parent1",
            "definition_key": "parent1", "generate_config": {},
        }
        ctx = build_context(entity, schema)
        assert ctx["virtual_columns"] == []


# ---------------------------------------------------------------------------
# _write_stub — non-overwrite behaviour
# ---------------------------------------------------------------------------

import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from generate import _write_stub
from pathlib import Path


class TestVirtualResolverNonOverwrite:
    """generate.py _write_stub は既存ファイルを上書きしない。"""

    def test_write_stub_does_not_overwrite_existing(self, tmp_path):
        resolver_path = tmp_path / "virtual_resolvers.ts"
        resolver_path.write_text("export async function resolveVirtualColumns() { return new Map([['1', { additional_info: 'custom' }]]); }")
        original = resolver_path.read_text()
        _write_stub(resolver_path, "export async function resolveVirtualColumns(rows) { return new Map(); }")
        assert resolver_path.read_text() == original

    def test_write_stub_creates_new_file_when_absent(self, tmp_path):
        resolver_path = tmp_path / "virtual_resolvers.ts"
        content = "export async function resolveVirtualColumns(rows) { return new Map(); }"
        _write_stub(resolver_path, content)
        assert resolver_path.exists()
        assert resolver_path.read_text() == content

    def test_write_stub_self_heals_stale_pristine_stub(self, tmp_path, monkeypatch):
        """cmd_413b: a stub whose on-disk content matches a PAST pristine render
        (recorded in a prior manifest — e.g. the entity gained x-approval after its
        stub was already generated) is refreshed, not skipped forever. This is what
        unblocked leave_request's approval_request generation."""
        import generate as generate_module
        from manifest import ManifestRecorder

        out = tmp_path
        stub_path = out / "lib" / "leave_request" / "service_after_create.ts"
        stub_path.parent.mkdir(parents=True)
        old_render = "export async function afterCreate(_tx, _created, _data) {}"
        stub_path.write_text(old_render)

        # Simulate a prior run's manifest recording `old_render` as the pristine stub.
        first_manifest = ManifestRecorder(out=out)
        first_manifest.record(stub_path, old_render, 'stub')
        first_manifest.write(out, 'json_schema.yaml')

        # This run's schema now calls for the populated (approval-matching) body.
        new_render = "export async function afterCreate(tx, created, _data) { /* approval logic */ }"
        monkeypatch.setattr(generate_module, '_manifest', ManifestRecorder(out=out))
        generate_module._write_stub(stub_path, new_render)

        assert stub_path.read_text() == new_render

    def test_write_stub_preserves_genuine_hand_edit(self, tmp_path, monkeypatch):
        """A file whose content never matches any generator-produced render (i.e. a
        real hand customization) must never be overwritten, even across manifest
        runs — only *provably pristine, just-outdated* renders self-heal."""
        import generate as generate_module
        from manifest import ManifestRecorder

        out = tmp_path
        stub_path = out / "lib" / "leave_request" / "service_after_create.ts"
        stub_path.parent.mkdir(parents=True)
        hand_written = "export async function afterCreate(_tx, _created, _data) { /* my custom logic */ }"
        stub_path.write_text(hand_written)

        first_render = "export async function afterCreate(_tx, _created, _data) {}"
        first_manifest = ManifestRecorder(out=out)
        first_manifest.record(stub_path, first_render, 'stub')
        first_manifest.write(out, 'json_schema.yaml')

        new_render = "export async function afterCreate(tx, created, _data) { /* approval logic */ }"
        monkeypatch.setattr(generate_module, '_manifest', ManifestRecorder(out=out))
        generate_module._write_stub(stub_path, new_render)

        assert stub_path.read_text() == hand_written


# ---------------------------------------------------------------------------
# x_relationships_list — composite/dotted labelField join-display (cmd_382)
#
# Policy history: an isinstance(str) guard dropped composite/dotted labelField
# relations from x_relationships_list. Restoring that guard (policy (a)) was
# tried first, but real-world fallout was found on proj_c: those FK
# columns (e.g. inventory_movement.from_inventory_id/to_inventory_id, whose
# target's labelField is composite) are ALSO excluded from export_scalar_fields
# (FK columns aren't scalars) — so excluding them from x_relationships_list too
# means the column vanishes from CSV export entirely, silently. Policy (b)
# (final): every parent relation gets a CSV column; composite/dotted labelField
# segments are resolved and joined into one display string via the same
# helper (build_label_expression) already used for autocomplete/list labels.
#
# cmd_432 merge note: this policy supersedes cmd_351's exclusion guard
# (doreen/import branch only, 2026-07-17), which predates and was never
# updated to incorporate this later (2026-07-19) reversal from
# main. DP-2's display_col naming (next section) composes with this policy
# unchanged: composite/dotted relations fall back to a `_name`-suffixed
# display_col since no single field name exists to name it after.
# ---------------------------------------------------------------------------

class TestXRelationshipsListCompositeLabelField:
    """Composite (list) / dotted-path labelField FK relations must still reach
    x_relationships_list — as a joined human-readable display string — rather
    than silently vanishing from CSV export (the real proj_c incident)."""

    def _schema(self, movement_label):
        return {
            "definitions": {
                "product": {"type": "object", "properties": _base_props()},
                "location": {"type": "object", "properties": _base_props()},
                "inventory": {
                    "type": "object",
                    "properties": {
                        **_base_props(),
                        "product_id": _fk_field("product", label="name"),
                        "location_id": _fk_field("location", label="name"),
                        "lot_number": {"type": "string"},
                        "expiration_date": {"type": "string", "format": "date"},
                    },
                },
                "inventory_movement": {
                    "type": "object",
                    "properties": {
                        **_base_props(),
                        "from_inventory_id": _fk_field("inventory", label=movement_label),
                        "to_inventory_id": _fk_field("inventory", label=movement_label),
                    },
                },
            }
        }

    def test_composite_label_field_produces_joined_display_column(self):
        """The real proj_c case: composite labelField
        [product.name, location.name, lot_number, expiration_date] resolved
        from the FK's target ('inventory') must appear as a joined-string
        column — not be dropped from x_relationships_list."""
        schema = self._schema(["product.name", "location.name", "lot_number", "expiration_date"])
        ctx = build_context(_entity(model="inventory_movement"), schema)
        by_field = {r["field"]: r for r in ctx["x_relationships_list"]}
        assert "from_inventory" in by_field
        assert "to_inventory" in by_field
        expr = by_field["from_inventory"]["label_expr"]
        assert "row.from_inventory?.product?.name" in expr
        assert "row.from_inventory?.location?.name" in expr
        assert "row.from_inventory?.lot_number" in expr
        assert "formatLabelValue(row.from_inventory?.expiration_date, 'date')" in expr
        assert ctx["export_uses_format_label_value"] is True

    def test_simple_label_field_still_a_single_field_access(self):
        """Plain (non-dotted, string) labelField relations render a single
        optional-chained field access, not a multi-segment join."""
        schema = self._schema("name")
        ctx = build_context(_entity(model="inventory_movement"), schema)
        by_field = {r["field"]: r for r in ctx["x_relationships_list"]}
        assert by_field["from_inventory"]["label_expr"] == "(row.from_inventory?.name ?? '')"

    def test_dotted_string_label_field_also_included(self):
        """Dotted-path string labelField (single string, e.g. 'product.name')
        is no longer excluded either — same silent-drop failure mode as a
        list, just with one segment."""
        schema = self._schema("product.name")
        ctx = build_context(_entity(model="inventory_movement"), schema)
        by_field = {r["field"]: r for r in ctx["x_relationships_list"]}
        assert by_field["from_inventory"]["label_expr"] == "(row.from_inventory?.product?.name ?? '')"

    def test_unresolvable_label_field_path_falls_back_instead_of_dropping(self):
        """A labelField path that doesn't resolve (typo'd segment) must not
        silently drop the column either — it falls back to the target's own
        id/name rather than raising and disappearing."""
        schema = self._schema("nonexistent_field")
        ctx = build_context(_entity(model="inventory_movement"), schema)
        by_field = {r["field"]: r for r in ctx["x_relationships_list"]}
        assert "from_inventory" in by_field
        assert "row.from_inventory?.name" in by_field["from_inventory"]["label_expr"]


# ---------------------------------------------------------------------------
# DP-2a (cmd_394 §12): dotted x-import-key lookup_entity must resolve via
# x-relationship.target, not the dotted-key property prefix. Regression for
# the approval_flow.approver_role.name land mine (prisma.approver_role is
# undefined; the real model is 'role').
# ---------------------------------------------------------------------------

class TestImportKeySpecsAliasedFkLookup:
    """approval_flow has TWO FK properties (approver_role_id, requestor_role_id)
    that both target model 'role' under different property-name prefixes — the
    scenario that first exposed DP-2a (a single dotted key aliasing to 'role'
    coincidentally worked before this fix only when prefix==target)."""

    SCHEMA = {
        "definitions": {
            "role": {
                "type": "object",
                "required": ["id", "name"],
                "properties": {"id": _base_props()["id"], "name": {"type": "string"}},
            },
            "approval_flow": {
                "type": "object",
                "required": ["id", "entity_name", "approver_role_id", "requestor_role_id"],
                "x-import-key": ["entity_name", "approver_role.name", "requestor_role.name"],
                "properties": {
                    "id": _base_props()["id"],
                    "entity_name": {"type": "string"},
                    "approver_role_id": _fk_field("role", label="name"),
                    "requestor_role_id": _fk_field("role", label="name"),
                },
            },
        }
    }

    ENTITY = {
        "parent": "approval_flow",
        "model": "approval_flow",
        "definition_key": "approval_flow",
        "children": [],
        "generate_config": {
            "list": True, "view": True, "new": True, "edit": True,
            "delete": True, "api": True, "test": False, "fields": None,
        },
    }

    def _specs_by_raw(self):
        ctx = build_context(self.ENTITY, self.SCHEMA)
        return {s["raw"]: s for s in ctx["import_key_specs"] if s["is_dotted"]}

    def test_lookup_entity_resolves_to_relationship_target_not_prefix(self):
        specs = self._specs_by_raw()
        assert specs["approver_role.name"]["lookup_entity"] == "role", (
            "lookup_entity must come from x-relationship.target ('role'), "
            "not the dotted-key prefix ('approver_role') — prisma.approver_role "
            "does not exist and would crash at runtime"
        )
        assert specs["requestor_role.name"]["lookup_entity"] == "role"

    def test_result_col_and_csv_col_unaffected_by_fix(self):
        """Only lookup_entity changes — result_col/csv_col stay prefix-derived (correct already)."""
        specs = self._specs_by_raw()
        assert specs["approver_role.name"]["result_col"] == "approver_role_id"
        assert specs["approver_role.name"]["csv_col"] == "approver_role_name"
        assert specs["requestor_role.name"]["result_col"] == "requestor_role_id"
        assert specs["requestor_role.name"]["csv_col"] == "requestor_role_name"

    def test_var_prefix_stays_unique_when_lookup_entity_collides(self):
        """Two dotted keys resolving to the SAME lookup_entity ('role') must keep
        distinct var_prefix values, or the rendered template emits duplicate
        `const _role_rows` / `const _role_csv_val` declarations (TS build error)."""
        specs = self._specs_by_raw()
        assert specs["approver_role.name"]["lookup_entity"] == specs["requestor_role.name"]["lookup_entity"]
        assert specs["approver_role.name"]["var_prefix"] != specs["requestor_role.name"]["var_prefix"]
        assert specs["approver_role.name"]["var_prefix"] == "approver_role"
        assert specs["requestor_role.name"]["var_prefix"] == "requestor_role"

    def test_non_aliased_dotted_key_unaffected(self):
        """Non-regression: when the property prefix already matches the target
        (e.g. role.name on a plain role_id FK), lookup_entity is unchanged."""
        schema = {
            "definitions": {
                "role": self.SCHEMA["definitions"]["role"],
                "permission": {
                    "type": "object",
                    "required": ["id", "name", "role_id"],
                    "x-import-key": ["name", "role.name"],
                    "properties": {
                        "id": _base_props()["id"],
                        "name": {"type": "string"},
                        "role_id": _fk_field("role", label="name"),
                    },
                },
            }
        }
        entity = {
            "parent": "permission", "model": "permission", "definition_key": "permission",
            "children": [],
            "generate_config": {
                "list": True, "view": True, "new": True, "edit": True,
                "delete": True, "api": True, "test": False, "fields": None,
            },
        }
        ctx = build_context(entity, schema)
        spec = next(s for s in ctx["import_key_specs"] if s["raw"] == "role.name")
        assert spec["lookup_entity"] == "role"
        assert spec["var_prefix"] == "role"


# ---------------------------------------------------------------------------
# cmd_530: import_fk_specs generalizes dotted-FK CSV-import resolution from
# "x-import-key entries only" to "every screen-editable, simple-labelField
# FK relation" — closing the gap where a FK visible+editable on screen (e.g.
# proj_c's approval_flow.requestor_role) had zero import write path just
# because it wasn't declared as part of x-import-key (筋2). Modeled directly
# on proj_b's own (real) approval_flow entity: entity_name is the plain key,
# approver_role is a required dotted-FK, requestor_role is an optional
# screen-editable dotted-FK absent from x-import-key.
# ---------------------------------------------------------------------------

class TestImportFkSpecsScreenEditableGeneralization:
    def _schema(self, import_key=("entity_name", "approver_role.name")):
        return {
            "definitions": {
                "role": {
                    "type": "object",
                    "required": ["id", "name"],
                    "properties": {"id": _base_props()["id"], "name": {"type": "string"}},
                },
                "flow": {
                    "type": "object",
                    "required": ["id", "entity_name", "approver_role_id"],
                    "x-import-key": list(import_key),
                    "x-readonly-fields": ["readonly_role_id"],
                    "properties": {
                        "id": _base_props()["id"],
                        "entity_name": {"type": "string"},
                        "approver_role_id": _fk_field("role", label="name"),
                        "requestor_role_id": _fk_field("role", nullable=True, label="name"),
                        "readonly_role_id": _fk_field("role", nullable=True, label="name"),
                        "composite_role_id": _fk_field("role", nullable=True, label=["name", "id"]),
                    },
                },
            }
        }

    def _entity(self):
        return {
            "parent": "flow", "model": "flow", "definition_key": "flow",
            "children": [],
            "generate_config": {
                "list": True, "view": True, "new": True, "edit": True,
                "delete": True, "api": True, "test": False, "fields": None,
            },
        }

    def _specs_by_result_col(self, ctx):
        return {s["result_col"]: s for s in ctx["import_fk_specs"]}

    def test_key_fk_marked_is_key(self):
        ctx = build_context(self._entity(), self._schema())
        specs = self._specs_by_result_col(ctx)
        assert specs["approver_role_id"]["is_key"] is True

    def test_non_key_screen_editable_fk_now_importable(self):
        ctx = build_context(self._entity(), self._schema())
        specs = self._specs_by_result_col(ctx)
        assert "requestor_role_id" in specs, (
            "requestor_role is screen-editable (visible, not readonly) with a "
            "simple labelField — it must gain an import write path even "
            "though it's absent from x-import-key (筋2 fix)"
        )
        assert specs["requestor_role_id"]["is_key"] is False
        assert specs["requestor_role_id"]["lookup_entity"] == "role"
        assert specs["requestor_role_id"]["lookup_field"] == "name"
        assert specs["requestor_role_id"]["fk_nullable"] is True

    def test_readonly_fk_excluded_from_import_fk_specs(self):
        ctx = build_context(self._entity(), self._schema())
        specs = self._specs_by_result_col(ctx)
        assert "readonly_role_id" not in specs, (
            "x-readonly-fields marks this FK non-editable on screen — it "
            "must NOT gain a write path just because it's exported"
        )

    def test_composite_labelfield_fk_importable_via_full_label_match(self):
        """cmd_548 (option 甲): a composite/dotted labelField has no single
        lookup field, but it IS import-resolvable by matching the whole
        rendered label text against a pre-built label→id map — see
        subtask_547a design + is_composite/import_label_expr/prisma_include
        below."""
        ctx = build_context(self._entity(), self._schema())
        specs = self._specs_by_result_col(ctx)
        assert "composite_role_id" in specs
        spec = specs["composite_role_id"]
        assert spec["is_composite"] is True
        assert spec["is_dotted"] is False
        assert spec["is_key"] is False
        assert spec["csv_col"] == "composite_role_name"
        assert spec["import_label_expr"], "candidate-rooted label expression must be present"
        assert spec["lookup_entity"] == "role"
        assert isinstance(spec["prisma_include"], dict)

    def test_composite_labelfield_import_label_expr_rooted_at_candidate_var(self):
        """The import-side expression must be rooted at the candidate row
        variable ('c', matching the generated map-building loop var), NOT at
        'row.<relation>' like the export label_expr — they read the same
        underlying value through the identical helper/inputs, only the root
        variable differs (cmd_548 あ: export/import symmetry)."""
        ctx = build_context(self._entity(), self._schema())
        specs = self._specs_by_result_col(ctx)
        spec = specs["composite_role_id"]
        assert "c." in spec["import_label_expr"] or "c?." in spec["import_label_expr"]
        assert "row." not in spec["import_label_expr"]

    def test_unimportable_columns_lists_only_readonly_display_cols(self):
        """readonly stays unimportable; composite is now importable (cmd_548)
        so it must NOT appear in import_unimportable_columns any more."""
        ctx = build_context(self._entity(), self._schema())
        assert "readonly_role_name" in ctx["import_unimportable_columns"]
        assert "composite_role_name" not in ctx["import_unimportable_columns"]
        assert "requestor_role_name" not in ctx["import_unimportable_columns"]
        assert "approver_role_name" not in ctx["import_unimportable_columns"]

    def test_required_non_key_fk_makes_create_feasible(self):
        """筋2 companion: a REQUIRED FK that's screen-editable but not in
        x-import-key used to make CREATE entirely infeasible (proj_b's own
        pre-fix approval_flow: approver_role required + absent from
        x-import-key -> import_can_create False, every CSV-import row hit
        ENTITY_IMPORT_CREATE_NOT_SUPPORTED)."""
        schema = self._schema(import_key=("entity_name",))
        ctx = build_context(self._entity(), schema)
        specs = self._specs_by_result_col(ctx)
        assert specs["approver_role_id"]["is_key"] is False
        assert ctx["import_can_create"] is True, (
            "approver_role_id is required but now resolvable via the "
            "generalized import_fk_specs (screen-editable, simple label) "
            "even though it's not part of x-import-key"
        )


# ---------------------------------------------------------------------------
# cmd_521: dotted x-import-key lookup entities must be org-filtered when the
# LOOKUP entity itself has organization_id — independently of whether the
# lookup entity happens to also be the discriminant used for the PARENT
# model (should_filter_by_org). A dotted key into a system-global entity
# (e.g. role, no organization_id) must NOT be filtered, or every dotted
# lookup against it breaks (cmd_515's original gap + the trap it left).
# ---------------------------------------------------------------------------

class TestImportKeySpecsLookupEntityFilterByOrg:
    SCHEMA = {
        "definitions": {
            "organization": {
                "type": "object",
                "properties": {"id": _base_props()["id"], "name": {"type": "string"}},
            },
            "role": {
                "type": "object",
                "required": ["id", "name"],
                "properties": {"id": _base_props()["id"], "name": {"type": "string"}},
            },
            "department": {
                "type": "object",
                "required": ["id", "name", "organization_id"],
                "properties": {
                    "id": _base_props()["id"],
                    "name": {"type": "string"},
                    "organization_id": _fk_field("organization", label="name"),
                },
            },
            "ticket": {
                "type": "object",
                "required": ["id", "name", "organization_id"],
                "x-import-key": ["name", "role.name", "department.name"],
                "properties": {
                    "id": _base_props()["id"],
                    "name": {"type": "string"},
                    "organization_id": _fk_field("organization", label="name"),
                    "role_id": _fk_field("role", nullable=True, label="name"),
                    "department_id": _fk_field("department", nullable=True, label="name"),
                },
            },
        }
    }

    ENTITY = _entity(model="ticket")

    def _specs_by_raw(self):
        ctx = build_context(self.ENTITY, self.SCHEMA)
        return {s["raw"]: s for s in ctx["import_key_specs"] if s["is_dotted"]}

    def test_org_scoped_lookup_entity_is_filtered(self):
        """department has organization_id → its dotted lookup must be
        org-scoped, or a cross-org natural-key collision resolves to a
        foreign-org row (the cmd_521 leak)."""
        specs = self._specs_by_raw()
        assert specs["department.name"]["lookup_entity_filter_by_org"] is True

    def test_system_global_lookup_entity_is_not_filtered(self):
        """role has no organization_id → filtering it would return zero
        rows for every dotted role.* lookup (the trap cmd_521's design
        doc calls out — role is legitimately visible org-wide)."""
        specs = self._specs_by_raw()
        assert specs["role.name"]["lookup_entity_filter_by_org"] is False

    def test_any_dotted_fk_needs_org_filter_true_when_any_spec_needs_it(self):
        ctx = build_context(self.ENTITY, self.SCHEMA)
        assert ctx["any_dotted_fk_needs_org_filter"] is True

    def test_any_dotted_fk_needs_org_filter_false_when_no_lookup_entity_is_org_scoped(self):
        """Non-regression: a parent with only system-global dotted lookups
        (no org-scoped lookup entity in the mix) must not gain the
        _importOrgIds computation/import at all."""
        schema = {
            "definitions": {
                "role": self.SCHEMA["definitions"]["role"],
                "permission": {
                    "type": "object",
                    "required": ["id", "name"],
                    "x-import-key": ["name", "role.name"],
                    "properties": {
                        "id": _base_props()["id"],
                        "name": {"type": "string"},
                        "role_id": _fk_field("role", nullable=True, label="name"),
                    },
                },
            }
        }
        ctx = build_context(_entity(model="permission"), schema)
        assert ctx["any_dotted_fk_needs_org_filter"] is False

    def test_any_dotted_fk_needs_org_filter_true_for_non_key_fk_too(self):
        """cmd_530 P-3: import_fk_specs generalizes org-filter detection
        beyond x-import-key — a screen-editable NON-key FK into an
        org-scoped lookup entity must also trigger
        any_dotted_fk_needs_org_filter (and carry the same organization_id
        filter into its own resolution code), or cmd_521's org-isolation
        fix would only cover key FKs, silently reopening the cross-org leak
        for any non-key dotted FK newly made importable by this task."""
        schema = {
            "definitions": {
                "organization": self.SCHEMA["definitions"]["organization"],
                "department": self.SCHEMA["definitions"]["department"],
                "ticket": {
                    "type": "object",
                    "required": ["id", "name", "organization_id"],
                    "x-import-key": ["name"],
                    "properties": {
                        "id": _base_props()["id"],
                        "name": {"type": "string"},
                        "organization_id": _fk_field("organization", label="name"),
                        "department_id": _fk_field("department", nullable=True, label="name"),
                    },
                },
            }
        }
        ctx = build_context(_entity(model="ticket"), schema)
        specs = {s["result_col"]: s for s in ctx["import_fk_specs"]}
        assert specs["department_id"]["is_key"] is False
        assert specs["department_id"]["lookup_entity_filter_by_org"] is True
        assert ctx["any_dotted_fk_needs_org_filter"] is True

    def test_organization_and_user_lookup_targets_are_excluded_even_with_organization_id(self):
        """Same exclusion list as should_filter_by_org (cmd_515): a dotted
        key that resolves to 'organization' or 'user' is never filtered by
        this mechanism, even though both models plausibly have an id an
        org-filter could apply to — filtering 'organization' rows by
        organization_id would be nonsensical (self-referential), and
        'user' membership works differently (org roster, not row-owned)."""
        schema = {
            "definitions": {
                # Both 'organization' and 'user' are given their own
                # organization_id property here (semantically odd, but
                # deliberate) so this test isolates the name-based exclusion
                # itself — proving it fires independently of the has_org_id
                # check, not merely because these two happen to lack the
                # column in a more realistic schema.
                "organization": {
                    "type": "object",
                    "properties": {
                        "id": _base_props()["id"],
                        "name": {"type": "string"},
                        "organization_id": _fk_field("organization", nullable=True, label="name"),
                    },
                },
                "user": {
                    "type": "object",
                    "required": ["id", "name", "organization_id"],
                    "properties": {
                        "id": _base_props()["id"],
                        "name": {"type": "string"},
                        "organization_id": _fk_field("organization", label="name"),
                    },
                },
                "ticket": {
                    "type": "object",
                    "required": ["id", "name", "organization_id"],
                    "x-import-key": ["name", "organization.name", "user.name"],
                    "properties": {
                        "id": _base_props()["id"],
                        "name": {"type": "string"},
                        "organization_id": _fk_field("organization", label="name"),
                        "user_id": _fk_field("user", nullable=True, label="name"),
                    },
                },
            }
        }
        ctx = build_context(_entity(model="ticket"), schema)
        specs = {s["raw"]: s for s in ctx["import_key_specs"] if s["is_dotted"]}
        assert specs["organization.name"]["lookup_entity_filter_by_org"] is False
        assert specs["user.name"]["lookup_entity_filter_by_org"] is False


# ---------------------------------------------------------------------------
# cmd_548 (subtask_547a design, option ko): composite/dotted labelField FKs
# become importable via full-label-text matching. Org isolation must apply
# to the composite candidate-row map exactly like it does to the simple
# dotted-FK lookup above — an org-scoped lookup entity must be filtered, a
# system-global one must not.
# ---------------------------------------------------------------------------

class TestCompositeLabelFieldImportOrgFilter:
    SCHEMA = {
        "definitions": {
            "organization": {
                "type": "object",
                "properties": {"id": _base_props()["id"], "name": {"type": "string"}},
            },
            "product": {
                "type": "object",
                "required": ["id", "name"],
                "properties": {"id": _base_props()["id"], "name": {"type": "string"}},
            },
            "location": {
                "type": "object",
                "required": ["id", "name", "organization_id"],
                "properties": {
                    "id": _base_props()["id"],
                    "name": {"type": "string"},
                    "organization_id": _fk_field("organization", label="name"),
                },
            },
            "inventory": {
                "type": "object",
                "required": ["id", "product_id", "location_id", "organization_id"],
                "properties": {
                    "id": _base_props()["id"],
                    "product_id": _fk_field("product", label="name"),
                    "location_id": _fk_field("location", label="name"),
                    "organization_id": _fk_field("organization", label="name"),
                },
            },
            "inventory_movement": {
                "type": "object",
                "required": ["id", "name", "organization_id"],
                "x-import-key": ["name"],
                "properties": {
                    "id": _base_props()["id"],
                    "name": {"type": "string"},
                    "organization_id": _fk_field("organization", label="name"),
                    "from_inventory_id": _fk_field(
                        "inventory", nullable=True, label=["product.name", "location.name"],
                    ),
                },
            },
        }
    }

    ENTITY = _entity(model="inventory_movement")

    def _spec(self):
        ctx = build_context(self.ENTITY, self.SCHEMA)
        specs = {s["result_col"]: s for s in ctx["import_fk_specs"]}
        return ctx, specs["from_inventory_id"]

    def test_composite_fk_marked_is_composite(self):
        _, spec = self._spec()
        assert spec["is_composite"] is True
        assert spec["csv_col"] == "from_inventory_name"

    def test_composite_fk_lookup_entity_with_org_id_is_filtered(self):
        """inventory has organization_id -> the pre-built candidate map must
        be org-scoped, or a cross-org row's label could resolve the FK
        (the organization boundary failure mode cmd_548 guards against)."""
        _, spec = self._spec()
        assert spec["lookup_entity_filter_by_org"] is True

    def test_composite_fk_pulls_in_any_dotted_fk_needs_org_filter(self):
        ctx, _ = self._spec()
        assert ctx["any_dotted_fk_needs_org_filter"] is True

    def test_composite_fk_prisma_include_covers_nested_relations(self):
        """The candidate-row query needs product+location included to
        compute the label — this is the same prisma_include the export
        side already resolves via the identical helper call."""
        _, spec = self._spec()
        assert spec["prisma_include"].get("product") is True
        assert spec["prisma_include"].get("location") is True

    def test_composite_fk_not_in_unimportable_columns(self):
        ctx, _ = self._spec()
        assert "from_inventory_name" not in ctx["import_unimportable_columns"]

    def test_system_global_lookup_entity_composite_fk_not_org_filtered(self):
        """A composite-label FK into a system-global entity (no
        organization_id) must NOT be org-filtered — filtering it would
        return zero candidates for every row (same trap as cmd_521's
        dotted-FK case, generalized to the composite map)."""
        schema = {
            "definitions": {
                "permission_a": {
                    "type": "object",
                    "required": ["id", "code"],
                    "properties": {"id": _base_props()["id"], "code": {"type": "string"}},
                },
                "permission_b": {
                    "type": "object",
                    "required": ["id", "code"],
                    "properties": {"id": _base_props()["id"], "code": {"type": "string"}},
                },
                "role_bundle": {
                    "type": "object",
                    "required": ["id", "code"],
                    "properties": {
                        "id": _base_props()["id"],
                        "code": {"type": "string"},
                        "permission_a_id": _fk_field("permission_a", label="code"),
                        "permission_b_id": _fk_field("permission_b", label="code"),
                    },
                },
                "grant": {
                    "type": "object",
                    "required": ["id", "name"],
                    "x-import-key": ["name"],
                    "properties": {
                        "id": _base_props()["id"],
                        "name": {"type": "string"},
                        "role_bundle_id": _fk_field(
                            "role_bundle", nullable=True,
                            label=["permission_a.code", "permission_b.code"],
                        ),
                    },
                },
            }
        }
        ctx = build_context(_entity(model="grant"), schema)
        specs = {s["result_col"]: s for s in ctx["import_fk_specs"]}
        assert specs["role_bundle_id"]["is_composite"] is True
        assert specs["role_bundle_id"]["lookup_entity_filter_by_org"] is False


# ---------------------------------------------------------------------------
# cmd_621: a composite labelField whose path includes a date/time-formatted
# segment must flow has_format=True end to end — from build_label_expression()
# through x_relationships_list['import_has_format'], into the composite
# import_fk_specs entry's 'has_format', and up to the route-level
# import_uses_format_label_value flag consumed by api_import_route.ts.jinja2
# (see test_import_template_branches.py for the template-side half of this
# guard). Mirrors the real-world break: proj_g goods_receipt_line's labelField
# is [product.code, lot_number, expiration_date] where expiration_date is
# `type: string, format: date` — its generated import route referenced
# formatLabelValue with no import (PR#16, "Cannot find name 'formatLabelValue'").
# ---------------------------------------------------------------------------

class TestCompositeLabelFieldImportUsesFormatLabelValue:
    SCHEMA = {
        "definitions": {
            "product": {
                "type": "object",
                "required": ["id", "code"],
                "properties": {"id": _base_props()["id"], "code": {"type": "string"}},
            },
            "goods_receipt_line": {
                "type": "object",
                "required": ["id", "name", "expiration_date"],
                "x-import-key": ["name"],
                "properties": {
                    "id": _base_props()["id"],
                    "name": {"type": "string"},
                    "lot_number": {"type": "string"},
                    "expiration_date": {"type": "string", "format": "date"},
                    "product_id": _fk_field("product", label="code"),
                },
            },
            "purchase_order_line": {
                "type": "object",
                "required": ["id", "name"],
                "x-import-key": ["name"],
                "properties": {
                    "id": _base_props()["id"],
                    "name": {"type": "string"},
                    "goods_receipt_line_id": _fk_field(
                        "goods_receipt_line", nullable=True,
                        label=["product.code", "lot_number", "expiration_date"],
                    ),
                },
            },
        }
    }

    def _ctx(self):
        return build_context(_entity(model="purchase_order_line"), self.SCHEMA)

    def test_composite_spec_with_date_segment_marked_has_format(self):
        ctx = self._ctx()
        specs = {s["result_col"]: s for s in ctx["import_fk_specs"]}
        spec = specs["goods_receipt_line_id"]
        assert spec["is_composite"] is True
        assert spec["has_format"] is True

    def test_route_level_flag_set_when_any_composite_spec_has_format(self):
        ctx = self._ctx()
        assert ctx["import_uses_format_label_value"] is True

    def test_route_level_flag_false_when_no_composite_spec_needs_it(self):
        """Non-regression companion: TestCompositeLabelFieldImportOrgFilter's
        inventory_movement fixture (composite labelField, no date segment)
        must NOT set the route-level flag."""
        ctx = build_context(
            _entity(model="inventory_movement"),
            TestCompositeLabelFieldImportOrgFilter.SCHEMA,
        )
        assert ctx["import_uses_format_label_value"] is False


# ---------------------------------------------------------------------------
# DP-2 (cmd_394 §5, Option D): export display_col names the actual labelField
# instead of always assuming "_name". Zero-breaking-change on any schema where
# every FK labelField happens to be 'name' (true of every currently
# export-enabled entity, per cmd_394 §5 impact analysis).
# ---------------------------------------------------------------------------

class TestDP2ExportDisplayColNaming:
    SCHEMA = {
        "definitions": {
            "role": {
                "type": "object",
                "properties": {"id": _base_props()["id"], "name": {"type": "string"}},
            },
            "entity_b": {
                "type": "object",
                "properties": {"id": _base_props()["id"], "title": {"type": "string"}},
            },
            "widget": {
                "type": "object",
                "properties": {
                    "id": _base_props()["id"],
                    "role_id": _fk_field("role", label="name"),
                    "entity_b_id": _fk_field("entity_b", nullable=True, label="title"),
                },
            },
        }
    }
    ENTITY = _entity(model="widget")

    def _rel_by_field(self, ctx, field):
        return next(r for r in ctx["x_relationships_list"] if r["field"] == field)

    def test_name_label_field_unchanged(self):
        """labelField='name' → display_col stays '{relation}_name' (no-op case)."""
        ctx = build_context(self.ENTITY, self.SCHEMA)
        rel = self._rel_by_field(ctx, "role")
        assert rel["display_col"] == "role_name"

    def test_non_name_label_field_uses_actual_label(self):
        """labelField='title' → display_col is '{relation}_title', not '{relation}_name'."""
        ctx = build_context(self.ENTITY, self.SCHEMA)
        rel = self._rel_by_field(ctx, "entity_b")
        assert rel["display_col"] == "entity_b_title"

    def test_approval_flow_style_aliased_fk_display_col(self):
        """approval_flow-style aliased FK (prop prefix != target model, non-name
        labelField): display_col must be prefix-derived + labelField-derived,
        matching the dotted x-import-key csv_col so DP-1a visibility holds."""
        schema = {
            "definitions": {
                "role": self.SCHEMA["definitions"]["role"],
                "approval_flow": {
                    "type": "object",
                    "required": ["id", "entity_name", "approver_role_id"],
                    "x-import-key": ["entity_name", "approver_role.name"],
                    "properties": {
                        "id": _base_props()["id"],
                        "entity_name": {"type": "string"},
                        "approver_role_id": _fk_field("role", label="name"),
                    },
                },
            }
        }
        entity = {
            "parent": "approval_flow", "model": "approval_flow", "definition_key": "approval_flow",
            "children": [],
            "generate_config": {
                "list": True, "view": True, "new": True, "edit": True,
                "delete": True, "api": True, "test": False, "fields": None,
            },
        }
        ctx = build_context(entity, schema)
        rel = next(r for r in ctx["x_relationships_list"] if r["field"] == "approver_role")
        assert rel["display_col"] == "approver_role_name"
        spec = next(s for s in ctx["import_key_specs"] if s["raw"] == "approver_role.name")
        assert spec["csv_col"] == rel["display_col"], (
            "import csv_col and export display_col must agree — this is the "
            "invariant DP-1a's validate.py check enforces at the schema level"
        )


# ---------------------------------------------------------------------------
# DP-1 (cmd_394 §3, Option B): non-dotted x-import-key scalars are unioned
# into export_scalar_fields ONLY when already view-visible (x-generate.fields
# allowlist). Fields hidden from the view are NEVER unioned in — cmd_321/324
# security ruling (DQ-1=A) takes precedence.
# ---------------------------------------------------------------------------

class TestDP1ImportKeyUnion:
    def _schema(self, extra_prop_type="string"):
        return {
            "definitions": {
                "widget": {
                    "type": "object",
                    "required": ["id", "code"],
                    "x-import-key": ["code"],
                    "properties": {
                        "id": _base_props()["id"],
                        "code": {"type": extra_prop_type},
                        "secret": {"type": "string"},
                    },
                },
            }
        }

    def test_key_field_absent_from_restrictive_fields_allowlist_stays_out(self):
        """gen_cfg.fields restricts to ['secret'] only (code not view-visible) →
        DP-1 must NOT union 'code' into export_scalar_fields (DQ-1=A: view-visible
        wins over roundtrip convenience)."""
        schema = self._schema()
        entity = _entity(model="widget", gen_cfg={
            "list": True, "view": True, "new": True, "edit": True,
            "delete": True, "api": True, "test": False, "fields": ["secret"],
        })
        ctx = build_context(entity, schema)
        assert "code" not in ctx["export_scalar_fields"], (
            "an import key hidden from the view allowlist must never be unioned "
            "into export — DQ-1=A view-visible-wins ruling"
        )
        assert "code" not in ctx["export_import_key_fields"]

    def test_key_field_present_in_fields_allowlist_is_unioned(self):
        """gen_cfg.fields explicitly includes 'code' → union keeps it (this is
        already true of the base export_scalar_fields computation, but exercises
        the DP-1 union path directly and confirms export_import_key_fields agrees)."""
        schema = self._schema()
        entity = _entity(model="widget", gen_cfg={
            "list": True, "view": True, "new": True, "edit": True,
            "delete": True, "api": True, "test": False, "fields": ["code", "secret"],
        })
        ctx = build_context(entity, schema)
        assert "code" in ctx["export_scalar_fields"]
        assert "code" in ctx["export_import_key_fields"]

    def test_unrestricted_fields_allowlist_unions_key(self):
        """fields=None (unrestricted, falls back to all properties) → 'code' is
        already view-visible by default and appears in export."""
        schema = self._schema()
        entity = _entity(model="widget")  # default gen_cfg has fields=None
        ctx = build_context(entity, schema)
        assert "code" in ctx["export_scalar_fields"]
        assert "code" in ctx["export_import_key_fields"]


# ---------------------------------------------------------------------------
# DP-1b/1c (cmd_394 §10-11): CREATE feasibility only counts dotted-FK keys
# whose csv_col is an actually-exported display column (visible source).
# ---------------------------------------------------------------------------

class TestDP1cVisibleSourceOnlyCreateFeasibility:
    def _schema_with(self, label):
        return {
            "definitions": {
                "role": {
                    "type": "object",
                    "properties": {"id": _base_props()["id"], "name": {"type": "string"}},
                },
                "widget": {
                    "type": "object",
                    "required": ["id", "code", "role_id"],
                    "x-import-key": ["code", "role.name"],
                    "properties": {
                        "id": _base_props()["id"],
                        "code": {"type": "string"},
                        "role_id": _fk_field("role", label=label),
                    },
                },
            }
        }

    def _entity(self):
        return {
            "parent": "widget", "model": "widget", "definition_key": "widget",
            "children": [],
            "generate_config": {
                "list": True, "view": True, "new": True, "edit": True,
                "delete": True, "api": True, "test": False, "fields": None,
            },
        }

    def test_visible_dotted_source_counts_toward_create_feasibility(self):
        """role.name dotted key, role's own labelField='name' → csv_col
        'role_name' matches the exported display_col → CREATE feasible."""
        schema = self._schema_with(label="name")
        ctx = build_context(self._entity(), schema)
        assert ctx["import_can_create"] is True

    def test_invisible_dotted_source_does_not_count_toward_create_feasibility(self):
        """role's FK labelField ('id') diverges from the dotted key's field
        ('name') → display_col ('role_id') != csv_col ('role_name') → the
        source is invisible → CREATE must be gated off even though a
        structurally-shaped dotted key exists (DP-1a would reject this schema
        outright; this is the build_context.py defense-in-depth layer)."""
        schema = self._schema_with(label="id")
        ctx = build_context(self._entity(), schema)
        assert ctx["import_can_create"] is False


# ---------------------------------------------------------------------------
# cmd_421 Batch3 (corrected by cmd_609): CSV import of an entity with a
# required internal bridge FK (raised previously for inventory_movement's
# approvable_id — DP-B "to confirm" item).
#
# cmd_421's original comment here claimed get_internal_bridge_fk_prop_names()
# was already unioned into _create_feasible's gap-check, making CREATE
# correctly infeasible "structural verification, not new behavior". That
# claim was wrong: get_internal_bridge_fk_prop_names() was (and, for the
# export-column allowlist, still is) unioned only into the *export*
# exclusion set (_fk_prop_names, used to build export_scalar_fields) —
# _create_feasible's own gap-check never called it, so a required bridge FK
# was excluded from export_scalar_fields (correctly — it must never appear
# as a CSV column) but then NOT removed from the required-fields gap set,
# since subtracting export_scalar_fields only removes names that ARE in it.
# The net (undetected, since this test's own assertion baked the bug in as
# "expected") result was import_can_create=False for every entity with a
# required bridge FK — and when combined with edit:false (import_can_update
# also False), the entire import route collapsed to the
# ENTITY_IMPORT_NOT_SUPPORTED 400 stub (api_import_route.ts.jinja2:24), even
# though CREATE is genuinely fine: the service layer creates and wires the
# bridge row itself, it was never meant to come from the CSV.
#
# cmd_609 fixes this: _create_feasible now also subtracts
# get_internal_bridge_fk_prop_names(model_def, schema) directly, so a
# required bridge FK no longer counts as an unfillable gap. CREATE is
# feasible; this test now asserts the corrected (True) outcome.
# ---------------------------------------------------------------------------

class TestRequiredInternalBridgeFkImportFeasibility:
    def _schema(self):
        return {
            "definitions": {
                # Internal bridge target: zero true x-generate flags anywhere
                # across its variants → get_internal_bridge_fk_prop_names()
                # classifies any FK pointing at it as internal plumbing.
                "approvable": {
                    "type": "object",
                    "properties": {"id": _base_props()["id"]},
                },
                "widget": {
                    "type": "object",
                    "required": ["id", "code", "approvable_id"],
                    "x-import-key": ["code"],
                    "properties": {
                        "id": _base_props()["id"],
                        "code": {"type": "string"},
                        "approvable_id": {
                            "type": "string",
                            "pattern": "^c[a-z0-9]{24,}$",
                            "x-relationship": {
                                "type": "one-to-one_bridge",
                                "target": "approvable",
                                "labelField": "id",
                            },
                        },
                    },
                },
            }
        }

    def _entity(self):
        return {
            "parent": "widget", "model": "widget", "definition_key": "widget",
            "children": [],
            "generate_config": {
                "list": True, "view": True, "new": True, "edit": True,
                "delete": True, "api": True, "test": False, "fields": None,
            },
        }

    def test_bridge_fk_excluded_from_export_and_import_field_specs(self):
        schema = self._schema()
        ctx = build_context(self._entity(), schema)
        assert "approvable_id" not in ctx["export_scalar_fields"]
        assert all(spec["name"] != "approvable_id" for spec in ctx["import_field_specs"])

    def test_required_bridge_fk_does_not_gate_off_create(self):
        schema = self._schema()
        ctx = build_context(self._entity(), schema)
        assert ctx["import_eligible"] is True
        assert ctx["import_can_create"] is True, (
            "approvable_id is required but is server-managed plumbing (the "
            "service layer creates and wires it at CREATE time) — a required "
            "internal bridge FK must NOT count as an unfillable gap, or "
            "CREATE is wrongly gated off (cmd_609)"
        )
        assert ctx["import_can_update"] is True, (
            "UPDATE never needs to supply approvable_id either, so it stays "
            "available"
        )

    def test_required_bridge_fk_plus_edit_false_does_not_collapse_route(self):
        """The specific compound failure cmd_609 fixes: x-generate.edit=false
        (import_can_update=False structurally) combined with the pre-fix
        _create_feasible bug (import_can_create wrongly False) made
        api_import_route.ts.jinja2:24's `{% if not import_can_create and not
        import_can_update %}` collapse the entire route to the
        ENTITY_IMPORT_NOT_SUPPORTED 400 stub. With the fix, import_can_create
        is True even though edit is false, so the route stays live."""
        schema = self._schema()
        entity = self._entity()
        entity["generate_config"]["edit"] = False
        ctx = build_context(entity, schema)
        assert ctx["import_can_update"] is False
        assert ctx["import_can_create"] is True
        route_collapses_to_400_stub = (
            not ctx["import_can_create"] and not ctx["import_can_update"]
        )
        assert route_collapses_to_400_stub is False


class TestFormDataGetsPrismaNativeEnum:
    """cmd_446 pilot: a Prisma nativeEnum-backed field (schema_deriver's
    `_prisma_native_enum_type` marker) must cast the raw FormData string to
    its literal union in actions.ts, not plain `string` — the service layer
    parameter is now that narrower union."""

    def _prop_info(self, defn: dict) -> dict:
        return {"prop": "status", "var_name": "status", "def": defn}

    def test_native_enum_field_casts_to_literal_union(self):
        defn = {
            "type": "string",
            "enum": ["pending", "rejected"],
            "_prisma_native_enum_type": "InventoryMovementStatus",
        }
        result = _build_form_data_gets([self._prop_info(defn)])
        assert result == "  const status = data.get('status') as 'pending' | 'rejected';"

    def test_plain_string_field_unaffected(self):
        defn = {"type": "string"}
        result = _build_form_data_gets([self._prop_info(defn)])
        assert result == "  const status = data.get('status') as string;"

    def test_enum_without_native_marker_stays_plain_string(self):
        # A json-schema `enum:` constraint alone (no Prisma nativeEnum
        # backing) must not change codegen for other entities.
        defn = {"type": "string", "enum": ["pending", "rejected"]}
        result = _build_form_data_gets([self._prop_info(defn)])
        assert result == "  const status = data.get('status') as string;"


class TestDefaultPropsPrismaNativeEnum:
    """cmd_446 pilot: a Prisma nativeEnum-backed field's "new" page default
    must seed the schema's actual `default:` value (not '') and pin it with
    `as const` so TS doesn't widen it back to plain `string` in the object
    literal (would fail assignment to the union-typed FormUpsert `src` prop)."""

    def _schema(self, status_defn: dict) -> dict:
        return {
            "definitions": {
                "widget": {
                    "type": "object",
                    "required": ["id", "name"],
                    "properties": {**_base_props(), "status": status_defn},
                },
            }
        }

    def test_native_enum_default_uses_schema_default_as_const(self):
        status_defn = {
            "type": "string",
            "enum": ["pending", "rejected"],
            "default": "pending",
            "_prisma_native_enum_type": "WidgetStatus",
        }
        ctx = build_context(_entity("widget"), self._schema(status_defn))
        assert "status: 'pending' as const," in ctx["parent_default_props"]

    def test_plain_string_field_default_is_empty_string(self):
        ctx = build_context(_entity("widget"), self._schema({"type": "string"}))
        assert "status: '',"  in ctx["parent_default_props"]


class TestSelfOnlyContextFlags:
    """cmd_536: is_self_only / self_only_admin_bypass, as seen by templates
    via build_context()'s actual output — not just the schema_helpers
    function in isolation. The shorthand form's admin_bypass must default
    to False (the loose/permissive direction is never the implicit
    default) — verified end-to-end through build_context(), matching what
    getters.ts.jinja2 etc. actually receive."""

    def _schema(self, x_self_only) -> dict:
        defs = {
            "widget": {
                "type": "object",
                "required": ["id", "name"],
                "properties": {**_base_props(), "creator_id": {"type": "string"}},
            },
        }
        if x_self_only is not None:
            defs["widget"]["x-self-only"] = x_self_only
        return {"definitions": defs}

    def test_no_x_self_only_both_flags_false(self):
        ctx = build_context(_entity("widget"), self._schema(None))
        assert ctx["is_self_only"] is False
        assert ctx["self_only_admin_bypass"] is False

    def test_shorthand_true_is_self_only_but_admin_bypass_defaults_false(self):
        ctx = build_context(_entity("widget"), self._schema(True))
        assert ctx["is_self_only"] is True
        assert ctx["self_only_admin_bypass"] is False

    def test_dict_form_without_admin_bypass_key_defaults_false(self):
        ctx = build_context(_entity("widget"), self._schema({}))
        assert ctx["is_self_only"] is True
        assert ctx["self_only_admin_bypass"] is False

    def test_dict_form_admin_bypass_true_is_honored(self):
        ctx = build_context(_entity("widget"), self._schema({"admin_bypass": True}))
        assert ctx["is_self_only"] is True
        assert ctx["self_only_admin_bypass"] is True

    def test_dict_form_admin_bypass_false_explicit(self):
        ctx = build_context(_entity("widget"), self._schema({"admin_bypass": False}))
        assert ctx["is_self_only"] is True
        assert ctx["self_only_admin_bypass"] is False


# ---------------------------------------------------------------------------
# cmd_611/612: org_relationship_optional. An org-scoped model whose own
# `organization` relationship is OPTIONAL needs its read-scope filters to
# admit NULL rows too — `organization_id: { in: [...] }` never matches NULL
# in SQL, so without this an org-less row becomes invisible to every
# org-scoped actor, including its own creator, the moment organization
# stops being required. A required-org model must NOT get this OR-null
# branch (it would be meaningless dead code — organization_id is never null
# there).
# ---------------------------------------------------------------------------

class TestOrgRelationshipOptional:
    @staticmethod
    def _schema(organization_required: bool) -> dict:
        return {
            "definitions": {
                "organization": {
                    "type": "object",
                    "properties": {"id": _base_props()["id"], "name": {"type": "string"}},
                },
                "widget": {
                    "type": "object",
                    "required": ["id", "name"] + (["organization_id"] if organization_required else []),
                    "properties": {
                        "id": _base_props()["id"],
                        "name": {"type": "string"},
                        "organization_id": _fk_field("organization", nullable=not organization_required),
                    },
                },
            }
        }

    def test_flag_true_when_organization_optional(self):
        ctx = build_context(_entity("widget"), self._schema(organization_required=False))
        assert ctx["should_filter_by_org"] is True
        assert ctx["org_relationship_optional"] is True

    def test_flag_false_when_organization_required(self):
        ctx = build_context(_entity("widget"), self._schema(organization_required=True))
        assert ctx["should_filter_by_org"] is True
        assert ctx["org_relationship_optional"] is False

    def test_flag_false_when_no_organization_relationship_at_all(self):
        schema = {
            "definitions": {
                "widget": {
                    "type": "object",
                    "required": ["id", "name"],
                    "properties": {"id": _base_props()["id"], "name": {"type": "string"}},
                },
            }
        }
        ctx = build_context(_entity("widget"), schema)
        assert ctx["should_filter_by_org"] is False
        assert ctx["org_relationship_optional"] is False


class TestOrgRelationshipOptionalRenderedTemplates:
    """Deviation-injection coverage for the four templates patched to admit
    NULL-organization rows: getters.ts.jinja2 (list + detail),
    actions.ts.jinja2 (delete), api_detail_route.ts.jinja2 (PUT + DELETE),
    api_import_route.ts.jinja2 (import match-by-key)."""

    @staticmethod
    def _entity_ctx(organization_required: bool):
        schema = TestOrgRelationshipOptional._schema(organization_required)
        return build_context(_entity("widget"), schema)

    @staticmethod
    def _env():
        from generate import _make_env
        return _make_env()

    def test_getters_list_admits_null_when_optional(self):
        from generators import service_context
        ctx = self._entity_ctx(organization_required=False)
        full_ctx = {**ctx, **service_context(ctx, TestOrgRelationshipOptional._schema(False))}
        rendered = self._env().get_template('getters.ts.jinja2').render(**full_ctx)
        assert 'OR: [{ organization_id: { in: associatedOrganizationIds } }, { organization_id: null }]' in rendered

    def test_getters_list_stays_unfiltered_or_when_required(self):
        from generators import service_context
        ctx = self._entity_ctx(organization_required=True)
        full_ctx = {**ctx, **service_context(ctx, TestOrgRelationshipOptional._schema(True))}
        rendered = self._env().get_template('getters.ts.jinja2').render(**full_ctx)
        assert 'and.push({ organization_id: { in: associatedOrganizationIds } });' in rendered
        assert 'organization_id: null' not in rendered

    def test_api_detail_route_admits_null_when_optional(self):
        ctx = self._entity_ctx(organization_required=False)
        rendered = self._env().get_template('api_detail_route.ts.jinja2').render(**ctx)
        assert rendered.count('OR: [{ organization_id: { in: _assocOrgIds } }, { organization_id: null }]') == 2

    def test_api_detail_route_stays_unfiltered_or_when_required(self):
        ctx = self._entity_ctx(organization_required=True)
        rendered = self._env().get_template('api_detail_route.ts.jinja2').render(**ctx)
        assert 'organization_id: null' not in rendered


class TestOrgRelationshipOptionalAndScopingWithSelfOnly:
    """The org-null OR clause must stay scoped INSIDE the org condition --
    combined with a sibling creator_id/self-only restriction via AND, never
    flattened so the OR swallows the whole where clause and silently
    disables the creator/assignee scoping. Uses x-self-only (unconditional
    creator_id restriction, no permission setting can widen it) as the
    sharpest available probe: if the OR ever leaked out to cover the whole
    where object, this is the combination most likely to visibly break
    (every row would become reachable regardless of ownership)."""

    @staticmethod
    def _schema() -> dict:
        return {
            "definitions": {
                "organization": {
                    "type": "object",
                    "properties": {"id": _base_props()["id"], "name": {"type": "string"}},
                },
                "widget": {
                    "type": "object",
                    "required": ["id", "name"],
                    "x-self-only": True,
                    "x-import-key": ["name"],
                    "properties": {
                        "id": _base_props()["id"],
                        "name": {"type": "string"},
                        "creator_id": {"type": "string"},
                        "organization_id": _fk_field("organization", nullable=True),
                    },
                },
            }
        }

    def _ctx(self):
        return build_context(_entity("widget"), self._schema())

    def _env(self):
        from generate import _make_env
        return _make_env()

    def test_flags_combine_as_expected(self):
        ctx = self._ctx()
        assert ctx["should_filter_by_org"] is True
        assert ctx["org_relationship_optional"] is True
        assert ctx["is_self_only"] is True

    def test_getters_detail_creator_id_is_sibling_not_inside_or_array(self):
        """get{Parent}Detail's where object: `id`, `OR: [...]`, `creator_id`
        as three sibling keys -- Prisma ANDs sibling where-keys together, so
        this is the correct (safe) shape. The unsafe shape would be
        `creator_id` appearing INSIDE the `OR: [...]` array instead."""
        ctx = self._ctx()
        rendered = self._env().get_template('getters.ts.jinja2').render(**ctx)
        # Detail getter's where block: OR line followed later by creator_id
        # as a sibling property (self_only, no admin_bypass -> unconditional).
        assert 'OR: [{ organization_id: { in: associatedOrganizationIds } }, { organization_id: null }],' in rendered
        assert '      creator_id: userId,' in rendered
        # The unsafe shape: creator_id nested inside the OR array's brackets.
        assert 'organization_id: null } }, { creator_id' not in rendered

    def test_api_detail_route_put_creator_id_check_runs_after_org_scoped_fetch(self):
        """PUT: existing row is fetched scoped by the org OR, THEN a
        separate, unconditional creator_id check runs in application code
        (not inside the same Prisma where) -- org-optional visibility never
        substitutes for the ownership check."""
        ctx = self._ctx()
        rendered = self._env().get_template('api_detail_route.ts.jinja2').render(**ctx)
        assert 'OR: [{ organization_id: { in: _assocOrgIds } }, { organization_id: null }] }' in rendered
        assert 'if (existing.creator_id !== actorId) {' in rendered

    def test_actions_delete_creator_id_filter_runs_after_org_scoped_fetch(self):
        """Delete server action: rows are fetched scoped by the org OR
        (Prisma where), then filtered to the caller's own rows in
        application code (Array.filter) -- a completely separate step, not
        combined into the same Prisma where clause at all."""
        ctx = self._ctx()
        rendered = self._env().get_template('actions.ts.jinja2').render(**ctx)
        assert 'OR: [{ organization_id: { in: _assocOrgIds } }, { organization_id: null }] }' in rendered
        assert 'filter(item => item.creator_id === userId)' in rendered

    def test_api_import_route_matchwhere_creator_id_is_sibling_not_inside_or_array(self):
        """CSV import's _matchWhere (self_only + should_filter_by_org
        branch): `...keyWhere`, `OR: [...]`, `creator_id: actorId` as
        sibling object properties -- same safe AND-of-siblings shape as the
        detail getter, not creator_id folded into the OR array."""
        ctx = self._ctx()
        rendered = self._env().get_template('api_import_route.ts.jinja2').render(**ctx)
        assert (
            "OR: [{ organization_id: { in: _importOrgIds } }, { organization_id: null }], creator_id: actorId };"
            in rendered
        )
        assert 'organization_id: null } }, { creator_id' not in rendered

    def test_list_access_where_org_or_and_creator_assignee_or_are_separate_and_ed_array_elements(self):
        """Non-self-only case: build{Parent}AccessWhere pushes the org-null
        OR and a general/creator/assignee-restricted-permission OR as TWO
        SEPARATE elements of the `and` array, and every caller spreads that
        array into an explicit `AND: [...accessAnd, ...]` -- structurally
        distinct from (but equally safe as) the sibling-key-in-one-object
        shape the other templates use."""
        schema = {
            "definitions": {
                "organization": {
                    "type": "object",
                    "properties": {"id": _base_props()["id"], "name": {"type": "string"}},
                },
                "widget": {
                    "type": "object",
                    "required": ["id", "name"],
                    "x-import-key": ["name"],
                    "properties": {
                        "id": _base_props()["id"],
                        "name": {"type": "string"},
                        "organization_id": _fk_field("organization", nullable=True),
                    },
                },
            }
        }
        ctx = build_context(_entity("widget"), schema)
        from generators import service_context
        full_ctx = {**ctx, **service_context(ctx, schema)}
        rendered = self._env().get_template('getters.ts.jinja2').render(**full_ctx)
        assert "and.push({ OR: [{ organization_id: { in: associatedOrganizationIds } }, { organization_id: null }] });" in rendered
        assert "and.push({ OR: or });" in rendered
        assert "AND: [\n      ...accessAnd," in rendered
