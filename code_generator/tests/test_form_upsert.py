"""
Tests for generators.form_upsert_context() — FormUpsert component generation.

Focuses on:
- Rule 1: mandatory FK list child → read-only (excluded from component params and grid)
- Rule 2: optional FK list child → autocomplete add/delete only (no edit)
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
        "definition_key": f"{model}_detail",
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
# Rule 1: Mandatory FK list child → read-only
# ---------------------------------------------------------------------------

class TestMandatoryFKListChild:
    """
    When a list child's FK to the parent is non-nullable (mandatory),
    it must not appear in the FormUpsert component at all — neither in
    the props signature nor as an EditableListWrapper.
    """

    def _schema(self) -> dict:
        return {
            "definitions": {
                "feature": {
                    "type": "object",
                    "required": ["id", "name"],
                    "properties": _base_props(),
                },
                "user_story": {
                    "type": "object",
                    "required": ["id", "name", "feature_id"],
                    "properties": {
                        **_base_props(),
                        "feature_id": _fk_field("feature", nullable=False),
                    },
                },
            }
        }

    def _ctx(self) -> dict:
        entity = _entity("feature", children=[
            _child_entry("user_story", "user_stories", output_type="list"),
        ])
        return _build_upsert_ctx(entity, self._schema())

    def test_mandatory_child_not_in_props_signature(self):
        ctx = self._ctx()
        # allUserStorys or allUserStories must NOT appear in the destructured params
        assert "allUserStory" not in ctx["form_upsert_params"]
        assert "allUserStories" not in ctx["form_upsert_params"]

    def test_mandatory_child_has_no_editable_list_wrapper(self):
        ctx = self._ctx()
        assert "EditableListWrapper" not in ctx["child_grid_components"] or \
               "userStories" not in ctx["child_grid_components"]

    def test_mandatory_child_excluded_from_form_data_handling(self):
        ctx = self._ctx()
        assert "userStory" not in ctx["child_form_data_handling"]


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
        assert "allBugs" in ctx["form_upsert_params"]

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
        assert "allRoles" in ctx["form_upsert_params"]

    def test_m2m_child_uses_autocomplete(self):
        ctx = self._ctx()
        assert 'itemType="autocomplete"' in ctx["child_grid_components"]

    def test_m2m_child_role_permissions_in_params(self):
        ctx = self._ctx()
        assert "rolePermissions" in ctx["form_upsert_params"]


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
            "definition_key": "resource_detail",
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
