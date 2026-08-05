"""
Tests for convert_to_user_schema.py -- the automated legacy-schema converter
(cmd_395 design doc Sec.4/Sec.12 Stage 3: "automated schema converter",
explicitly required instead of hand-rewriting, which drops annotations).

The core property under test: convert -> build is a semantic round trip.
Whatever the legacy schema said, `build_user_schema` fed the converter's
output must reconstruct it, for arbitrary schemas -- not just the two
fixtures (proj_b, proj_c) this task's report measures by hand.
"""
from pathlib import Path
from textwrap import dedent

from ruamel.yaml import YAML

from build_user_schema import build_intermediate_schema
from convert_to_user_schema import convert_to_user_schema
from schema_deriver import parse_prisma_schema

PRISMA_FIXTURE = dedent(
    """
    model widget {
      id         String   @id @default(cuid())
      name       String
      note       String?
      is_active  Boolean  @default(true)
      created_at DateTime @default(now())
      updated_at DateTime @updatedAt
    }
    """
)

LEGACY_SCHEMA_FIXTURE = dedent(
    """
    definitions:
      widget:
        type: object
        required: [id, name]
        x-import-key: [name]
        properties:
          id: {type: string, pattern: "^c[a-z0-9]{24,}$"}
          name: {type: string, minLength: 1}
          note: {type: [string, "null"], x-ui: {rows: 2}}
          is_active: {type: boolean}
      widget_detail:
        x-generate: {list: true, view: true}
        x-audit: true
        allOf:
          - $ref: "#/definitions/widget"
    """
)


def _yaml_load(text):
    yaml = YAML(typ="safe")
    return yaml.load(text)


def test_convert_then_build_reconstructs_legacy_schema(tmp_path):
    prisma_path = tmp_path / "schema.prisma"
    prisma_path.write_text(PRISMA_FIXTURE, encoding="utf-8")
    prisma_models = parse_prisma_schema(prisma_path)

    legacy = _yaml_load(LEGACY_SCHEMA_FIXTURE)
    converted = convert_to_user_schema(legacy, prisma_models)

    # Stage 4 (cmd_409): the `_detail` suffix is retired from the
    # user-authored schema -- the paired view takes the bare `widget` key
    # directly, with no separate raw `widget` entry (Category A is fully
    # Prisma-derived, and the synthesized raw entity is reconstructed onto
    # the reserved `__widget` name by `build_intermediate_schema`).
    assert "widget" in converted["definitions"]
    assert "widget_detail" not in converted["definitions"]

    rebuilt = build_intermediate_schema(converted, prisma_models)

    # cmd_574: `is_active` has a static Prisma `@default(true)` and no
    # `default:` override in the legacy fixture -- the builder now
    # auto-reflects that Category A fact (see schema_deriver.derive_property),
    # so the round trip legitimately gains this one key rather than
    # reproducing the legacy input byte-for-byte.
    expected_widget = dict(legacy["definitions"]["widget"])
    expected_widget["properties"] = dict(expected_widget["properties"])
    expected_widget["properties"]["is_active"] = {
        **expected_widget["properties"]["is_active"], "default": True,
    }
    assert rebuilt["definitions"]["__widget"] == expected_widget

    # The only content difference Stage 4 intentionally introduces on a
    # paired view: its `allOf[0].$ref` now points at the renamed raw entity
    # (`__widget` instead of `widget`). Normalize that one field so the
    # comparison proves true content equality, not just "looks different
    # because the entity was renamed" (mirrors
    # test_build_user_schema_roundtrip.py's `_normalize_legacy_view_self_ref`).
    expected_view = dict(legacy["definitions"]["widget_detail"])
    expected_view["allOf"] = [
        {**item, "$ref": "#/definitions/__widget"} if item.get("$ref") == "#/definitions/widget" else item
        for item in expected_view["allOf"]
    ]
    assert rebuilt["definitions"]["widget"] == expected_view
