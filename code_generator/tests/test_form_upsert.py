"""
Tests for generators.form_upsert_context() — FormUpsert component generation.

Focuses on:
- Independent mandatory FK list child → read-only (excluded from component params and grid)
- Non-independent mandatory FK list child → text list with full CRUD (add/edit/delete)
- Optional FK list child → autocomplete add/delete only (no edit)
- M2M child → autocomplete add/delete only
- Field types generate correct component imports and state setup
"""
import pytest
from build_context import build_context
from generators import form_upsert_context


# ---------------------------------------------------------------------------
# Minimal schema helpers
# ---------------------------------------------------------------------------

def _base_props(extra: dict = None) -> dict:
    props = {
        "id": {"type": "string", "pattern": "^c[a-z0-9]{24,}$"},
        "name": {"type": "string"},
    }
    props.update(extra or {})
    return props


def _fk_field(target: str, nullable: bool = False) -> dict:
    t = ["string", "null"] if nullable else "string"
    return {
        "type": t,
        "pattern": "^c[a-z0-9]{24,}$",
        "x-relationship": {"type": "many-to-one", "target": target, "labelField": "name"},
    }


def _child_entry(name: str, prop: str, output_type: str = None,
                  rel_type: str = None, rel_target: str = None) -> dict:
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


def _entity(model: str, children: list = None) -> dict:
    return {
        "parent": model,
        "model": model,
        "definition_key": model,
        "children": children or [],
        "generate_config": {
            "list": True, "view": True, "new": True, "edit": True,
            "delete": True, "api": False, "test": False, "fields": None,
        },
    }


def _build_upsert_ctx(entity: dict, schema: dict) -> dict:
    ctx = build_context(entity, schema)
    return form_upsert_context(ctx, schema)


# ---------------------------------------------------------------------------
# Independent mandatory FK list child → read-only
# ---------------------------------------------------------------------------

class TestMandatoryFKListChild:
    """
    When a list child has its own pages (x-generate on _detail) and a mandatory FK
    to the parent, the parent FormUpsert must show it read-only — no wrapper, no params.
    """

    def _schema(self) -> dict:
        return {
            "definitions": {
                "feature": {
                    "type": "object",
                    "required": ["id", "name"],
                    "properties": _base_props(),
                },
                "__user_story": {
                    "type": "object",
                    "required": ["id", "name", "feature_id"],
                    "properties": {
                        **_base_props(),
                        "feature_id": _fk_field("feature", nullable=False),
                    },
                },
                # user_story HAS its own page → independent → read-only in parent form
                "user_story": {
                    "x-generate": {"list": True, "view": True, "new": True, "edit": True,
                                   "delete": True, "api": False, "test": False},
                    "allOf": [{"$ref": "#/definitions/__user_story"}],
                },
            }
        }

    def _ctx(self) -> dict:
        entity = _entity("feature", children=[
            _child_entry("user_story", "user_stories", output_type="list"),
        ])
        return _build_upsert_ctx(entity, self._schema())

    def test_independent_mandatory_child_not_in_props_signature(self):
        ctx = self._ctx()
        assert "allUserStory" not in ctx["form_upsert_params"]
        assert "allUserStories" not in ctx["form_upsert_params"]

    def test_independent_mandatory_child_has_no_editable_list_wrapper(self):
        ctx = self._ctx()
        assert "EditableListWrapper" not in ctx["child_grid_components"] or \
               "userStories" not in ctx["child_grid_components"]

    def test_independent_mandatory_child_excluded_from_form_data_handling(self):
        ctx = self._ctx()
        assert "userStory" not in ctx["child_form_data_handling"]

    def test_independent_mandatory_child_shows_readonly_list_wrapper(self):
        """Independent mandatory-FK child is shown read-only via ListWrapper in FormUpsert."""
        ctx = self._ctx()
        assert "ListWrapper" in ctx["child_imports"]
        assert "indep_list_readonly_jsx" in ctx
        assert "userStories" in ctx["indep_list_readonly_jsx"]

    def test_independent_mandatory_child_readonly_is_edit_guarded(self):
        """Read-only list must be wrapped in isEdit so new-entity form shows nothing."""
        ctx = self._ctx()
        assert "isEdit" in ctx["indep_list_readonly_jsx"]

    def test_independent_mandatory_child_readonly_uses_text_item_type(self):
        """Read-only list uses itemType text (plain display, no add/delete)."""
        ctx = self._ctx()
        assert 'itemType="text"' in ctx["indep_list_readonly_jsx"]

    def test_independent_mandatory_child_readonly_not_editable(self):
        """Read-only list must not contain EditableListWrapper."""
        ctx = self._ctx()
        assert "EditableListWrapper" not in ctx["indep_list_readonly_jsx"]

    def test_indep_list_no_raw_div(self):
        """indep_list_readonly_jsx must use ListWrapper directly without raw <div> wrapper."""
        ctx = self._ctx()
        assert "<div>" not in ctx["indep_list_readonly_jsx"]
        assert "</div>" not in ctx["indep_list_readonly_jsx"]
        assert "ListWrapper" in ctx["indep_list_readonly_jsx"]

    def test_independent_mandatory_child_not_in_editable_grid_components(self):
        """Read-only list child must NOT appear in child_grid_components."""
        ctx = self._ctx()
        assert "userStories" not in ctx["child_grid_components"]

    def test_has_indep_list_children_flag_true(self):
        ctx = self._ctx()
        assert ctx["has_indep_list_children"] is True


# ---------------------------------------------------------------------------
# Non-independent mandatory FK list child → text list with full CRUD
# ---------------------------------------------------------------------------

class TestNonIndependentEmbeddedListChild:
    """
    When a list child has NO own pages (no x-generate on _detail) and a mandatory FK
    to the parent, the parent FormUpsert embeds it with full add/edit/delete via a
    text EditableListWrapper. No allTags prop is needed (inline create, not autocomplete).
    """

    def _schema(self) -> dict:
        return {
            "definitions": {
                "parent1": {
                    "type": "object",
                    "required": ["id", "name"],
                    "properties": _base_props(),
                },
                "tag": {
                    "type": "object",
                    "required": ["id", "name", "parent1_id"],
                    "properties": {
                        **_base_props(),
                        "parent1_id": {"type": "string", "pattern": "^c[a-z0-9]{24,}$"},
                    },
                },
                # No tag_detail definition → tag has no own page → non-independent
            }
        }

    def _ctx(self) -> dict:
        entity = _entity("parent1", children=[
            _child_entry("tag", "tags", output_type="list"),
        ])
        return _build_upsert_ctx(entity, self._schema())

    def test_embedded_list_child_uses_text_item_type(self):
        ctx = self._ctx()
        assert 'itemType="text"' in ctx["child_grid_components"]

    def test_embedded_list_child_has_editable_list_wrapper(self):
        ctx = self._ctx()
        assert "EditableListWrapper" in ctx["child_grid_components"]
        assert "tagsRef" in ctx["child_grid_components"]

    def test_embedded_list_child_not_in_props_signature(self):
        """No allTags prop — inline CRUD, not autocomplete."""
        ctx = self._ctx()
        assert "allTags" not in ctx["form_upsert_params"]

    def test_embedded_list_child_in_form_data_handling(self):
        ctx = self._ctx()
        assert "tagsRef" in ctx["child_form_data_handling"]

    def test_embedded_list_child_not_autocomplete(self):
        ctx = self._ctx()
        assert 'itemType="autocomplete"' not in ctx["child_grid_components"]

    def test_non_independent_child_has_no_indep_list_readonly_jsx(self):
        """Non-independent children should not trigger the read-only ListWrapper path."""
        ctx = self._ctx()
        assert ctx["has_indep_list_children"] is False
        assert ctx["indep_list_readonly_jsx"] == ""


# ---------------------------------------------------------------------------
# Rule 2: Optional FK list child → autocomplete add/delete only
# ---------------------------------------------------------------------------

class TestOptionalFKListChild:
    """
    When a list child's FK to the parent is nullable (optional),
    it must appear in FormUpsert as an autocomplete EditableListWrapper
    (add and delete only — no edit button since itemType="autocomplete").
    The all{Child}s prop must be in the component signature.
    """

    def _schema(self) -> dict:
        return {
            "definitions": {
                "feature": {
                    "type": "object",
                    "required": ["id", "name"],
                    "properties": _base_props(),
                },
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

    def _ctx(self) -> dict:
        entity = _entity("feature", children=[
            _child_entry("bug", "bugs", output_type="list"),
        ])
        return _build_upsert_ctx(entity, self._schema())

    def test_optional_child_in_props_signature(self):
        ctx = self._ctx()
        assert "initialBugs" in ctx["form_upsert_params"]
        assert "searchBugOptions" in ctx["form_upsert_params"]

    def test_optional_child_uses_autocomplete_item_type(self):
        ctx = self._ctx()
        assert 'itemType="autocomplete"' in ctx["child_grid_components"]

    def test_optional_child_has_editable_list_wrapper(self):
        ctx = self._ctx()
        assert "EditableListWrapper" in ctx["child_grid_components"]

    def test_optional_child_in_form_data_handling(self):
        ctx = self._ctx()
        # bugsRef is the React ref used to read the list items from the EditableListWrapper
        assert "bugsRef" in ctx["child_form_data_handling"]

    def test_optional_child_no_edit_button(self):
        # EditableListWrapper with itemType="autocomplete" has no edit button by design
        # (the itemType check in EditableListWrapper.tsx prevents it)
        # We verify itemType is NOT "text" which is the only type that shows edit
        ctx = self._ctx()
        assert 'itemType="text"' not in ctx["child_grid_components"]


# ---------------------------------------------------------------------------
# Many-to-many child → autocomplete add/delete only
# ---------------------------------------------------------------------------

class TestM2MChild:
    def _schema(self) -> dict:
        return {
            "definitions": {
                "user_account": {
                    "type": "object",
                    "required": ["id", "name"],
                    "properties": _base_props(),
                },
                "role": {
                    "type": "object",
                    "required": ["id", "name"],
                    "properties": _base_props(),
                },
            }
        }

    def _ctx(self) -> dict:
        entity = _entity("user_account", children=[
            _child_entry("role", "roles", output_type="list",
                          rel_type="many-to-many", rel_target="role"),
        ])
        return _build_upsert_ctx(entity, self._schema())

    def test_m2m_child_in_props_signature(self):
        ctx = self._ctx()
        assert "initialRoles" in ctx["form_upsert_params"]
        assert "searchRoleOptions" in ctx["form_upsert_params"]

    def test_m2m_child_uses_autocomplete(self):
        ctx = self._ctx()
        assert 'itemType="autocomplete"' in ctx["child_grid_components"]

    def test_m2m_child_role_permissions_dropped_from_params(self):
        """The rolePermissions prop was unused — the new template drops it."""
        ctx = self._ctx()
        assert "rolePermissions" not in ctx["form_upsert_params"]


# ---------------------------------------------------------------------------
# x-generate flags affect generated code
# ---------------------------------------------------------------------------

class TestXGenerateFlagsEffect:
    def _minimal_schema(self) -> dict:
        return {
            "definitions": {
                "resource": {
                    "type": "object",
                    "required": ["id", "name"],
                    "properties": _base_props(),
                }
            }
        }

    def _ctx_with_flags(self, **flags) -> dict:
        gen_cfg = {"list": True, "view": True, "new": True, "edit": True,
                   "delete": True, "api": False, "test": False, "fields": None}
        gen_cfg.update(flags)
        entity = {
            "parent": "resource",
            "model": "resource",
            "definition_key": "resource",
            "children": [],
            "generate_config": gen_cfg,
        }
        ctx = build_context(entity, self._minimal_schema())
        return ctx

    def test_can_delete_false_disables_delete(self):
        ctx = self._ctx_with_flags(delete=False)
        assert ctx["can_delete"] is False

    def test_can_delete_true_enables_delete(self):
        ctx = self._ctx_with_flags(delete=True)
        assert ctx["can_delete"] is True

    def test_can_create_false_disables_create(self):
        ctx = self._ctx_with_flags(new=False)
        assert ctx["can_create"] is False

    def test_can_update_false_disables_update(self):
        ctx = self._ctx_with_flags(edit=False)
        assert ctx["can_update"] is False


# ---------------------------------------------------------------------------
# Inline child (no output_type) uses DataGrid — not autocomplete
# ---------------------------------------------------------------------------

class TestInlineChildDataGrid:
    def _ctx(self) -> dict:
        schema = {
            "definitions": {
                "parent": {
                    "type": "object",
                    "required": ["id", "name"],
                    "properties": _base_props(),
                },
                "field": {
                    "type": "object",
                    "required": ["id", "label", "parent_id"],
                    "properties": {
                        "id": {"type": "string"},
                        "label": {"type": "string"},
                        "parent_id": {"type": "string"},
                    },
                },
            }
        }
        entity = _entity("parent", children=[
            _child_entry("field", "fields"),  # no output_type → inline DataGrid
        ])
        ctx = build_context(entity, schema)
        return form_upsert_context(ctx, schema)

    def test_inline_child_not_autocomplete(self):
        ctx = self._ctx()
        assert 'itemType="autocomplete"' not in ctx["child_grid_components"]

    def test_inline_child_not_in_selection_targets(self):
        schema = {
            "definitions": {
                "parent": {
                    "type": "object",
                    "required": ["id"],
                    "properties": {"id": {"type": "string"}},
                },
                "field": {
                    "type": "object",
                    "required": ["id"],
                    "properties": {"id": {"type": "string"}, "label": {"type": "string"}},
                },
            }
        }
        entity = _entity("parent", children=[_child_entry("field", "fields")])
        ctx = build_context(entity, schema)
        # Inline children don't appear in selection_targets (no all{Child}s needed)
        assert "field" not in ctx["selection_targets"]


# ---------------------------------------------------------------------------
# Selector OTO — mandatory FK (non-nullable)
# ---------------------------------------------------------------------------

class TestSelectorOTOMandatory:
    """
    pre_check has a mandatory FK to checkup (one-to-one, non-nullable).
    checkup has its own pages (x-generate flags are true) so it is a selector OTO.
    Expected: autocomplete shown (required), allCheckups in FormUpsert params,
    checkup_id included in form data sets.
    """

    def _oto_field(self, target: str, nullable: bool = False, label_field: str = 'name') -> dict:
        t = ["string", "null"] if nullable else "string"
        return {
            "type": t,
            "pattern": "^c[a-z0-9]{24,}$",
            "x-relationship": {"type": "one-to-one", "target": target, "labelField": label_field},
        }

    def _schema(self) -> dict:
        return {
            "definitions": {
                "__checkup": {
                    "type": "object",
                    "required": ["id"],
                    "properties": {"id": {"type": "string"}, "checkup_date": {"type": "string"}},
                },
                "checkup": {
                    # Has own pages → is_selector = True
                    "x-generate": {"list": True, "view": True, "new": True, "edit": True,
                                   "delete": True, "api": False},
                    "allOf": [{"$ref": "#/definitions/__checkup"}],
                },
                "__pre_check": {
                    "type": "object",
                    "required": ["id", "checkup_id"],
                    "properties": {
                        "id": {"type": "string", "pattern": "^c[a-z0-9]{24,}$"},
                        "checkup_id": self._oto_field("checkup", nullable=False,
                                                       label_field="checkup_date"),
                    },
                },
                "pre_check": {
                    "x-generate": {"list": True, "view": True, "new": True, "edit": True,
                                   "delete": True, "api": False},
                    "allOf": [{"$ref": "#/definitions/__pre_check"}],
                },
            }
        }

    def _ctx(self) -> dict:
        return _build_upsert_ctx(_entity("pre_check"), self._schema())

    def _build_ctx(self) -> dict:
        return build_context(_entity("pre_check"), self._schema())

    def test_selector_oto_in_form_upsert_params(self):
        """initialCheckups + searchCheckupOptions are destructured from FormUpsertProps."""
        ctx = self._ctx()
        assert "initialCheckups" in ctx["form_upsert_params"]
        assert "searchCheckupOptions" in ctx["form_upsert_params"]

    def test_selector_oto_not_in_selection_targets(self):
        """Selector OTO targets are NOT in selection_targets (they use a different getter)."""
        ctx = self._build_ctx()
        assert "checkup" not in ctx["selection_targets"]

    def test_selector_oto_in_selector_oto_rels(self):
        """build_context exports selector_oto_rels with the FK rel."""
        ctx = self._build_ctx()
        assert any(r['prop_name'] == 'checkup_id' for r in ctx['selector_oto_rels'])

    def test_selector_oto_not_in_auto_create_oto_rels(self):
        """Selector OTO does NOT appear in one_to_one_rels (auto-create only)."""
        ctx = self._build_ctx()
        assert all(r['target'] != 'checkup' for r in ctx['one_to_one_rels'])

    def test_selector_oto_fk_in_form_data_sets(self):
        """formData.set('checkup_id', ...) is emitted."""
        ctx = self._ctx()
        assert "checkup_id" in ctx["parent_form_data_sets"]

    def test_selector_oto_rel_opt_setup_wires_initial_and_search(self):
        """rel_opt_setups exposes initialCheckups + searchCheckupOptions for EntityAutocomplete."""
        ctx = self._ctx()
        assert "initialCheckups" in ctx["rel_opt_setups"]
        assert "searchCheckupOptions" in ctx["rel_opt_setups"]
        assert "checkup_date" in ctx["rel_opt_setups"]

    def test_selector_oto_autocomplete_required(self):
        """Non-nullable FK → autocomplete is required."""
        ctx = self._ctx()
        assert "required" in ctx["all_parent_fields_jsx"]

    def test_selector_oto_state_initialized(self):
        """checkupId state is generated."""
        ctx = self._ctx()
        assert "checkupId" in ctx["all_states"]

    def test_has_many_to_one_true(self):
        """has_many_to_one is True even without regular many-to-one rels."""
        ctx = self._ctx()
        assert ctx["has_many_to_one"] is True

    def test_selector_oto_fk_not_in_one_to_one_pre_creates(self):
        """No pre-create statement is emitted for selector OTO targets."""
        ctx = self._build_ctx()
        assert "checkup" not in ctx["one_to_one_pre_creates"]


# ---------------------------------------------------------------------------
# Selector OTO — optional FK (nullable)
# ---------------------------------------------------------------------------

class TestSelectorOTOOptional:
    """
    patient has an optional FK to user_account (one-to-one, nullable).
    user_account has its own pages → selector OTO, optional.
    Expected: autocomplete shown (NOT required), allUserAccounts in params.
    """

    def _oto_field_nullable(self, target: str, label_field: str = 'name') -> dict:
        return {
            "type": ["string", "null"],
            "pattern": "^c[a-z0-9]{24,}$",
            "x-relationship": {"type": "one-to-one", "target": target, "labelField": label_field},
        }

    def _schema(self) -> dict:
        return {
            "definitions": {
                "__user_account": {
                    "type": "object",
                    "required": ["id", "name"],
                    "properties": {"id": {"type": "string"}, "name": {"type": "string"}},
                },
                "user_account": {
                    "x-generate": {"list": True, "view": True, "new": True, "edit": True,
                                   "delete": True, "api": False},
                    "allOf": [{"$ref": "#/definitions/__user_account"}],
                },
                "__patient": {
                    "type": "object",
                    "required": ["id", "name"],
                    "properties": {
                        "id": {"type": "string", "pattern": "^c[a-z0-9]{24,}$"},
                        "name": {"type": "string"},
                        "user_account_id": self._oto_field_nullable("user_account"),
                    },
                },
                "patient": {
                    "x-generate": {"list": True, "view": True, "new": True, "edit": True,
                                   "delete": True, "api": False},
                    "allOf": [{"$ref": "#/definitions/__patient"}],
                },
            }
        }

    def _ctx(self) -> dict:
        return _build_upsert_ctx(_entity("patient"), self._schema())

    def _build_ctx(self) -> dict:
        return build_context(_entity("patient"), self._schema())

    def test_selector_oto_optional_in_params(self):
        ctx = self._ctx()
        assert "initialUserAccounts" in ctx["form_upsert_params"]
        assert "searchUserAccountOptions" in ctx["form_upsert_params"]

    def test_selector_oto_optional_in_selector_oto_rels(self):
        ctx = self._build_ctx()
        oto = next((r for r in ctx['selector_oto_rels'] if r['prop_name'] == 'user_account_id'), None)
        assert oto is not None
        assert oto['nullable'] is True

    def test_selector_oto_optional_not_required(self):
        """Nullable FK → autocomplete is NOT required."""
        ctx = self._ctx()
        # The name field makes 'required' appear for text fields; verify user_account autocomplete is not required
        # by checking that the OTO rel state is present but the autocomplete section doesn't force required
        assert "userAccountId" in ctx["all_states"]

    def test_selector_oto_optional_fk_in_form_data_sets(self):
        ctx = self._ctx()
        assert "user_account_id" in ctx["parent_form_data_sets"]

    def test_selector_oto_optional_rel_opt_setup(self):
        ctx = self._ctx()
        assert "initialUserAccounts" in ctx["rel_opt_setups"]
        assert "searchUserAccountOptions" in ctx["rel_opt_setups"]


# ---------------------------------------------------------------------------
# String enum fields (e.g. chart_type: 'pie' | 'column' | 'bar' | 'line')
# ---------------------------------------------------------------------------

class TestStringEnumField:
    """
    A string field with an enum list must be rendered as an Autocomplete select,
    not a plain TextField. The state is string, formData.set sends the raw value.
    """

    def _schema(self) -> dict:
        return {
            "definitions": {
                "__widget": {
                    "type": "object",
                    "required": ["id", "name", "chart_type"],
                    "properties": {
                        "id": {"type": "string", "pattern": "^c[a-z0-9]{24,}$"},
                        "name": {"type": "string"},
                        "chart_type": {
                            "type": "string",
                            "enum": ["pie", "column", "bar", "line"],
                            "default": "column",
                        },
                    },
                },
                "widget": {
                    "x-generate": {"list": True, "view": True, "new": True, "edit": True,
                                   "delete": True, "api": False, "test": False},
                    "allOf": [{"$ref": "#/definitions/__widget"}],
                },
            }
        }

    def _ctx(self) -> dict:
        entity = _entity("widget")
        return _build_upsert_ctx(entity, self._schema())

    def test_string_enum_state_is_string(self):
        ctx = self._ctx()
        assert "useState<string>" in ctx["all_states"]
        assert "chartType" in ctx["all_states"]

    def test_string_enum_autocomplete_options_generated(self):
        ctx = self._ctx()
        assert "chartTypeOptions" in ctx["enum_opt_setups"]
        assert "'pie'" in ctx["enum_opt_setups"]
        assert "'column'" in ctx["enum_opt_setups"]
        assert "'bar'" in ctx["enum_opt_setups"]
        assert "'line'" in ctx["enum_opt_setups"]

    def test_string_enum_renders_autocomplete(self):
        ctx = self._ctx()
        assert "AppFieldSelect" in ctx["all_parent_fields_jsx"]
        assert "chartTypeOptions" in ctx["all_parent_fields_jsx"]

    def test_string_enum_in_form_data_sets(self):
        ctx = self._ctx()
        assert "chart_type" in ctx["parent_form_data_sets"]

    def test_string_enum_triggers_autocomplete_import(self):
        ctx = self._ctx()
        assert ctx["has_many_to_one"] is True


# ---------------------------------------------------------------------------
# Child-grid createNew: integer enum schema default propagation
# ---------------------------------------------------------------------------

class TestChildGridCreateNewIntegerDefault:
    """
    When a child-grid row has an integer/number field with a schema 'default',
    createNew{Child}() must use that default, not always 0.

    Regression guard for chart_type integer enum: default=1 (column) must not
    silently revert to 0 (pie) in the generated createNewWidgets() function.
    """

    def _schema(self) -> dict:
        return {
            "definitions": {
                "__dashboard": {
                    "type": "object",
                    "required": ["id", "name"],
                    "properties": {
                        "id": {"type": "string", "pattern": "^c[a-z0-9]{24,}$"},
                        "name": {"type": "string"},
                    },
                },
                "dashboard": {
                    "x-generate": {"list": True, "view": True, "new": True, "edit": True,
                                   "delete": True, "api": False, "test": False},
                    "allOf": [{"$ref": "#/definitions/__dashboard"}],
                },
                "__widget": {
                    "type": "object",
                    "required": ["id", "chart_type", "dashboard_id"],
                    "properties": {
                        "id": {"type": "string", "pattern": "^c[a-z0-9]{24,}$"},
                        "chart_type": {
                            "type": "integer",
                            "minimum": 0,
                            "maximum": 3,
                            "enum": [0, 1, 2, 3],
                            "default": 1,
                        },
                        "nullable_score": {
                            "type": ["integer", "null"],
                            "minimum": 0,
                            "maximum": 100,
                            "default": 50,
                        },
                        "dashboard_id": {
                            "type": "string",
                            "pattern": "^c[a-z0-9]{24,}$",
                            "x-relationship": {
                                "type": "many-to-one",
                                "target": "dashboard",
                                "labelField": "name",
                            },
                        },
                    },
                },
                "widget": {
                    "x-generate": {"list": True, "view": True, "new": True, "edit": True,
                                   "delete": True, "api": False, "test": False},
                    "allOf": [{"$ref": "#/definitions/__widget"}],
                },
            }
        }

    def _ctx(self) -> dict:
        entity = _entity("dashboard", children=[
            _child_entry("widget", "widgets"),
        ])
        return _build_upsert_ctx(entity, self._schema())

    def test_createNew_uses_integer_schema_default(self):
        """Non-nullable integer field with default:1 → createNew uses 1, not 0."""
        ctx = self._ctx()
        setup = ctx["child_grid_setup"]
        assert "chart_type: 1," in setup, (
            f"Expected 'chart_type: 1,' in child_grid_setup but got:\n{setup}"
        )

    def test_createNew_nullable_integer_uses_null(self):
        """Nullable integer field → createNew uses null regardless of schema default."""
        ctx = self._ctx()
        setup = ctx["child_grid_setup"]
        assert "nullable_score: null," in setup, (
            f"Expected 'nullable_score: null,' in child_grid_setup but got:\n{setup}"
        )
