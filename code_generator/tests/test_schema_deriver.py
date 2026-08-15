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
    parse_prisma_enums,
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


# ---------------------------------------------------------------------------
# parse_prisma_enums() / Prisma nativeEnum threading (cmd_446 pilot)
# ---------------------------------------------------------------------------

ENUM_PRISMA_FIXTURE = dedent(
    """
    enum InventoryMovementStatus {
      pending
      rejected
    }

    model inventory_movement {
      id     String                   @id @default(cuid())
      status InventoryMovementStatus  @default(pending)
    }
    """
)


def test_parse_prisma_enums_returns_members(tmp_path):
    path = tmp_path / "schema.prisma"
    path.write_text(ENUM_PRISMA_FIXTURE, encoding="utf-8")
    enums = parse_prisma_enums(path)
    assert enums == {"InventoryMovementStatus": ["pending", "rejected"]}


def test_parse_prisma_enums_returns_empty_dict_when_no_enum_block(tmp_path):
    path = tmp_path / "schema.prisma"
    path.write_text(PRISMA_FIXTURE, encoding="utf-8")
    assert parse_prisma_enums(path) == {}


def test_derive_raw_entity_resolves_native_enum_as_string_type(tmp_path):
    path = tmp_path / "schema.prisma"
    path.write_text(ENUM_PRISMA_FIXTURE, encoding="utf-8")
    models = parse_prisma_schema(path)
    enums = parse_prisma_enums(path)

    raw = derive_raw_entity(models["inventory_movement"], {"status": {}}, enums)
    assert raw["properties"]["status"]["type"] == "string"


def test_derive_property_without_prisma_enums_raises_on_native_enum_type(tmp_path):
    """A Prisma nativeEnum field is unrecognized without the `prisma_enums`
    map (i.e. the pre-cmd_446 behavior for a caller that doesn't pass it)."""
    path = tmp_path / "schema.prisma"
    path.write_text(ENUM_PRISMA_FIXTURE, encoding="utf-8")
    models = parse_prisma_schema(path)

    with pytest.raises(SchemaDivergenceError):
        derive_property(models["inventory_movement"], "status", {})


# ---------------------------------------------------------------------------
# cmd_574: static Prisma @default() auto-reflected into the derived json
# schema property (Category A), unless the user schema already declares its
# own default: (Category C, which always wins).
# ---------------------------------------------------------------------------

def test_b1_static_default_is_derived_into_json_property(prisma_models):
    """B-1: `permission.active` has `@default(true)` in Prisma and no
    `default:` override in the user schema -- the derived prop must pick up
    Prisma's static default."""
    prop = derive_property(prisma_models["permission"], "active", {})
    assert prop["default"] is True


def test_b2_dynamic_default_is_not_derived(prisma_models):
    """B-2: `role.id` has `@default(cuid())` in Prisma (dynamic, server-
    generated) -- it must NOT appear as a `default:` in the derived
    property; a dynamic default has no meaning as a UI form default."""
    prop = derive_property(prisma_models["role"], "id", {})
    assert "default" not in prop


def test_b3_user_field_overrides_default_wins_over_prisma_default(prisma_models):
    """B-3: user schema explicitly declares `default: False` for
    `permission.active`, even though Prisma's `@default(true)` differs --
    the user-authored value must win, not Prisma's."""
    prop = derive_property(
        prisma_models["permission"], "active", {"default": False}
    )
    assert prop["default"] is False


# ---------------------------------------------------------------------------
# cmd_705: Prisma `Decimal` maps to JSON type "string" (precision-preserving
# -- a `number`/JS-float mapping was explicitly rejected).
# ---------------------------------------------------------------------------

DECIMAL_PRISMA_FIXTURE = dedent(
    """
    model widget {
      id     String   @id @default(cuid())
      price  Decimal  @db.Decimal(10, 2)
      weight Decimal? @db.Decimal(8, 3)
    }
    """
)


@pytest.fixture()
def decimal_models(tmp_path):
    path = tmp_path / "schema.prisma"
    path.write_text(DECIMAL_PRISMA_FIXTURE, encoding="utf-8")
    return parse_prisma_schema(path)


def test_decimal_maps_to_json_string_type_not_number(decimal_models):
    """The core cmd_705 ruling: Decimal -> "string", never "number" -- a
    `number` mapping would round-trip through JS float and risk exact
    rounding error, which the string representation exists to avoid."""
    prop = derive_property(decimal_models["widget"], "price", {})
    assert prop["type"] == "string"


def test_decimal_nullable_maps_to_string_null_union(decimal_models):
    prop = derive_property(decimal_models["widget"], "weight", {})
    assert prop["type"] == ["string", "null"]


def test_decimal_field_carries_internal_marker(decimal_models):
    """Downstream codegen (form input rendering, CSV coercion, display
    formatting, DataGrid-child test-value seeding) distinguishes a
    Decimal-backed string field from an ordinary string field via this
    marker -- it must never leak into a real JSON schema keyword name."""
    prop = derive_property(decimal_models["widget"], "price", {})
    assert prop["_prisma_decimal_type"] is True


def test_decimal_scale_auto_reflected_from_db_attribute(decimal_models):
    """`@db.Decimal(10, 2)` -- scale (2) is auto-reflected as `x-decimal-scale`
    (auto-derived from Prisma, like the existing `default:` auto-reflection),
    not a user-schema override."""
    price_prop = derive_property(decimal_models["widget"], "price", {})
    assert price_prop["x-decimal-scale"] == 2
    weight_prop = derive_property(decimal_models["widget"], "weight", {})
    assert weight_prop["x-decimal-scale"] == 3


def test_decimal_without_db_scale_has_no_x_decimal_scale_key():
    """A `Decimal` column with no `@db.Decimal(p, s)` attribute must not
    fabricate a scale value."""
    path_text = dedent(
        """
        model widget {
          id    String  @id @default(cuid())
          price Decimal
        }
        """
    )
    import tempfile

    with tempfile.TemporaryDirectory() as d:
        path = Path(d) / "schema.prisma"
        path.write_text(path_text, encoding="utf-8")
        models = parse_prisma_schema(path)
        prop = derive_property(models["widget"], "price", {})
        assert "x-decimal-scale" not in prop
        assert prop["_prisma_decimal_type"] is True


def test_decimal_raw_entity_required_when_non_nullable_no_default(decimal_models):
    raw = derive_raw_entity(decimal_models["widget"], {"price": {}, "weight": {}})
    assert "price" in raw["required"]
    assert "weight" not in raw["required"]
