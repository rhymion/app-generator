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

    # Category A eliminated: the raw `widget` entity must be gone from the
    # converted (user-authored) schema -- it is now fully Prisma-derived.
    assert "widget" not in converted["definitions"]
    assert "widget_detail" in converted["definitions"]

    rebuilt = build_intermediate_schema(converted, prisma_models)

    assert rebuilt["definitions"]["widget"] == legacy["definitions"]["widget"]
    assert rebuilt["definitions"]["widget_detail"] == legacy["definitions"]["widget_detail"]
