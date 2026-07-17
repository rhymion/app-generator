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
