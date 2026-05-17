"""
Regression tests for inline flatten-target type declarations in `types.ts`.

Background
----------
A `_detail` definition can reference an embedded entity via `x-outputType:
flatten`. When that embedded entity has its own generated module (because
`{target}_detail` carries `x-generate`), the type is imported from
`@/lib/<target>/types`. When the embedded entity has no module — no
`x-generate` on the base AND no `_detail` variant — there is no module to
import from, so the type must be declared inline in the parent's `types.ts`.

This used to break the build for entities like `checkup` whose
`checkup_detail` flattens in `checkup_result`: `lib/checkup_result/types`
does not exist, so `import type { CheckupResult } from '@/lib/checkup_result/types'`
fails at `tsc` time.
"""
from dataclasses import asdict

from context import build_entity_context


def _entity(model: str) -> dict:
    return {
        "parent": model,
        "model": model,
        "definition_key": f"{model}_detail",
        "children": [],
        "generate_config": {
            "list": True, "view": True, "new": True, "edit": True,
            "delete": True, "api": True, "test": True, "fields": None,
        },
    }


def _id_prop() -> dict:
    return {"type": "string", "pattern": "^c[a-z0-9]{24,}$"}


def _schema_with_flatten(target_has_module: bool, target_via_detail: bool = False) -> dict:
    """Build a minimal schema where `parent_detail` flattens `embedded`.

    `target_has_module`: whether the embedded entity should produce its own
    module — i.e. `x-generate` lives somewhere visible to extract_entities.
    `target_via_detail`: if True and the target has a module, register the
    module via `embedded_detail` (the more common pattern). Otherwise put
    `x-generate` directly on the base.
    """
    defs: dict = {
        "parent": {
            "type": "object",
            "required": ["id"],
            "properties": {"id": _id_prop(), "name": {"type": "string"}},
        },
        "embedded": {
            "type": "object",
            "required": ["id", "parent_id"],
            "properties": {
                "id": _id_prop(),
                "parent_id": {
                    "type": "string",
                    "pattern": "^c[a-z0-9]{24,}$",
                    "x-relationship": {"type": "one-to-one", "target": "parent"},
                },
                "score": {"type": "number"},
                "comment": {"type": ["string", "null"]},
            },
        },
        "parent_detail": {
            "x-generate": {"list": True, "view": True, "new": True, "edit": True,
                           "delete": True, "api": True, "test": True},
            "allOf": [
                {"$ref": "#/definitions/parent"},
                {
                    "type": "object",
                    "properties": {
                        "embedded": {
                            "x-outputType": "flatten",
                            "$ref": "#/definitions/embedded",
                        }
                    },
                },
            ],
        },
    }
    if target_has_module:
        if target_via_detail:
            defs["embedded_detail"] = {
                "x-generate": {"list": True, "view": True, "new": True, "edit": True,
                               "delete": True, "api": True, "test": True},
                "allOf": [{"$ref": "#/definitions/embedded"}],
            }
        else:
            defs["embedded"]["x-generate"] = {"list": True, "view": True}
    return {"definitions": defs}


def _build(parent_model: str, schema: dict) -> dict:
    return asdict(build_entity_context(_entity(parent_model), schema))


# ---------------------------------------------------------------------------
# Inline declaration for embedded entities with no module
# ---------------------------------------------------------------------------

def test_embedded_entity_without_module_is_declared_inline():
    """No `x-generate` anywhere on the flatten target → no import, inline type."""
    ctx = _build("parent", _schema_with_flatten(target_has_module=False))

    # The bad import would route `embedded` into `import_targets`. It must not.
    assert "embedded" not in ctx["import_targets"]
    assert ctx["flatten_detail_imports"] == []

    # And the type must be declared inline with all base properties + creator_id.
    inline = {t["name"]: t for t in ctx["inline_flatten_types"]}
    assert "embedded" in inline
    field_map = {f["name"]: f["ts_type"] for f in inline["embedded"]["fields"]}
    assert field_map == {
        "id": "string",
        "parent_id": "string",
        "score": "number",
        "comment": "string | null",
        "creator_id": "string | null",
    }


def test_embedded_entity_with_detail_module_uses_import():
    """`embedded_detail` with `x-generate` → there IS a module, so import it
    via the regular `import_targets` channel (no inline declaration)."""
    ctx = _build("parent", _schema_with_flatten(target_has_module=True, target_via_detail=True))
    assert "embedded" in ctx["import_targets"]
    assert all(t["name"] != "embedded" for t in ctx["inline_flatten_types"])


def test_embedded_entity_with_base_xgenerate_uses_import():
    """`x-generate` on the BASE entity (no `_detail` variant, e.g. `setting`)
    also produces a module, so the target is still imported, not inlined."""
    ctx = _build("parent", _schema_with_flatten(target_has_module=True, target_via_detail=False))
    assert "embedded" in ctx["import_targets"]
    assert all(t["name"] != "embedded" for t in ctx["inline_flatten_types"])


def test_all_user_flags_false_is_treated_as_no_module():
    """Mirror `extract_entities`'s skip rule: an `x-generate` whose every
    user-facing flag is explicitly False generates no module — the type
    must be inlined."""
    schema = _schema_with_flatten(target_has_module=False)
    schema["definitions"]["embedded"]["x-generate"] = {
        "list": False, "view": False, "new": False, "edit": False,
        "delete": False, "api": False,
    }
    ctx = _build("parent", schema)
    assert "embedded" not in ctx["import_targets"]
    assert any(t["name"] == "embedded" for t in ctx["inline_flatten_types"])


# ---------------------------------------------------------------------------
# Regression: checkup → checkup_result (the original bug report)
# ---------------------------------------------------------------------------
#
# Reproduces the exact entity shape that triggered the original bug rather
# than reading `code_generator/json_schema.yaml`. The live schema is project
# data and turns over with feature work — a test pinned to it fails the day
# someone refactors `checkup` out, even when the generator is still correct.
# The other tests in this file cover the general behaviour with synthetic
# `parent` / `embedded` names; this one keeps `checkup` / `checkup_result`
# so a future reader sees the link to the historical regression.


def _checkup_schema() -> dict:
    """Mirror the checkup / checkup_result shape that originally broke
    `tsc` on `lib/checkup/types.ts`: `checkup_detail` flattens
    `checkup_result`, and `checkup_result` has neither `x-generate` nor a
    `_detail` variant so no module is ever emitted for it."""
    return {
        "definitions": {
            "checkup": {
                "type": "object",
                "required": ["id"],
                "properties": {"id": _id_prop(), "name": {"type": "string"}},
            },
            "checkup_result": {
                "type": "object",
                "required": ["id", "checkup_id"],
                "properties": {
                    "id": _id_prop(),
                    "checkup_id": {
                        "type": "string",
                        "pattern": "^c[a-z0-9]{24,}$",
                        "x-relationship": {"type": "one-to-one", "target": "checkup"},
                    },
                    "score": {"type": "number"},
                    "note": {"type": ["string", "null"]},
                },
            },
            "checkup_detail": {
                "x-generate": {"list": True, "view": True, "new": True, "edit": True,
                               "delete": True, "api": True, "test": True},
                "allOf": [
                    {"$ref": "#/definitions/checkup"},
                    {
                        "type": "object",
                        "properties": {
                            "checkup_result": {
                                "x-outputType": "flatten",
                                "$ref": "#/definitions/checkup_result",
                            }
                        },
                    },
                ],
            },
        }
    }


def test_checkup_result_is_inlined():
    """`checkup_result` has no module → must land in `inline_flatten_types`
    so `lib/checkup/types.ts` no longer imports from a nonexistent module."""
    ctx = _build("checkup", _checkup_schema())
    assert "checkup_result" not in ctx["import_targets"]
    names = [t["name"] for t in ctx["inline_flatten_types"]]
    assert "checkup_result" in names
