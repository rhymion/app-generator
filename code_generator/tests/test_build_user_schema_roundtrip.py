"""
Tests for build_user_schema.py -- cmd_395 Stage 4 (`_detail` suffix removal).

Stage 4 replaces the Stage 3 `{model}_detail` naming convention with a bare
`{model}` view name; the synthesized raw entity that used to occupy the
bare `{model}` name moves to a reserved `__{model}` name instead.
`tests/fixtures/stage4_reference.yaml` is a snapshot of the Stage 4
intermediate schema this builder must reproduce from the (renamed)
`json_schema.yaml` + `prisma/schema.prisma` pair.

`tests/fixtures/stage2_reference_json_schema.yaml` -- the pre-Stage-3
legacy full schema, which cmd_408's own roundtrip test already proved is
exactly what the Stage 3 builder produced -- doubles as ground truth for
the Phase A golden-diff invariant (queue/reports/subtask_409a_gunshi.yaml
Sec.5 phase_A_schema_level): renaming a paired entity must not change its
content, only its key and its self-referential `$ref`.
"""
from pathlib import Path

import pytest
from ruamel.yaml import YAML

from build_user_schema import (
    UserSchemaError,
    _make_yaml,
    _merge_internal_definitions,
    build_intermediate_schema,
    build_user_schema,
)
from schema_deriver import SchemaDivergenceError, parse_prisma_schema

SCHEMA_PATH = Path(__file__).parent.parent / "json_schema.yaml"
PRISMA_SCHEMA_PATH = Path(__file__).parent.parent.parent / "prisma" / "schema.prisma"
STAGE2_REFERENCE_PATH = Path(__file__).parent / "fixtures" / "stage2_reference_json_schema.yaml"
STAGE4_REFERENCE_PATH = Path(__file__).parent / "fixtures" / "stage4_reference.yaml"

# The 9 entities that pair a synthesized raw (`__{name}`) with a
# user-authored view (`{name}`) -- i.e. every entity that was
# `{name}_detail` before Stage 4.
PAIRED_ENTITIES = (
    "user", "role", "organization", "permission", "approval_flow",
    "approvable", "commentable", "attachable", "dashboard",
)
STANDALONE_ENTITIES = ("approval_request", "comment", "reaction", "attachment", "dashboard_widget")


def _load(path):
    yaml = YAML(typ="safe")
    with path.open(encoding="utf-8") as f:
        return yaml.load(f)


def _deep_diff(a, b, path=""):
    diffs = []
    if isinstance(a, dict) and isinstance(b, dict):
        for k in a.keys() - b.keys():
            diffs.append(f"{path}.{k}: missing in rebuilt (expected {a[k]!r})")
        for k in b.keys() - a.keys():
            diffs.append(f"{path}.{k}: unexpected in rebuilt ({b[k]!r})")
        for k in a.keys() & b.keys():
            diffs.extend(_deep_diff(a[k], b[k], f"{path}.{k}"))
    elif isinstance(a, list) and isinstance(b, list):
        if len(a) != len(b):
            diffs.append(f"{path}: list length {len(a)} != {len(b)}")
        else:
            for i, (x, y) in enumerate(zip(a, b)):
                diffs.extend(_deep_diff(x, y, f"{path}[{i}]"))
    else:
        if a != b:
            diffs.append(f"{path}: {a!r} != {b!r}")
    return diffs


def test_stage4_derivation_matches_reference(tmp_path):
    out_path = tmp_path / ".generated" / "json_schema.yaml"
    build_user_schema(SCHEMA_PATH, PRISMA_SCHEMA_PATH, out_path)

    expected = _load(STAGE4_REFERENCE_PATH)
    rebuilt = _load(out_path)

    diffs = _deep_diff(expected, rebuilt)
    assert not diffs, "Stage 4 output diverges from the reference:\n" + "\n".join(diffs)


def test_missing_user_schema_raises():
    with pytest.raises(FileNotFoundError):
        build_user_schema(
            Path("/nonexistent/user_schema.yaml"),
            PRISMA_SCHEMA_PATH,
            Path("/tmp/does-not-matter.yaml"),
        )


def test_missing_prisma_schema_raises():
    with pytest.raises(FileNotFoundError):
        build_user_schema(
            SCHEMA_PATH,
            Path("/nonexistent/schema.prisma"),
            Path("/tmp/does-not-matter.yaml"),
        )


def test_unknown_field_name_raises_divergence(tmp_path):
    """R5: a `fields:` entry naming a column that doesn't exist in Prisma
    is a divergence, not a silently-empty property."""
    user_schema_path = tmp_path / "user_schema.yaml"
    user_schema_path.write_text(
        "definitions:\n"
        "  role:\n"
        "    x-generate: {list: true}\n"
        "    fields:\n"
        "      not_a_real_column: {}\n",
        encoding="utf-8",
    )
    with pytest.raises(SchemaDivergenceError):
        build_user_schema(user_schema_path, PRISMA_SCHEMA_PATH, tmp_path / "out.yaml")


# ---------------------------------------------------------------------------
# Collision detection (subtask_409a_gunshi.yaml Sec.4 collision_detection_design)
# ---------------------------------------------------------------------------

def test_reserved_dunder_prefix_entity_name_raises():
    """RED: a user-authored entity starting with `__` collides with the
    namespace reserved for synthesized raw entities."""
    prisma_models = parse_prisma_schema(PRISMA_SCHEMA_PATH)
    user_schema = {
        "definitions": {
            "__role": {"x-generate": {"list": True}, "fields": {}},
        }
    }
    with pytest.raises(UserSchemaError, match="reserved"):
        build_intermediate_schema(user_schema, prisma_models)


def test_ordinary_entity_name_does_not_raise_reserved_prefix_error():
    """GREEN: an ordinary (non-`__`) entity name is unaffected."""
    prisma_models = parse_prisma_schema(PRISMA_SCHEMA_PATH)
    user_schema = {"definitions": {"comment": {"fields": {}}}}
    build_intermediate_schema(user_schema, prisma_models)  # must not raise


def test_prisma_model_named_pass_through_entity_raises():
    """RED: an entity named after a real Prisma model but written in the
    pass-through (`allOf`-wrapper) shape would silently be reinterpreted
    as that model's own raw/view pair, discarding the author's `allOf`."""
    prisma_models = parse_prisma_schema(PRISMA_SCHEMA_PATH)
    user_schema = {
        "definitions": {
            "role": {
                "allOf": [
                    {"$ref": "#/definitions/user"},
                    {"type": "object"},
                ],
            },
        }
    }
    with pytest.raises(UserSchemaError, match="interpreted as the view definition"):
        build_intermediate_schema(user_schema, prisma_models)


def test_non_model_named_pass_through_entity_does_not_raise():
    """GREEN: `setting` -- a pass-through entity whose name is NOT a
    Prisma model -- is unaffected (this is the legitimate, existing
    pattern the collision check must not break)."""
    prisma_models = parse_prisma_schema(PRISMA_SCHEMA_PATH)
    user_schema = {
        "definitions": {
            "setting": {
                "allOf": [
                    {"$ref": "#/definitions/user"},
                    {"type": "object"},
                ],
            },
        }
    }
    build_intermediate_schema(user_schema, prisma_models)  # must not raise


# ---------------------------------------------------------------------------
# Phase A golden diff (subtask_409a_gunshi.yaml Sec.5 phase_A_schema_level)
# ---------------------------------------------------------------------------

def _normalize_legacy_view_self_ref(view: dict, base: str) -> dict:
    """The only content difference Stage 4 intentionally introduces on a
    paired view: its `allOf[0].$ref` now points at the renamed raw entity
    (`__{base}` instead of `{base}`). Normalize that one field so the rest
    of the deep-compare proves true content equality, not just "looks
    different because the entity was renamed"."""
    normalized = dict(view)
    all_of = [dict(item) if isinstance(item, dict) else item for item in view.get("allOf", [])]
    for item in all_of:
        if isinstance(item, dict) and item.get("$ref") == f"#/definitions/{base}":
            item["$ref"] = f"#/definitions/__{base}"
    normalized["allOf"] = all_of
    return normalized


def test_phase_a_golden_diff_zero(tmp_path):
    """Old `{base}` (raw) content == new `__{base}` content, and old
    `{base}_detail` (view) content == new `{base}` content (modulo the
    expected self-ref rename), for every paired entity. Standalone and
    pass-through entities must be byte-for-byte untouched by the rename."""
    out_path = tmp_path / ".generated" / "json_schema.yaml"
    build_user_schema(SCHEMA_PATH, PRISMA_SCHEMA_PATH, out_path)
    new = _load(out_path)
    old = _load(STAGE2_REFERENCE_PATH)

    diffs = []
    for base in PAIRED_ENTITIES:
        diffs.extend(
            _deep_diff(old["definitions"][base], new["definitions"][f"__{base}"], f"raw:{base}")
        )
        old_view = _normalize_legacy_view_self_ref(old["definitions"][f"{base}_detail"], base)
        diffs.extend(_deep_diff(old_view, new["definitions"][base], f"view:{base}"))

    for name in STANDALONE_ENTITIES:
        diffs.extend(
            _deep_diff(old["definitions"][name], new["definitions"][name], f"standalone:{name}")
        )

    diffs.extend(
        _deep_diff(old["definitions"]["setting"], new["definitions"]["setting"], "passthrough:setting")
    )

    assert not diffs, "Phase A golden diff non-zero:\n" + "\n".join(diffs)


# ---------------------------------------------------------------------------
# json_schema_internal.yaml merge (cmd_438 Batch3, subtask_438i)
# ---------------------------------------------------------------------------

def test_merge_internal_definitions_fills_missing_entity(tmp_path):
    """An entity absent from the user schema, but present in the sibling
    json_schema_internal.yaml, is filled in from the internal file."""
    (tmp_path / "json_schema_internal.yaml").write_text(
        "definitions:\n"
        "  attachable:\n"
        "    x-generate: {list: false}\n",
        encoding="utf-8",
    )
    user_schema_path = tmp_path / "json_schema.yaml"  # need not exist on disk
    user_schema = {"definitions": {"role": {"fields": {}}}}

    _merge_internal_definitions(user_schema, user_schema_path, _make_yaml())

    assert user_schema["definitions"]["attachable"] == {"x-generate": {"list": False}}
    assert user_schema["definitions"]["role"] == {"fields": {}}


def test_merge_internal_definitions_user_definition_wins(tmp_path):
    """An entity the user schema already defines is never overwritten by
    the internal file, even if both define the same entity name."""
    (tmp_path / "json_schema_internal.yaml").write_text(
        "definitions:\n"
        "  attachable:\n"
        "    x-generate: {list: false}\n",
        encoding="utf-8",
    )
    user_schema_path = tmp_path / "json_schema.yaml"
    user_schema = {"definitions": {"attachable": {"x-generate": {"list": True}}}}

    _merge_internal_definitions(user_schema, user_schema_path, _make_yaml())

    assert user_schema["definitions"]["attachable"] == {"x-generate": {"list": True}}


def test_merge_internal_definitions_missing_file_is_noop(tmp_path):
    """No json_schema_internal.yaml next to the user schema (e.g. an
    existing, pre-cmd_438i project) leaves the user schema untouched."""
    user_schema_path = tmp_path / "json_schema.yaml"
    user_schema = {"definitions": {"role": {"fields": {}}}}

    _merge_internal_definitions(user_schema, user_schema_path, _make_yaml())

    assert user_schema["definitions"] == {"role": {"fields": {}}}


def test_default_schema_bridge_entities_are_unaffected_by_internal_file(tmp_path):
    """The framework's own json_schema.yaml still defines approvable /
    commentable / attachable itself; the sibling json_schema_internal.yaml
    (real file, not a fixture) must not change its Stage 4 output at all
    (user-always-wins) -- regression guard for the file this ships next to
    SCHEMA_PATH in code_generator/."""
    out_path = tmp_path / ".generated" / "json_schema.yaml"
    build_user_schema(SCHEMA_PATH, PRISMA_SCHEMA_PATH, out_path)

    expected = _load(STAGE4_REFERENCE_PATH)
    rebuilt = _load(out_path)

    diffs = _deep_diff(expected, rebuilt)
    assert not diffs, "json_schema_internal.yaml changed default schema output:\n" + "\n".join(diffs)
