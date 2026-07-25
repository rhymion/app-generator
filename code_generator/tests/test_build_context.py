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
# tried first, but the Lord found the real-world fallout on proj_c: those FK
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
# updated to incorporate this later (2026-07-19) Lord-ruled reversal from
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
# cmd_421 Batch3: CSV import of an entity with a required internal bridge FK
# (raised previously for inventory_movement's approvable_id — DP-B "確認"
# item). No entity-specific handling exists anywhere in build_context.py for
# this; the same generic _create_feasible gap-check (required field not in
# export_scalar_fields and not import-resolvable) already excludes bridge FKs
# because get_internal_bridge_fk_prop_names() is unioned into the export
# exclusion set. This test proves that generic mechanism actually produces
# the correct, safe outcome for import (CREATE gated off, UPDATE still
# available) rather than a broken route or a 500 at runtime — it is
# structural verification, not new behavior.
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

    def test_required_bridge_fk_gates_off_create_but_not_update(self):
        schema = self._schema()
        ctx = build_context(self._entity(), schema)
        assert ctx["import_eligible"] is True
        assert ctx["import_can_create"] is False, (
            "approvable_id is required but has no visible CSV source (bridge "
            "FK) — CREATE must be infeasible, matching the generic "
            "_create_feasible gap-check, not a broken/500-producing route"
        )
        assert ctx["import_can_update"] is True, (
            "UPDATE never needs to supply approvable_id, so it stays "
            "available even though CREATE is gated off"
        )


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
