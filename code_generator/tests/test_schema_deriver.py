"""
Unit tests for schema_deriver.py -- Prisma parsing, Category A/B derivation,
and the R5 divergence check (cmd_395 design doc Sec.8).

R5 says: where Prisma and the user schema both carry a fact about the same
column (currently: `x-relationship.target`), the builder must cross-check
them and abort the build on mismatch rather than silently trusting one
side. The red/green pair below is the direct proof of that rule.
"""
from pathlib import Path
from textwrap import dedent

import pytest

from schema_deriver import (
    SchemaDivergenceError,
    derive_property,
    derive_raw_entity,
    parse_prisma_schema,
)

PRISMA_FIXTURE = dedent(
    """
    model role {
      id   String @id @default(cuid())
      name String
    }

    model permission {
      id      String  @id @default(cuid())
      name    String
      role_id String?
      role    role?   @relation(fields: [role_id], references: [id])
      active  Boolean @default(true)
    }
    """
)


@pytest.fixture()
def prisma_models(tmp_path):
    path = tmp_path / "schema.prisma"
    path.write_text(PRISMA_FIXTURE, encoding="utf-8")
    return parse_prisma_schema(path)


def test_parses_scalar_fields_and_id(prisma_models):
    role = prisma_models["role"]
    assert role.fields["id"].is_id
    assert role.fields["name"].prisma_type == "String"
    assert not role.fields["name"].nullable


def test_parses_fk_relation_target(prisma_models):
    permission = prisma_models["permission"]
    assert permission.fk_target("role_id") == "role"
    assert permission.fields["role_id"].nullable


def test_parses_default_value(prisma_models):
    permission = prisma_models["permission"]
    pf = permission.fields["active"]
    assert pf.has_default
    assert pf.default_value is True
    assert not pf.default_is_dynamic


def test_derive_raw_entity_required_excludes_defaulted_field(prisma_models):
    raw = derive_raw_entity(prisma_models["permission"], {"name": {}, "active": {}})
    # `active` has a Prisma default -> not required, matching the legacy
    # convention proven against proj_b/proj_c (e.g. permission.import).
    assert "active" not in raw["required"]
    assert "name" in raw["required"]


# ---------------------------------------------------------------------------
# R5: divergence check (red/green)
# ---------------------------------------------------------------------------

def test_r5_green_matching_target_is_accepted(prisma_models):
    """GREEN: user schema's x-relationship.target agrees with Prisma -> no error."""
    prop = derive_property(
        prisma_models["permission"],
        "role_id",
        {"x-relationship": {"target": "role"}},
    )
    assert prop["x-relationship"]["target"] == "role"


def test_r5_red_mismatched_target_raises(prisma_models):
    """RED: user schema's x-relationship.target contradicts Prisma's actual
    @relation target -> the builder must abort, not silently prefer either
    side (design doc Sec.8: "Builder validates that user-specified target
    ... matches Prisma relation target")."""
    with pytest.raises(SchemaDivergenceError):
        derive_property(
            prisma_models["permission"],
            "role_id",
            {"x-relationship": {"target": "not_the_real_target"}},
        )


def test_r5_red_relationship_on_non_fk_column_raises(prisma_models):
    """RED: x-relationship declared on a column Prisma does not relate at all."""
    with pytest.raises(SchemaDivergenceError):
        derive_property(
            prisma_models["permission"],
            "name",
            {"x-relationship": {}},
        )


def test_r5_red_unknown_field_name_raises(prisma_models):
    """RED: a `fields:` entry naming a column that doesn't exist in Prisma at all."""
    with pytest.raises(SchemaDivergenceError):
        derive_raw_entity(prisma_models["permission"], {"nonexistent_column": {}})
