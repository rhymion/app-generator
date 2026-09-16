"""
Four-corner tests for enum-field "new" default seeding (cmd_1012, following
up on cmd_1010's fix).

cmd_1010 fixed a silent-seed bug: an optional (nullable) enum field with no
Prisma `@default(...)` was fabricated to the first enum member on the "new"
form, instead of staying unset. That fix touches two independent branch
pairs -- Prisma nativeEnum-backed fields and plain (non-nativeEnum)
string-enum fields -- on two independent code paths: the top-level create
form (build_context.py:_default_value) and the DataGrid-child new-row seed
(generators.py:_new_prop_val). Four corners (mandatory/optional x
with/without a Prisma default) x two enum kinds x two paths = 16 independent
regression guards, so a future change to any one branch cannot silently
break a sibling without a named test failing.

Each test measures both halves of the invariant this fix restored:
(a) whether the field carries a Prisma `@default(...)` -- encoded here as
    the presence/absence of the `default:` key on the field definition, the
    same signal schema_deriver.py derives from a real schema.prisma column,
    and
(b) the resulting "new" form/row initial value.
Testing only one half is exactly the gap that let the underlying bug
through: the schema declared no default, but the UI silently invented one
anyway.
"""
from build_context import build_context
from generators import form_upsert_context


def _base_props(extra: dict = None) -> dict:
    props = {"id": {"type": "string", "pattern": "^c[a-z0-9]{24,}$"}, "name": {"type": "string"}}
    props.update(extra or {})
    return props


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


def _child_entry(name: str, prop: str) -> dict:
    return {"name": name, "property_name": prop, "output_type": None, "file_type": None, "relationship": None}


def _native_enum_defn(nullable: bool, has_default: bool) -> dict:
    defn = {
        "type": ["string", "null"] if nullable else "string",
        "enum": ["draft", "active", "archived"],
        "_prisma_native_enum_type": "StatusEnum",
    }
    if has_default:
        defn["default"] = "active"
    return defn


def _plain_enum_defn(nullable: bool, has_default: bool) -> dict:
    defn = {
        "type": ["string", "null"] if nullable else "string",
        "enum": ["low", "medium", "high"],
    }
    if has_default:
        defn["default"] = "medium"
    return defn


def _dashboard_widget_schema(field_name: str, defn: dict, nullable: bool) -> dict:
    """Parent (dashboard) + DataGrid-child (widget) schema, mirroring
    test_form_upsert.py's TestChildGridCreateNewIntegerDefault fixture.

    `widget` deliberately has NO `x-generate` (no own page): these tests
    exercise generators.py:_new_prop_val's DataGrid-child new-row default
    seeding, which only runs for a child still embedded EDITABLE via the
    parent. A child with its own x-generate is an independent child and (per
    cmd_1047 "Otsu" ruling) is read-only from the parent regardless of
    output_type -- giving it x-generate here would route it through the
    read-only FieldsViewGrid path instead, where child_grid_setup never
    builds a createNew()/_new_prop_val() call at all."""
    return {
        "definitions": {
            "__dashboard": {"type": "object", "required": ["id", "name"], "properties": _base_props()},
            "dashboard": {
                "x-generate": {"list": True, "view": True, "new": True, "edit": True,
                               "delete": True, "api": False, "test": False},
                "allOf": [{"$ref": "#/definitions/__dashboard"}],
            },
            "widget": {
                "type": "object",
                "required": ["id", "dashboard_id"] + ([] if nullable else [field_name]),
                "properties": {
                    "id": {"type": "string", "pattern": "^c[a-z0-9]{24,}$"},
                    field_name: defn,
                    "dashboard_id": {
                        "type": "string",
                        "pattern": "^c[a-z0-9]{24,}$",
                        "x-relationship": {"type": "many-to-one", "target": "dashboard", "labelField": "name"},
                    },
                },
            },
        }
    }


# ---------------------------------------------------------------------------
# Top-level create form (build_context.py:_default_value) -- nativeEnum
# ---------------------------------------------------------------------------

class TestTopLevelNativeEnumFourCorners:
    """Top-level "new" page default for a Prisma nativeEnum-backed field."""

    def _ctx(self, nullable: bool, has_default: bool):
        req = ["id", "name"] + ([] if nullable else ["status"])
        schema = {
            "definitions": {
                "widget": {
                    "type": "object",
                    "required": req,
                    "properties": {**_base_props(), "status": _native_enum_defn(nullable, has_default)},
                },
            }
        }
        return build_context(_entity("widget"), schema)

    def test_mandatory_with_default_uses_schema_default(self):
        ctx = self._ctx(nullable=False, has_default=True)
        assert "status: 'active' as const," in ctx["parent_default_props"]

    def test_mandatory_without_default_falls_back_to_first_enum_member(self):
        ctx = self._ctx(nullable=False, has_default=False)
        assert "status: 'draft' as const," in ctx["parent_default_props"]

    def test_optional_with_default_uses_schema_default(self):
        ctx = self._ctx(nullable=True, has_default=True)
        assert "status: 'active' as const," in ctx["parent_default_props"]

    def test_optional_without_default_stays_unset(self):
        """cmd_1010's fix: an untouched optional field must not fabricate enum[0]."""
        ctx = self._ctx(nullable=True, has_default=False)
        assert "status: null," in ctx["parent_default_props"]
        assert "as const" not in ctx["parent_default_props"]


# ---------------------------------------------------------------------------
# Top-level create form (build_context.py:_default_value) -- plain string-enum
# ---------------------------------------------------------------------------

class TestTopLevelPlainStringEnumFourCorners:
    """Top-level "new" page default for a plain (non-nativeEnum)
    string-enum field, e.g. a Prisma `String @default(...)` column."""

    def _ctx(self, nullable: bool, has_default: bool):
        req = ["id", "name"] + ([] if nullable else ["priority"])
        schema = {
            "definitions": {
                "widget": {
                    "type": "object",
                    "required": req,
                    "properties": {**_base_props(), "priority": _plain_enum_defn(nullable, has_default)},
                },
            }
        }
        return build_context(_entity("widget"), schema)

    def test_mandatory_with_default_uses_schema_default(self):
        ctx = self._ctx(nullable=False, has_default=True)
        assert "priority: 'medium'," in ctx["parent_default_props"]

    def test_mandatory_without_default_falls_back_to_first_enum_member(self):
        ctx = self._ctx(nullable=False, has_default=False)
        assert "priority: 'low'," in ctx["parent_default_props"]

    def test_optional_with_default_uses_schema_default(self):
        ctx = self._ctx(nullable=True, has_default=True)
        assert "priority: 'medium'," in ctx["parent_default_props"]

    def test_optional_without_default_stays_unset(self):
        """cmd_1010's fix: an untouched optional field must stay '', not
        fabricate the first enum member."""
        ctx = self._ctx(nullable=True, has_default=False)
        assert "priority: ''," in ctx["parent_default_props"]
        assert "priority: 'low'," not in ctx["parent_default_props"]


# ---------------------------------------------------------------------------
# DataGrid-child new-row seed (generators.py:_new_prop_val) -- nativeEnum
# ---------------------------------------------------------------------------

class TestDataGridChildNativeEnumFourCorners:
    """cmd_446 fixed the top-level path but left this DataGrid-child path
    for a Prisma nativeEnum-backed field un-migrated; verify all four
    corners independently so a future edit can't silently regress one."""

    def _ctx(self, nullable: bool, has_default: bool):
        schema = _dashboard_widget_schema("status", _native_enum_defn(nullable, has_default), nullable)
        entity = _entity("dashboard", children=[_child_entry("widget", "widgets")])
        ctx = build_context(entity, schema)
        return form_upsert_context(ctx, schema)

    def test_mandatory_with_default_uses_schema_default(self):
        ctx = self._ctx(nullable=False, has_default=True)
        assert "status: 'active'," in ctx["child_grid_setup"]

    def test_mandatory_without_default_falls_back_to_first_enum_member(self):
        ctx = self._ctx(nullable=False, has_default=False)
        assert "status: 'draft'," in ctx["child_grid_setup"]

    def test_optional_with_default_uses_schema_default(self):
        ctx = self._ctx(nullable=True, has_default=True)
        assert "status: 'active'," in ctx["child_grid_setup"]

    def test_optional_without_default_stays_unset(self):
        ctx = self._ctx(nullable=True, has_default=False)
        assert "status: null," in ctx["child_grid_setup"]
        assert "status: 'draft'," not in ctx["child_grid_setup"]


# ---------------------------------------------------------------------------
# DataGrid-child new-row seed (generators.py:_new_prop_val) -- plain string-enum
# ---------------------------------------------------------------------------

class TestDataGridChildPlainStringEnumFourCorners:
    """cmd_1010's fix: this path had no nullable check at all before -- an
    untouched optional plain-string-enum field on a DataGrid-child row
    always got enum[0], regardless of nullability."""

    def _ctx(self, nullable: bool, has_default: bool):
        schema = _dashboard_widget_schema("priority", _plain_enum_defn(nullable, has_default), nullable)
        entity = _entity("dashboard", children=[_child_entry("widget", "widgets")])
        ctx = build_context(entity, schema)
        return form_upsert_context(ctx, schema)

    def test_mandatory_with_default_uses_schema_default(self):
        ctx = self._ctx(nullable=False, has_default=True)
        assert "priority: 'medium'," in ctx["child_grid_setup"]

    def test_mandatory_without_default_falls_back_to_first_enum_member(self):
        ctx = self._ctx(nullable=False, has_default=False)
        assert "priority: 'low'," in ctx["child_grid_setup"]

    def test_optional_with_default_uses_schema_default(self):
        ctx = self._ctx(nullable=True, has_default=True)
        assert "priority: 'medium'," in ctx["child_grid_setup"]

    def test_optional_without_default_stays_unset(self):
        ctx = self._ctx(nullable=True, has_default=False)
        assert "priority: ''," in ctx["child_grid_setup"]
        assert "priority: 'low'," not in ctx["child_grid_setup"]
