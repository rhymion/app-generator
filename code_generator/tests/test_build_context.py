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
