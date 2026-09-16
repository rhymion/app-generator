"""
Tests for x-readonly / x-readonly-fields support (app-generator-2 port).

Verifies:
  - build_context collects readonly_fields from x-readonly per-field.
  - build_context collects readonly_fields from x-readonly-fields entity-level.
  - Both sources merge correctly (union).
  - form_upsert_context: readonly fields render readOnly in edit mode ({isEdit && ...}).
  - form_upsert_context: readonly fields are omitted from normal editable JSX.
  - form_upsert_context: readonly fields are excluded from formData.set calls.
  - api_detail_route template: generates AP-3 check code when readonly_fields_api is set.
"""
import pytest
from build_context import build_context
from generators import column_def_context, form_upsert_context


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _schema_with_readonly(
    field_level_ro: list[str] | None = None,
    entity_level_ro: list[str] | None = None,
) -> dict:
    """Build minimal schema where 'status' can carry x-readonly flags."""
    props: dict = {
        "id": {"type": "string", "pattern": "^c[a-z0-9]{24,}$"},
        "name": {"type": "string"},
        "status": {"type": "integer", "minimum": 0, "maximum": 2, "enum": ["a", "b", "c"]},
        "note": {"type": ["string", "null"]},
    }
    if field_level_ro:
        for fn in field_level_ro:
            if fn in props:
                props[fn] = {**props[fn], "x-readonly": True}

    entity_def: dict = {"type": "object", "required": ["id", "name"], "properties": props}

    view_def: dict = {
        "x-generate": {
            "list": True, "view": True, "new": True, "edit": True,
            "delete": True, "api": True, "test": False, "fields": None,
        },
        "allOf": [{"$ref": "#/definitions/item"}],
    }
    # x-readonly-fields is view-scoped (cmd_874 subtask_874d): it lives on
    # the view entity (item_detail, the definition_key build_context reads),
    # not the shared raw entity (item) — see build_context.py's
    # _ro_from_entity.
    if entity_level_ro:
        view_def["x-readonly-fields"] = entity_level_ro

    return {
        "definitions": {
            "item": entity_def,
            "item_detail": view_def,
        }
    }


def _entity(model: str = "item") -> dict:
    return {
        "parent": model,
        "model": model,
        "definition_key": f"{model}_detail",
        "children": [],
        "generate_config": {
            "list": True, "view": True, "new": True, "edit": True,
            "delete": True, "api": True, "test": False, "fields": None,
        },
    }


# ---------------------------------------------------------------------------
# build_context: readonly_fields collection
# ---------------------------------------------------------------------------

class TestBuildContextReadonlyFields:
    def test_no_readonly_fields_gives_empty_list(self):
        schema = _schema_with_readonly()
        ctx = build_context(_entity(), schema)
        assert ctx["readonly_fields"] == []

    def test_field_level_x_readonly_collected(self):
        schema = _schema_with_readonly(field_level_ro=["status"])
        ctx = build_context(_entity(), schema)
        assert "status" in ctx["readonly_fields"]

    def test_entity_level_x_readonly_fields_collected(self):
        schema = _schema_with_readonly(entity_level_ro=["note"])
        ctx = build_context(_entity(), schema)
        assert "note" in ctx["readonly_fields"]

    def test_both_sources_merge(self):
        schema = _schema_with_readonly(field_level_ro=["status"], entity_level_ro=["note"])
        ctx = build_context(_entity(), schema)
        assert "status" in ctx["readonly_fields"]
        assert "note" in ctx["readonly_fields"]

    def test_readonly_fields_api_populated(self):
        schema = _schema_with_readonly(field_level_ro=["status"])
        ctx = build_context(_entity(), schema)
        assert "status" in ctx["readonly_fields_api"]
        assert ctx["readonly_fields_api_select"] is not None
        assert "status" in ctx["readonly_fields_api_select"]

    def test_no_readonly_fields_api_select_is_none(self):
        schema = _schema_with_readonly()
        ctx = build_context(_entity(), schema)
        assert ctx["readonly_fields_api_select"] is None
        assert ctx["readonly_fields_api"] == []

    def test_unresolved_entity_level_readonly_field_fails_closed(self):
        """An x-readonly-fields entry that doesn't match a real property (e.g.
        a relation name typo'd instead of the FK column) must raise, not
        silently render as fully editable (cmd_642)."""
        schema = _schema_with_readonly(entity_level_ro=["not_a_real_property"])
        with pytest.raises(ValueError, match="not_a_real_property"):
            build_context(_entity(), schema)

    def test_relation_name_instead_of_fk_column_fails_closed(self):
        """A relation name used without the '_id' suffix must raise: FK
        properties are always named '<relation>_id', so a bare relation name
        never resolves to an actual property."""
        schema = _schema_with_readonly()
        schema["definitions"]["item"]["properties"]["parent_id"] = {
            "type": "string", "pattern": "^c[a-z0-9]{24,}$",
        }
        schema["definitions"]["item_detail"]["x-readonly-fields"] = ["parent"]
        with pytest.raises(ValueError, match="parent"):
            build_context(_entity(), schema)

    def test_field_level_x_readonly_cannot_be_unresolved(self):
        """Field-level x-readonly is sourced directly from filtered_props, so
        it can never name a nonexistent property — no fail-closed check is
        needed on that path (sanity check the two sources are asymmetric by
        construction, not by omission)."""
        schema = _schema_with_readonly(field_level_ro=["status"])
        ctx = build_context(_entity(), schema)
        assert "status" in ctx["readonly_fields"]


# ---------------------------------------------------------------------------
# cmd_874 subtask_874d: x-readonly-fields is view-scoped, not raw/model-wide
# ---------------------------------------------------------------------------

class TestReadonlyFieldsCrossViewIsolation:
    """Two views sharing the same raw entity (the `setting` proxy view of
    `user`, in the real schema) must not leak an x-readonly-fields
    declaration between them. Regression coverage for the exact bug this
    task fixes: before it, build_context.py read x-readonly-fields from the
    shared raw entity, so a proxy view's declaration silently applied to
    every other view of the same Prisma model too."""

    def _schema(self) -> dict:
        return {
            "definitions": {
                "__item": {
                    "type": "object",
                    "required": ["id", "name"],
                    "properties": {
                        "id": {"type": "string", "pattern": "^c[a-z0-9]{24,}$"},
                        "name": {"type": "string"},
                    },
                },
                "item_a": {
                    "x-generate": {
                        "list": True, "view": True, "new": True, "edit": True,
                        "delete": True, "api": True, "test": False, "fields": None,
                    },
                    "x-readonly-fields": ["name"],
                    "allOf": [{"$ref": "#/definitions/__item"}],
                },
                "item_b": {
                    "x-generate": {
                        "list": True, "view": True, "new": True, "edit": True,
                        "delete": True, "api": True, "test": False, "fields": None,
                    },
                    "allOf": [{"$ref": "#/definitions/__item"}],
                },
            }
        }

    def _entity(self, definition_key: str) -> dict:
        return {
            "parent": definition_key,
            "model": "item",
            "definition_key": definition_key,
            "children": [],
            "generate_config": {
                "list": True, "view": True, "new": True, "edit": True,
                "delete": True, "api": True, "test": False, "fields": None,
            },
        }

    def test_declaring_view_sees_it_readonly(self):
        schema = self._schema()
        ctx = build_context(self._entity("item_a"), schema)
        assert "name" in ctx["readonly_fields"]

    def test_sibling_view_of_same_raw_model_does_not_inherit_it(self):
        schema = self._schema()
        ctx = build_context(self._entity("item_b"), schema)
        assert "name" not in ctx["readonly_fields"], (
            "item_b shares the __item raw entity with item_a but declares "
            "no x-readonly-fields of its own — item_a's declaration must "
            "not leak onto it"
        )

    def test_raw_entity_itself_never_carries_the_key(self):
        """Belt-and-suspenders: the raw entity dict in the schema fixture
        itself has no x-readonly-fields key (this test constructs the
        schema directly, so it also documents the shape build_user_schema.py
        must produce -- see test_x_readonly_fields_lands_on_view_not_raw in
        test_scheduled_task_templates.py for the builder-side assertion)."""
        schema = self._schema()
        assert "x-readonly-fields" not in schema["definitions"]["__item"]


# ---------------------------------------------------------------------------
# form_upsert_context: readonly field rendering
# ---------------------------------------------------------------------------

class TestFormUpsertReadonlyFields:
    def _build(self, schema: dict) -> dict:
        ctx = build_context(_entity(), schema)
        return form_upsert_context(ctx, schema)

    def test_readonly_field_renders_readonly_block_with_isEdit(self):
        schema = _schema_with_readonly(field_level_ro=["status"])
        upsert = self._build(schema)
        jsx = upsert["all_parent_fields_jsx"]
        assert "isEdit" in jsx
        assert "readOnly" in jsx

    def test_readonly_field_not_in_normal_enum_jsx(self):
        """Status is an int enum field; when readonly it must NOT appear as an
        editable Autocomplete/Select widget. It still needs its options array
        (enum_opt_setups) so the readonly display can resolve the translated
        label instead of showing the raw stored code (cmd_642) — only the
        editable-state variable (all_states, used by the Autocomplete's
        controlled value) is what must stay absent."""
        schema = _schema_with_readonly(field_level_ro=["status"])
        upsert = self._build(schema)
        jsx = upsert["all_parent_fields_jsx"]
        all_states = upsert.get("all_states", "")
        enum_opts = upsert.get("enum_opt_setups", "")
        assert "AppFieldSelect" not in jsx
        assert "statusOptions" not in all_states
        assert "statusOptions" in enum_opts

    def test_readonly_field_excluded_from_formdata_sets(self):
        """Readonly fields must not appear in parent_form_data_sets."""
        schema = _schema_with_readonly(field_level_ro=["status"])
        upsert = self._build(schema)
        fds = upsert.get("parent_form_data_sets", "")
        assert "formData.set('status'" not in fds

    def test_non_readonly_field_still_in_form(self):
        """name (not readonly) must still render normally."""
        schema = _schema_with_readonly(field_level_ro=["status"])
        upsert = self._build(schema)
        jsx = upsert["all_parent_fields_jsx"]
        fds = upsert.get("parent_form_data_sets", "")
        assert "nameRef" in upsert.get("parent_refs", "") or "name" in jsx
        assert "formData.set('name'" in fds

    def test_entity_level_readonly_also_omitted(self):
        schema = _schema_with_readonly(entity_level_ro=["note"])
        upsert = self._build(schema)
        fds = upsert.get("parent_form_data_sets", "")
        assert "formData.set('note'" not in fds
        jsx = upsert["all_parent_fields_jsx"]
        assert "isEdit" in jsx
        assert "readOnly" in jsx


# ---------------------------------------------------------------------------
# DataGrid child: x-readonly-fields / x-readonly reaching an embedded
# editable one-to-many child grid (cmd_874 subtask_874i). Regression
# coverage for the gap subtask_874g found: neither annotation used to have
# any effect on a DataGrid child's generated column_def.tsx editable flag
# or its create/update write path.
# ---------------------------------------------------------------------------

def _board_schema(child_entity_ro: list[str] | None = None, child_field_ro: list[str] | None = None) -> dict:
    """A parent ('board') with an embedded editable DataGrid child ('widget')
    — the same shape as the real schema's dashboard/dashboard_widget, the
    one true-editable DataGrid child subtask_874g used for its live
    verification."""
    child_props: dict = {
        "id": {"type": "string", "pattern": "^c[a-z0-9]{24,}$"},
        "board_id": {"type": "string", "pattern": "^c[a-z0-9]{24,}$"},
        "name": {"type": "string"},
        "value": {"type": "integer"},
    }
    if child_field_ro:
        for fn in child_field_ro:
            child_props[fn] = {**child_props[fn], "x-readonly": True}
    child_def: dict = {
        "type": "object",
        "required": ["id", "board_id", "name", "value"],
        "properties": child_props,
    }
    if child_entity_ro:
        child_def["x-readonly-fields"] = child_entity_ro

    return {
        "definitions": {
            "board": {
                "type": "object",
                "required": ["id", "name"],
                "properties": {
                    "id": {"type": "string", "pattern": "^c[a-z0-9]{24,}$"},
                    "name": {"type": "string"},
                },
            },
            "board_detail": {
                "x-generate": {
                    "list": True, "view": True, "new": True, "edit": True,
                    "delete": True, "api": True, "test": False, "fields": None,
                },
                "allOf": [{"$ref": "#/definitions/board"}],
            },
            "widget": child_def,
        }
    }


def _board_entity() -> dict:
    return {
        "parent": "board",
        "model": "board",
        "definition_key": "board_detail",
        "children": [
            {
                "name": "widget",
                "property_name": "widgets",
                "output_type": "list",
                "file_type": None,
                "relationship": None,
            }
        ],
        "generate_config": {
            "list": True, "view": True, "new": True, "edit": True,
            "delete": True, "api": True, "test": False, "fields": None,
        },
    }


class TestDataGridChildReadonlyFields:
    def _child(self, ctx: dict) -> dict:
        widgets = [c for c in ctx["non_comment_ch"] if c["property_name"] == "widgets"]
        assert len(widgets) == 1
        return widgets[0]

    def test_no_readonly_declared_gives_empty_set(self):
        ctx = build_context(_board_entity(), _board_schema())
        assert self._child(ctx)["readonly_field_names"] == set()

    def test_entity_level_x_readonly_fields_collected(self):
        ctx = build_context(_board_entity(), _board_schema(child_entity_ro=["name"]))
        assert self._child(ctx)["readonly_field_names"] == {"name"}

    def test_field_level_x_readonly_collected(self):
        ctx = build_context(_board_entity(), _board_schema(child_field_ro=["value"]))
        assert self._child(ctx)["readonly_field_names"] == {"value"}

    def test_unresolved_entity_level_readonly_field_fails_closed(self):
        ctx_schema = _board_schema(child_entity_ro=["not_a_real_property"])
        with pytest.raises(ValueError, match="not_a_real_property"):
            build_context(_board_entity(), ctx_schema)

    def test_ui_column_editable_false_for_readonly_field(self):
        """generators.py's child-grid column builder must force
        editable: false on a readonly-declared child column, and leave
        every other column reading the caller's `editable` bool argument
        (the pre-existing 'order' column pattern)."""
        schema = _board_schema(child_entity_ro=["name"])
        ctx = build_context(_board_entity(), schema)
        col_ctx = {**ctx, **column_def_context(ctx, schema)}
        fn_code = col_ctx["column_children"][0]["fn_code"]
        assert "field: 'name', headerName: t('name'), width: 150, editable: false" in fn_code
        assert "field: 'value', headerName: t('value'), width: 100, editable: editable" in fn_code

    def test_create_body_seeds_default_for_readonly_field(self):
        """A new child row has no prior value to preserve — field_map_create
        (used by both a standalone create and a new row added during an
        update) must substitute a schema-derived default, not the
        client-submitted value."""
        ctx = build_context(_board_entity(), _board_schema(child_entity_ro=["name"]))
        child = self._child(ctx)
        assert "name: f.name," not in child["field_map_create"]
        assert "name: ''," in child["field_map_create"]
        assert "value: f.value," in child["field_map_create"]
        assert "name: ''," in ctx["child_nested_create"]

    def test_update_body_omits_readonly_field_entirely(self):
        """An existing row's readonly field must be dropped from the
        `update:` data object entirely (not sent as its current value) so
        Prisma leaves the persisted value untouched."""
        ctx = build_context(_board_entity(), _board_schema(child_entity_ro=["name"]))
        child = self._child(ctx)
        assert "name" not in child["field_map_update"]
        assert "value: f.value," in child["field_map_update"]
        nested_update = ctx["child_nested_update"]
        # The update: branch (existing rows) must not assign `name` at all.
        update_branch = nested_update.split("create: widgetsItems")[0]
        assert "name:" not in update_branch
        assert "value: f.value," in update_branch

    def test_no_readonly_declared_update_keeps_all_fields(self):
        ctx = build_context(_board_entity(), _board_schema())
        child = self._child(ctx)
        assert child["field_map_create"] == child["field_map_update"]
        assert "name: f.name," in child["field_map_update"]


# ---------------------------------------------------------------------------
# api_detail_route template: AP-3 check code generation
# ---------------------------------------------------------------------------

class TestApiDetailRouteReadonlyCheck:
    def _render_api_detail(self, schema: dict) -> str:
        from jinja2 import Environment, FileSystemLoader
        from pathlib import Path
        here = Path(__file__).parent.parent
        env = Environment(
            loader=FileSystemLoader(here / "templates"),
            trim_blocks=True,
            lstrip_blocks=True,
        )
        ctx = build_context(_entity(), schema)
        return env.get_template("api_detail_route.ts.jinja2").render(**ctx)

    def test_no_readonly_no_check_code(self):
        schema = _schema_with_readonly()
        rendered = self._render_api_detail(schema)
        assert "_roRow" not in rendered
        assert "read-only" not in rendered

    def test_readonly_field_generates_check_code(self):
        schema = _schema_with_readonly(field_level_ro=["status"])
        rendered = self._render_api_detail(schema)
        assert "_roRow" in rendered
        assert "status" in rendered
        assert "read-only" in rendered
        assert "400" in rendered

    def test_check_code_uses_body_dot_field(self):
        """AP-3: check uses body.field !== undefined guard (absent field passes through)."""
        schema = _schema_with_readonly(field_level_ro=["status"])
        rendered = self._render_api_detail(schema)
        assert "body.status !== undefined" in rendered
