"""
Tests for cmd_346 Phase0/1 mobile (Expo Router) generation:
get_mobile_entities(), build_mobile_entity_context(), generate_mobile_target().

Fully independent of the web generation test suite — these tests only
exercise the mobile/ opt-in code path (gated on x-generate.mobile: true).
"""
import sys
import pathlib

sys.path.insert(0, str(pathlib.Path(__file__).parent.parent))
from generate import (
    _make_env,
    get_mobile_entities,
    build_mobile_entity_context,
    generate_mobile_target,
    mobile_enum_fields,
)


def _role_schema(mobile: bool = True) -> dict:
    return {
        "definitions": {
            "role": {
                "type": "object",
                "required": ["id", "name"],
                "properties": {
                    "id": {"type": "string", "pattern": "^c[a-z0-9]{24,}$"},
                    "name": {"type": "string", "minLength": 1},
                    "description": {"type": ["string", "null"]},
                },
            },
            "role_detail": {
                "x-generate": {
                    "list": True,
                    "view": True,
                    "new": True,
                    "edit": True,
                    "delete": True,
                    "api": True,
                    "test": True,
                    "mobile": mobile,
                },
                "allOf": [{"$ref": "#/definitions/role"}],
            },
        }
    }


def test_get_mobile_entities_strips_detail_suffix():
    schema = _role_schema(mobile=True)
    assert get_mobile_entities(schema) == ["role"]


def test_get_mobile_entities_empty_when_flag_false():
    schema = _role_schema(mobile=False)
    assert get_mobile_entities(schema) == []


def test_get_mobile_entities_empty_when_absent():
    schema = {"definitions": {"role": {"properties": {}}}}
    assert get_mobile_entities(schema) == []


def test_build_mobile_entity_context_fields():
    schema = _role_schema()
    ctx = build_mobile_entity_context("role", schema)
    assert ctx["entity_name"] == "role"
    assert ctx["label"] == "Role"
    assert ctx["plural_label"] == "Roles"
    assert ctx["pk_field"] == "id"
    assert ctx["api_path"] == "/api/role"
    field_names = {f["name"] for f in ctx["display_fields"]}
    assert field_names == {"name", "description"}
    name_field = next(f for f in ctx["display_fields"] if f["name"] == "name")
    assert name_field["ts_type"] == "string"
    desc_field = next(f for f in ctx["display_fields"] if f["name"] == "description")
    assert desc_field["ts_type"] == "string | null"
    assert desc_field["nullable"] is True


def test_mobile_target_generated_for_role_entity(tmp_path):
    """Full render pass: mobile/ scaffold + role screens land on disk with no
    Jinja/template errors, mirroring the real generate-code invocation."""
    schema = _role_schema()
    env = _make_env()
    mobile_entities = get_mobile_entities(schema)
    assert mobile_entities == ["role"]

    output_dir = tmp_path / "mobile"
    generate_mobile_target(mobile_entities, schema, output_dir, env)

    expected_files = [
        "app.json",
        "package.json",
        "tsconfig.json",
        "babel.config.js",
        "env.d.ts",
        "lib/token-storage.ts",
        "lib/api-base.ts",
        "app/_layout.tsx",
        "app/login.tsx",
        "app/(app)/_layout.tsx",
        "app/(app)/index.tsx",
        "app/(app)/role/_layout.tsx",
        "app/(app)/role/index.tsx",
        "app/(app)/role/[id].tsx",
        "app/(app)/role/edit.tsx",
        "lib/role-api.ts",
    ]
    for rel_path in expected_files:
        f = output_dir / rel_path
        assert f.is_file(), f"expected {rel_path} to be generated"
        assert f.read_text(encoding="utf-8").strip(), f"{rel_path} is empty"

    api_client = (output_dir / "lib" / "role-api.ts").read_text(encoding="utf-8")
    assert "export interface Role" in api_client
    assert "fetchRoleList" in api_client
    assert "createRole" in api_client


def test_generate_mobile_target_noop_when_no_mobile_entities(tmp_path):
    """Non-regression guard: no mobile_entities -> nothing written."""
    schema = {"definitions": {}}
    env = _make_env()
    output_dir = tmp_path / "mobile"
    generate_mobile_target([], schema, output_dir, env)
    assert not output_dir.exists()


def _permission_schema() -> dict:
    """cmd_376 batch2: FK (many-to-one) + required boolean fields, no
    'description' column — exercises mobile_fk_relations, mobile_toggle_fields
    and the has_description guard against a real Phase2 second entity."""
    return {
        "definitions": {
            "role": {
                "type": "object",
                "required": ["id", "name"],
                "properties": {
                    "id": {"type": "string", "pattern": "^c[a-z0-9]{24,}$"},
                    "name": {"type": "string", "minLength": 1},
                },
            },
            "permission": {
                "type": "object",
                "required": ["id", "name", "create", "read", "update", "delete"],
                "properties": {
                    "id": {"type": "string", "pattern": "^c[a-z0-9]{24,}$"},
                    "name": {"type": "string", "minLength": 1},
                    "create": {"type": "boolean"},
                    "read": {"type": "boolean"},
                    "update": {"type": "boolean"},
                    "delete": {"type": "boolean"},
                    "import": {"type": "boolean", "default": False},
                    "role_id": {
                        "type": ["string", "null"],
                        "pattern": "^c[a-z0-9]{24,}$",
                        "x-relationship": {"type": "many-to-one", "target": "role", "labelField": "name"},
                    },
                },
            },
            "permission_detail": {
                "x-generate": {
                    "list": True,
                    "view": True,
                    "new": True,
                    "edit": True,
                    "delete": True,
                    "api": True,
                    "test": True,
                    "mobile": True,
                },
                "allOf": [{"$ref": "#/definitions/permission"}],
            },
        }
    }


def test_build_mobile_entity_context_fk_relation():
    schema = _permission_schema()
    ctx = build_mobile_entity_context("permission", schema)
    assert ctx["mobile_fk_relations"] == [
        {
            "prop": "role_id",
            "target": "role",
            "label": "Role",
            "snake": "role",
            "api_path": "/api/role",
        }
    ]
    # role_id is represented via mobile_fk_relations, not as a plain field
    field_names = {f["name"] for f in ctx["display_fields"]}
    assert "role_id" not in field_names


def test_build_mobile_entity_context_toggle_fields_and_reserved_words():
    schema = _permission_schema()
    ctx = build_mobile_entity_context("permission", schema)
    toggle_names = {f["name"] for f in ctx["mobile_toggle_fields"]}
    assert toggle_names == {"create", "read", "update", "delete", "import"}
    delete_field = next(f for f in ctx["mobile_toggle_fields"] if f["name"] == "delete")
    assert delete_field["var_name"] == "deleteValue"
    assert delete_field["setter_name"] == "setDeleteValue"
    import_field = next(f for f in ctx["mobile_toggle_fields"] if f["name"] == "import")
    assert import_field["var_name"] == "importValue"
    create_field = next(f for f in ctx["mobile_toggle_fields"] if f["name"] == "create")
    assert create_field["var_name"] == "create"
    assert create_field["setter_name"] == "setCreate"


def test_build_mobile_entity_context_has_description_false_for_permission():
    schema = _permission_schema()
    ctx = build_mobile_entity_context("permission", schema)
    assert ctx["has_description"] is False


def test_build_mobile_entity_context_has_description_true_for_role():
    schema = _role_schema()
    ctx = build_mobile_entity_context("role", schema)
    assert ctx["has_description"] is True


def test_mobile_target_generated_for_permission_entity(tmp_path):
    """Full render pass for the FK entity: no Jinja/template errors, and the
    generated edit screen wires up the role FK picker + boolean toggles."""
    schema = _permission_schema()
    env = _make_env()
    mobile_entities = get_mobile_entities(schema)
    assert mobile_entities == ["permission"]

    output_dir = tmp_path / "mobile"
    generate_mobile_target(mobile_entities, schema, output_dir, env)

    edit_tsx = (output_dir / "app" / "(app)" / "permission" / "edit.tsx").read_text(encoding="utf-8")
    assert "fetchRoleAutocomplete" in edit_tsx
    assert "multi={false}" in edit_tsx
    assert "Switch" in edit_tsx
    assert "deleteValue" in edit_tsx
    assert "description" not in edit_tsx.lower()

    api_client = (output_dir / "lib" / "permission-api.ts").read_text(encoding="utf-8")
    assert "role_id: string | null;" in api_client
    assert "fetchRoleAutocomplete" in api_client


# --- cmd_376 batch3: mobile_enum_fields (entity-agnostic helper, not yet
# wired to any real entity's mobile: true) -----------------------------------

def test_mobile_enum_fields_collects_integer_enum_properties():
    schema = {
        "definitions": {
            "widget": {
                "type": "object",
                "required": ["id", "name", "status"],
                "properties": {
                    "id": {"type": "string", "pattern": "^c[a-z0-9]{24,}$"},
                    "name": {"type": "string", "minLength": 1},
                    "status": {
                        "type": "integer",
                        "minimum": 0,
                        "maximum": 2,
                        "enum": ["Pending", "Approved", "Rejected"],
                    },
                },
            },
        }
    }
    assert mobile_enum_fields("widget", schema) == [
        {"prop": "status", "labels": ["Pending", "Approved", "Rejected"]}
    ]


def test_mobile_enum_fields_ignores_non_integer_and_non_enum_properties():
    schema = {
        "definitions": {
            "widget": {
                "type": "object",
                "properties": {
                    "id": {"type": "string", "pattern": "^c[a-z0-9]{24,}$"},
                    "name": {"type": "string", "minLength": 1},
                    "count": {"type": "integer"},  # no enum -> not a label field
                    "label": {"type": "string", "enum": ["a", "b"]},  # not integer
                },
            },
        }
    }
    assert mobile_enum_fields("widget", schema) == []


def test_mobile_enum_fields_empty_when_entity_absent():
    assert mobile_enum_fields("missing", {"definitions": {}}) == []


def test_build_mobile_entity_context_mobile_enum_fields_empty_for_role_and_permission():
    """Non-regression: neither existing mobile entity (role, permission) has
    an integer+enum property today, so the new mobile_enum_fields context key
    must be an empty list for both — this batch adds a pure helper with zero
    effect on their generated output."""
    role_ctx = build_mobile_entity_context("role", _role_schema())
    assert role_ctx["mobile_enum_fields"] == []
    permission_ctx = build_mobile_entity_context("permission", _permission_schema())
    assert permission_ctx["mobile_enum_fields"] == []


def _widget_schema() -> dict:
    """Synthetic entity (fictional — not part of json_schema.yaml, and not
    given mobile: true there) used only to exercise mobile_enum_fields
    end-to-end through the mobile templates."""
    return {
        "definitions": {
            "widget": {
                "type": "object",
                "required": ["id", "name", "status"],
                "properties": {
                    "id": {"type": "string", "pattern": "^c[a-z0-9]{24,}$"},
                    "name": {"type": "string", "minLength": 1},
                    "status": {
                        "type": "integer",
                        "minimum": 0,
                        "maximum": 2,
                        "enum": ["Pending", "Approved", "Rejected"],
                    },
                },
            },
            "widget_detail": {
                "x-generate": {
                    "list": True,
                    "view": True,
                    "new": True,
                    "edit": True,
                    "delete": True,
                    "api": True,
                    "test": True,
                    "mobile": True,
                },
                "allOf": [{"$ref": "#/definitions/widget"}],
            },
        }
    }


def test_mobile_target_generated_for_enum_entity(tmp_path):
    """Full render pass proving the {% if mobile_enum_fields %} template
    fragments render correctly once an entity actually has an integer+enum
    property and mobile: true — the condition this batch's real entities
    don't yet meet."""
    schema = _widget_schema()
    env = _make_env()
    mobile_entities = get_mobile_entities(schema)
    assert mobile_entities == ["widget"]

    output_dir = tmp_path / "mobile"
    generate_mobile_target(mobile_entities, schema, output_dir, env)

    index_tsx = (output_dir / "app" / "(app)" / "widget" / "index.tsx").read_text(encoding="utf-8")
    assert '["Pending", "Approved", "Rejected"]' in index_tsx
    assert "item.status" in index_tsx

    id_tsx = (output_dir / "app" / "(app)" / "widget" / "[id].tsx").read_text(encoding="utf-8")
    assert '["Pending", "Approved", "Rejected"]' in id_tsx
    assert "data.status" in id_tsx
    assert "Status" in id_tsx
