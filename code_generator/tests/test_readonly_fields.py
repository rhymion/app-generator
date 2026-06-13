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
from generators import form_upsert_context


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
    if entity_level_ro:
        entity_def["x-readonly-fields"] = entity_level_ro

    return {
        "definitions": {
            "item": entity_def,
            "item_detail": {
                "x-generate": {
                    "list": True, "view": True, "new": True, "edit": True,
                    "delete": True, "api": True, "test": False, "fields": None,
                },
                "allOf": [{"$ref": "#/definitions/item"}],
            },
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
        """Status is an int enum field; when readonly it must NOT appear as an Autocomplete."""
        schema = _schema_with_readonly(field_level_ro=["status"])
        upsert = self._build(schema)
        all_states = upsert.get("all_states", "")
        enum_opts = upsert.get("enum_opt_setups", "")
        assert "statusOptions" not in all_states
        assert "statusOptions" not in enum_opts

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
