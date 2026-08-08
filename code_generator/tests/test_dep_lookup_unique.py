"""
Tests for find-or-create lookup keys in the Cypress populate helpers when the
dep entity has no `name` column.

`populateXxxDependencies` is called more than once per test (the parent
populator plus every child populator calls it), so each dep record it creates
must be looked up before it is created. The lookup used to be hard-coded to
`name`; an entity without one (e.g. a `purchase_order` keyed on a `@unique`
`po_number`) fell through to a plain `create()` and the second call died with
P2002. `generators_test._dep_lookup_columns` now falls back to the Prisma
uniqueness facts registered by `set_prisma_uniques()`.
"""
import pytest

from generators_test import (
    _dep_lookup_columns,
    _render_lookup_where,
    helper_context,
    set_prisma_uniques,
)
from schema_deriver import collect_unique_columns, parse_prisma_schema


@pytest.fixture(autouse=True)
def _reset_prisma_uniques():
    """Every test owns the module-level registry; leave it empty afterwards so
    the rest of the suite keeps exercising the no-Prisma-facts fallback."""
    yield
    set_prisma_uniques({})


def _schema() -> dict:
    """`goods_receipt_line` → purchase_order (no `name`, @unique po_number)
    and → bin (no `name`, @@unique([location_id, code]))."""
    return {
        "definitions": {
            "supplier": {
                "type": "object",
                "required": ["id", "code", "name"],
                "properties": {
                    "id": {"type": "string"},
                    "code": {"type": "string"},
                    "name": {"type": "string"},
                },
                "x-display": {"table": [{"code": {"primary": True}}]},
            },
            "location": {
                "type": "object",
                "required": ["id", "code", "name"],
                "properties": {
                    "id": {"type": "string"},
                    "code": {"type": "string"},
                    "name": {"type": "string"},
                },
                "x-display": {"table": [{"code": {"primary": True}}]},
            },
            "bin": {
                "type": "object",
                "required": ["id", "code", "location_id"],
                "properties": {
                    "id": {"type": "string"},
                    "code": {"type": "string"},
                    "location_id": {
                        "type": "string",
                        "x-relationship": {"type": "many-to-one", "target": "location", "labelField": "name"},
                    },
                },
                "x-display": {"table": [{"code": {"primary": True}}]},
            },
            "purchase_order": {
                "type": "object",
                "required": ["id", "po_number", "supplier_id"],
                "properties": {
                    "id": {"type": "string"},
                    "po_number": {"type": "string"},
                    "supplier_id": {
                        "type": "string",
                        "x-relationship": {"type": "many-to-one", "target": "supplier", "labelField": "name"},
                    },
                },
                "x-display": {"table": [{"po_number": {"primary": True}}]},
            },
            "goods_receipt_line": {
                "type": "object",
                "required": ["id", "quantity", "purchase_order_id", "bin_id"],
                "properties": {
                    "id": {"type": "string"},
                    "quantity": {"type": "integer"},
                    "purchase_order_id": {
                        "type": "string",
                        "x-relationship": {"type": "many-to-one", "target": "purchase_order", "labelField": "po_number"},
                    },
                    "bin_id": {
                        "type": "string",
                        "x-relationship": {"type": "many-to-one", "target": "bin", "labelField": "code"},
                    },
                },
                "x-display": {"table": [{"quantity": {"primary": True}}]},
            },
            "goods_receipt_line_detail": {"allOf": [{"$ref": "#/definitions/goods_receipt_line"}]},
        }
    }


_UNIQUES = {
    "supplier": {"single": ["code"], "composite": []},
    "location": {"single": ["code"], "composite": []},
    "bin": {"single": [], "composite": [["location_id", "code"]]},
    "purchase_order": {"single": ["po_number"], "composite": []},
    "goods_receipt_line": {"single": [], "composite": []},
}


def _deps() -> dict:
    set_prisma_uniques(_UNIQUES)
    ctx = helper_context(
        "goods_receipt_line", [], _schema(),
        "goods_receipt_line", "goods_receipt_line_detail",
        {"list": True, "view": True, "new": True, "edit": True, "delete": True,
         "api": True, "test": True, "fields": None},
    )
    return {d["var_name"]: d for d in ctx["deps"]}


# ---------------------------------------------------------------------------
# _dep_lookup_columns — key selection
# ---------------------------------------------------------------------------

class TestDepLookupColumns:
    def test_name_wins_over_unique_column(self):
        """A `name` column keeps the long-standing lookup, even when the
        entity also carries a @unique column."""
        set_prisma_uniques(_UNIQUES)
        efs = [
            {"prop_name": "code", "prisma_val": "'Test Code'"},
            {"prop_name": "name", "prisma_val": "'Test Supplier'"},
        ]
        cols = _dep_lookup_columns("supplier", efs, [])
        assert [c["prop_name"] for c in cols] == ["name"]

    def test_falls_back_to_single_unique_column(self):
        set_prisma_uniques(_UNIQUES)
        efs = [{"prop_name": "po_number", "prisma_val": "'Test Po Number'"}]
        cols = _dep_lookup_columns("purchase_order", efs, [])
        assert [c["prop_name"] for c in cols] == ["po_number"]

    def test_falls_back_to_composite_unique_including_fk(self):
        set_prisma_uniques(_UNIQUES)
        efs = [{"prop_name": "code", "prisma_val": "'Test Code'"}]
        fk_deps = [{"prop_name": "location_id", "dep_var_name": "location"}]
        cols = _dep_lookup_columns("bin", efs, fk_deps)
        assert [c["prop_name"] for c in cols] == ["location_id", "code"]

    def test_composite_skipped_when_a_column_is_not_written(self):
        """A nullable / DB-defaulted column never reaches create(), so a
        constraint mentioning it can't be matched — plain create, as before."""
        set_prisma_uniques(_UNIQUES)
        cols = _dep_lookup_columns("bin", [{"prop_name": "code", "prisma_val": "'Test Code'"}], [])
        assert cols == []

    def test_no_unique_constraint_yields_no_lookup(self):
        """Bridge entities (commentable, approvable) keep the plain-create path."""
        set_prisma_uniques(_UNIQUES)
        assert _dep_lookup_columns("goods_receipt_line", [], []) == []

    def test_unregistered_entity_yields_no_lookup(self):
        """No Prisma facts registered → `name`-only behavior, unchanged."""
        set_prisma_uniques({})
        efs = [{"prop_name": "po_number", "prisma_val": "'Test Po Number'"}]
        assert _dep_lookup_columns("purchase_order", efs, []) == []


# ---------------------------------------------------------------------------
# _render_lookup_where — where-clause rendering
# ---------------------------------------------------------------------------

class TestRenderLookupWhere:
    def test_scalar_only(self):
        cols = [{"prop_name": "name", "prisma_val": "'Test Supplier'"}]
        assert _render_lookup_where(cols, "prisma_val") == "{ name: 'Test Supplier' }"

    def test_fk_column_uses_dep_accessor(self):
        cols = [
            {"prop_name": "location_id", "dep_var_name": "location"},
            {"prop_name": "code", "prisma_val_unique": "`Test Code ${i}`"},
        ]
        assert _render_lookup_where(cols, "prisma_val_unique") == (
            "{ location_id: location.id, code: `Test Code ${i}` }"
        )

    def test_fk_prefix_for_populate_data_loop(self):
        """Inside populateXxxData the dep records live on `deps`."""
        cols = [{"prop_name": "location_id", "dep_var_name": "location"}]
        assert _render_lookup_where(cols, "prisma_val", fk_prefix="deps.") == (
            "{ location_id: deps.location.id }"
        )


# ---------------------------------------------------------------------------
# helper_context — end-to-end wiring
# ---------------------------------------------------------------------------

class TestHelperContextLookupWiring:
    def test_name_less_dep_with_unique_column_gets_find_or_create(self):
        dep = _deps()["purchaseOrder"]
        assert dep["lookup_field"] == "po_number"
        assert dep["lookup_where"] == "{ po_number: 'Test Po Number A' }"
        assert dep["lookup_where_second"] == "{ po_number: 'Test Po Number B' }"
        assert dep["lookup_where_unique"] == "{ po_number: `Test Po Number ${i}` }"

    def test_name_less_dep_with_composite_unique_gets_find_or_create(self):
        dep = _deps()["bin"]
        assert dep["lookup_field"] == "location_id"
        assert dep["lookup_where"] == "{ location_id: location.id, code: 'Test Code A' }"
        assert dep["lookup_where_unique"] == (
            "{ location_id: deps.location.id, code: `Test Code ${i}` }"
        )

    def test_named_dep_still_looks_up_by_name(self):
        dep = _deps()["supplier"]
        assert dep["lookup_field"] == "name"
        assert dep["lookup_where"] == "{ name: 'Test Supplier A' }"


# ---------------------------------------------------------------------------
# collect_unique_columns — Prisma parsing
# ---------------------------------------------------------------------------

class TestCollectUniqueColumns:
    def test_reads_field_and_block_level_uniques(self, tmp_path):
        schema = tmp_path / "schema.prisma"
        schema.write_text(
            "model purchase_order {\n"
            "  id        String @id @default(cuid())\n"
            "  po_number String @unique\n"
            "  currency  String @default(\"USD\")\n"
            "}\n"
            "\n"
            "model bin {\n"
            "  id          String @id @default(cuid())\n"
            "  location_id String\n"
            "  code        String\n"
            "\n"
            "  @@unique([location_id, code])\n"
            "  @@index([location_id])\n"
            "}\n",
            encoding="utf-8",
        )
        uniques = collect_unique_columns(parse_prisma_schema(schema))
        assert uniques["purchase_order"] == {"single": ["po_number"], "composite": []}
        assert uniques["bin"] == {"single": [], "composite": [["location_id", "code"]]}

    def test_id_column_is_not_reported_as_unique(self):
        """`@id` is a generated cuid — never a deterministic fixture key."""
        from pathlib import Path

        prisma_path = Path(__file__).parent.parent.parent / "prisma" / "schema.prisma"
        uniques = collect_unique_columns(parse_prisma_schema(prisma_path))
        assert "id" not in uniques["user"]["single"]
        assert "email" in uniques["user"]["single"]
