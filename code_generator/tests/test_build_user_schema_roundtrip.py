"""
Tests for build_user_schema.py -- cmd_395 Stage 4 (`_detail` suffix removal).

Stage 4 replaces the Stage 3 `{model}_detail` naming convention with a bare
`{model}` view name; the synthesized raw entity that used to occupy the
bare `{model}` name moves to a reserved `__{model}` name instead.
`tests/fixtures/stage4_reference.yaml` is a snapshot of the Stage 4
intermediate schema the builder must reproduce.

`tests/fixtures/stage2_reference_json_schema.yaml` -- the pre-Stage-3
legacy full schema, which cmd_408's own roundtrip test already proved is
exactly what the Stage 3 builder produced -- doubles as ground truth for
the Phase A golden-diff invariant (see docs/knowledge/schema-restructuring-build-order.md
Sec.5 phase_A_schema_level): renaming a paired entity must not change its
content, only its key and its self-referential `$ref`.

cmd_663 (3rd recurrence of the same failure class -- cmd_476, and a
2026-07-30 prj:sync-triggered incident, being the first two): the two
golden-diff tests below used to derive their "actual" side from THIS
project's live, ever-changing `json_schema.yaml` and diff it against the
frozen fixtures above -- so *any* schema edit, however unrelated to what
these tests exist to guard, broke them, and the fix each time was a
manual fixture-expected-value rewrite. That habit is retired as of
cmd_663: both tests now derive "actual" from `stage2_reference_json_schema.yaml`
itself, round-tripped through `convert_to_user_schema.py` (the documented
mirror-image of `build_user_schema.py`) -- see `_rebuild_from_stage2_fixture`.
Verified empirically (cmd_663) that this reproduces `stage4_reference.yaml`
byte-for-byte, so neither frozen fixture needed a content edit to make
this change. Going forward, editing the live `json_schema.yaml` cannot
break either test -- only editing `stage2_reference_json_schema.yaml` (or
the fixture files) itself can.

`test_live_schema_derivation_does_not_raise` below is the intentionally
separate test that keeps *some* coverage on the live schema, per cmd_663's
own instruction: derivation succeeding is still worth checking, but never
again as a content diff against a frozen reference -- only "did it raise."

`prisma/schema.prisma` is NOT frozen the same way (out of cmd_663's
diagnosed scope, which named `json_schema.yaml` specifically) -- Prisma
model shape changes to the entities under test could in principle still
break these two tests. Residual risk, not addressed here.
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
from convert_to_user_schema import convert_to_user_schema
from schema_deriver import SchemaDivergenceError, parse_prisma_enums, parse_prisma_schema

SCHEMA_PATH = Path(__file__).parent.parent / "json_schema.yaml"
PRISMA_SCHEMA_PATH = Path(__file__).parent.parent.parent / "prisma" / "schema.prisma"
STAGE2_REFERENCE_PATH = Path(__file__).parent / "fixtures" / "stage2_reference_json_schema.yaml"
STAGE4_REFERENCE_PATH = Path(__file__).parent / "fixtures" / "stage4_reference.yaml"

# scripts/prj_sync.py treats a sibling `../prj` directory (one level above
# this repo's root) as the signal that it is mounted as a consumer's
# submodule, and overlays that consumer's schema onto json_schema.yaml /
# schema.prisma / messages/*.json (its own PRJ_DIR = PROJECT_ROOT.parent /
# "prj"). The invariant tests below assert something about *this* project's
# own default schema, which stops being true the moment a consumer schema
# has been substituted in -- so they must refuse to run under the exact
# condition prj_sync.py itself uses to decide "am I being consumed as a
# submodule" (cmd_492: a prj:synced tree produced a wall of unrelated
# content diffs here instead of a "you're testing the wrong file" signal).
REPO_ROOT = SCHEMA_PATH.parent.parent
PRJ_SYNC_SIBLING = REPO_ROOT.parent / "prj"


def _fail_if_prj_synced_tree():
    if PRJ_SYNC_SIBLING.is_dir():
        pytest.fail(
            f"Refusing to run: {PRJ_SYNC_SIBLING} exists, meaning `npm run "
            "prj:sync` would overlay (or already did overlay) a consumer's "
            "schema onto code_generator/json_schema.yaml / prisma/schema.prisma. "
            "This test asserts an invariant about the framework's OWN default "
            "schema, which is meaningless once a consumer schema has been "
            "substituted in. Run pytest from a tree with no sibling `prj/` "
            "directory (e.g. the standalone app-generator checkout, as CI "
            "does), not from a submodule mount that has run prj:sync.",
            pytrace=False,
        )

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


def _rebuild_from_stage2_fixture():
    """Derive a Stage 4 intermediate schema entirely from the frozen
    `stage2_reference_json_schema.yaml` fixture -- never touches the live
    `json_schema.yaml` (see module docstring, cmd_663). `prisma/schema.prisma`
    and `json_schema_internal.yaml` are still read live; `SCHEMA_PATH` is
    passed to `_merge_internal_definitions` only to locate that sibling
    file by path, its *content* is never read here.
    """
    prisma_models = parse_prisma_schema(PRISMA_SCHEMA_PATH)
    prisma_enums = parse_prisma_enums(PRISMA_SCHEMA_PATH)
    legacy = _load(STAGE2_REFERENCE_PATH)
    converted = convert_to_user_schema(legacy, prisma_models)
    _merge_internal_definitions(converted, SCHEMA_PATH, _make_yaml())
    return build_intermediate_schema(converted, prisma_models, prisma_enums)


def test_stage4_derivation_matches_reference():
    _fail_if_prj_synced_tree()
    rebuilt = _rebuild_from_stage2_fixture()
    expected = _load(STAGE4_REFERENCE_PATH)

    diffs = _deep_diff(expected, rebuilt)
    assert not diffs, "Stage 4 output diverges from the reference:\n" + "\n".join(diffs)


def test_live_schema_derivation_does_not_raise(tmp_path):
    """Separate, intentionally content-free check (cmd_663 point 2): the
    live schema must still derive successfully, but this must never again
    be a content diff against a frozen reference -- only "did it raise."
    """
    _fail_if_prj_synced_tree()
    out_path = tmp_path / ".generated" / "json_schema.yaml"
    build_user_schema(SCHEMA_PATH, PRISMA_SCHEMA_PATH, out_path)  # must not raise


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
# Collision detection (see docs/knowledge/schema-restructuring-build-order.md Sec.4 collision_detection_design)
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
# Phase A golden diff (see docs/knowledge/schema-restructuring-build-order.md Sec.5 phase_A_schema_level)
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


def test_phase_a_golden_diff_zero():
    """Old `{base}` (raw) content == new `__{base}` content, and old
    `{base}_detail` (view) content == new `{base}` content (modulo the
    expected self-ref rename), for every paired entity. Standalone and
    pass-through entities must be byte-for-byte untouched by the rename.

    `new` and `old` are BOTH derived from the same frozen stage2 fixture
    (see `_rebuild_from_stage2_fixture`) -- this proves the rename
    transform itself is content-preserving, independent of whatever the
    live `json_schema.yaml` currently says (cmd_663)."""
    _fail_if_prj_synced_tree()
    new = _rebuild_from_stage2_fixture()
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
    """The user-always-wins invariant for json_schema_internal.yaml (real
    file, not a fixture; see _merge_internal_definitions): for any entity
    the default json_schema.yaml still defines itself, the sibling internal
    file must leave that entity's Stage 4 output completely untouched.

    This is NOT the same invariant as "internal file changes nothing at all":
    an entity the default schema does *not* define itself -- e.g.
    `notification` (added by cmd_475), or `approvable` / `commentable` /
    `attachable` themselves since cmd_497 removed their duplicate
    definitions from json_schema.yaml (they had been shadowing the identical
    json_schema_internal.yaml copies) -- is legitimately filled in from the
    internal file -- that is the file's whole purpose, not a violation. A
    full byte-for-byte comparison against a frozen reference would reject
    every future internal-only addition, which defeats the point of the
    file. So this guard builds the schema twice -- once with the real
    internal file consulted, once with it hidden from build_user_schema --
    and asserts identical output only for entities the user schema itself
    still defines, while separately confirming the internal-only entity
    really is internal-only (present when consulted, absent when hidden)."""
    _fail_if_prj_synced_tree()
    user_definitions = _load(SCHEMA_PATH)["definitions"]

    with_internal_out = tmp_path / "with_internal" / "json_schema.yaml"
    build_user_schema(SCHEMA_PATH, PRISMA_SCHEMA_PATH, with_internal_out)
    with_internal = _load(with_internal_out)

    # A copy of json_schema.yaml in a directory with no sibling
    # json_schema_internal.yaml -- _merge_internal_definitions is a no-op
    # here, so this build is "as if" the internal file didn't exist.
    isolated_dir = tmp_path / "isolated"
    isolated_dir.mkdir()
    isolated_schema_path = isolated_dir / "json_schema.yaml"
    isolated_schema_path.write_text(SCHEMA_PATH.read_text(encoding="utf-8"), encoding="utf-8")
    without_internal_out = tmp_path / "without_internal" / "json_schema.yaml"
    build_user_schema(isolated_schema_path, PRISMA_SCHEMA_PATH, without_internal_out)
    without_internal = _load(without_internal_out)

    diffs = []
    for base in user_definitions:
        for name in (base, f"__{base}"):
            if name not in with_internal["definitions"] and name not in without_internal["definitions"]:
                continue  # standalone entity: no synthesized raw twin either way
            diffs.extend(
                _deep_diff(
                    without_internal["definitions"].get(name),
                    with_internal["definitions"].get(name),
                    f".definitions.{name}",
                )
            )
    assert not diffs, (
        "json_schema_internal.yaml changed the Stage 4 output of an entity "
        "the default json_schema.yaml defines itself -- user-always-wins "
        "violated:\n" + "\n".join(diffs)
    )

    # The internal-only addition is real (merge still functions) and is
    # genuinely absent without the internal file (not user-defined already).
    assert "notification" in with_internal["definitions"]
    assert "notification" not in without_internal["definitions"]
