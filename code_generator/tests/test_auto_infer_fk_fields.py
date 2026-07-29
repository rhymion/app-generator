"""
Tests for build_user_schema.py's `_auto_infer_fk_fields()` (cmd_438 Batch2
pilot): a relation object declared in `properties:` (e.g. `role: {$ref:
...}`) with no corresponding FK scalar in `fields:` (e.g. `role_id`) must
still produce that FK scalar in the derived raw entity, via the Prisma
model's `relation_fk_fields`.
"""
from pathlib import Path

from build_user_schema import _auto_infer_fk_fields
from schema_deriver import parse_prisma_schema

PRISMA_SCHEMA_PATH = Path(__file__).parent.parent.parent / "prisma" / "schema.prisma"


def _permission_model():
    models = parse_prisma_schema(PRISMA_SCHEMA_PATH)
    return models["permission"]


def test_auto_infer_fk_fields_adds_missing_fk_scalar():
    model = _permission_model()
    entry = {
        "fields": {
            "name": {"minLength": 1},
        },
        "properties": {
            "role": {"$ref": "#/definitions/role"},
        },
    }
    result = _auto_infer_fk_fields(entry, model)
    assert result["role_id"] == {"x-relationship": {}}
    assert result["name"] == {"minLength": 1}


def test_auto_infer_fk_fields_preserves_explicit_override():
    model = _permission_model()
    entry_explicit = {
        "fields": {
            "name": {"minLength": 1},
            "role_id": {"x-ui": {"width": 6}, "x-relationship": {}},
        },
        "properties": {
            "role": {"$ref": "#/definitions/role"},
        },
    }
    result = _auto_infer_fk_fields(entry_explicit, model)
    # explicit fields: entry takes precedence -- no double-processing
    assert result["role_id"] == {"x-ui": {"width": 6}, "x-relationship": {}}


def test_auto_infer_fk_fields_noop_without_relation_properties():
    model = _permission_model()
    entry = {"fields": {"name": {"minLength": 1}}}
    result = _auto_infer_fk_fields(entry, model)
    assert "role_id" not in result
    assert result == {"name": {"minLength": 1}}
