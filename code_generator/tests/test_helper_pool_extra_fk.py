"""
Tests for cmd_602: pool_entity required FKs other than the criteria field in
`helper_context()`'s reservation_lines_pool_seed / reservation_nolines_pool_seed
blocks (the `populate{{Pascal}}Dependencies()` seed inserted so create tests can
allocate against the pool without hitting InsufficientPoolCapacityError).

Root cause: reservation_lines_pool_seed only ever resolved the pool entity's
criteria-field FK (e.g. inventory.product_id -> product); reservation_nolines_pool_seed
never resolved any pool entity FK at all. Any OTHER required FK on the pool entity
(e.g. inventory.location_id, added 2026-08-06 alongside product_id) was silently
omitted from the pool entity's prisma.<pool>.create() call in test_helper.ts.jinja2,
so the generated populate{{Pascal}}Dependencies() helper's Prisma call failed at seed
time with a missing-required-column error — reproduced live against proj_c's
purchase_order/inventory (cypress/support/purchase_order/helper.ts:78, 20/27 tests
in cypress/e2e/api/purchase_order.cy.ts failing; an earlier investigation report has the
file:line trace). This is a SEPARATE code path from _reservation_base()/
test_reservation_helper.ts.jinja2 (covered by test_reservation_helper_pool_extra_fk.py)
— that fix alone did not resolve this failure class.

This suite injects a deviation (a pool entity with a second required FK) into a
minimal fixture schema, per the injected-fixture verification convention (cmd_476):
don't just assert the context dict looks right, render the actual jinja2 template
and assert the generated TypeScript sets the column.
"""
import os

import pytest
from jinja2 import Environment, FileSystemLoader

from generators_test import helper_context
from helpers.naming import to_camel_case, to_pascal_case


def _template_env() -> Environment:
    template_dir = os.path.join(os.path.dirname(__file__), "..", "templates")
    env = Environment(
        loader=FileSystemLoader(template_dir),
        trim_blocks=True,
        lstrip_blocks=True,
        keep_trailing_newline=True,
    )
    env.filters["pascal_case"] = to_pascal_case
    env.filters["camel_case"] = to_camel_case
    return env


def _render(entity: str, schema: dict, children: list | None = None) -> str:
    ctx = helper_context(entity, children or [], schema, entity, f"{entity}_detail", _entity_config())
    tmpl = _template_env().get_template("test_helper.ts.jinja2")
    return tmpl.render(**ctx)


def _entity_config():
    return {
        "list": True, "view": True, "new": True, "edit": True,
        "delete": True, "api": False, "test": True, "fields": None,
    }


def _base_defs() -> dict:
    return {
        "product": {
            "type": "object",
            "required": ["id", "name"],
            "properties": {
                "id": {"type": "string", "pattern": "^c[a-z0-9]{24,}$"},
                "name": {"type": "string"},
            },
        },
        "warehouse": {
            "type": "object",
            "required": ["id", "code"],
            "properties": {
                "id": {"type": "string", "pattern": "^c[a-z0-9]{24,}$"},
                "code": {"type": "string"},
            },
        },
    }


def _po_def(lines: bool = True) -> dict:
    x_res = {
        "mode": "count",
        "pool": {"entity": "stock_pool", "quantityField": "quantity"},
        "request": {"quantityField": "quantity"},
    }
    required = ["id", "name"]
    properties = {
        "id": {"type": "string", "pattern": "^c[a-z0-9]{24,}$"},
        "name": {"type": "string"},
    }
    if lines:
        x_res["lines"] = "lines"
        x_res["request"]["criteria"] = {"product_id": "product_id"}
        # The criteria FK target (product) must already be a resolved dep by
        # the time reservation_lines_pool_seed is built — in the real schema
        # this comes from purchase_per_item's inventory_id datagrid-child
        # autocomplete FK; a direct required FK here exercises the same
        # "criteria target already in deps" precondition without needing to
        # construct a full datagrid-child fixture.
        required.append("product")
        properties["product_id"] = {
            "type": "string",
            "x-relationship": {"type": "many-to-one", "target": "product", "labelField": "name"},
        }
    return {
        "type": "object",
        "required": required,
        "properties": properties,
        "x-reservation": x_res,
    }


def _schema(lines: bool, with_extra_fk: bool) -> dict:
    defs = _base_defs()
    defs["purchase_order"] = _po_def(lines=lines)
    defs["purchase_order_detail"] = {"allOf": [{"$ref": "#/definitions/purchase_order"}]}
    stock_pool_required = ["id", "quantity"]
    stock_pool_props = {
        "id": {"type": "string", "pattern": "^c[a-z0-9]{24,}$"},
        "quantity": {"type": "integer", "minimum": 0},
    }
    if lines:
        stock_pool_required.insert(1, "product_id")
        stock_pool_props["product_id"] = {
            "type": "string",
            "x-relationship": {"type": "many-to-one", "target": "product", "labelField": "name"},
        }
    if with_extra_fk:
        stock_pool_required.append("warehouse_id")
        stock_pool_props["warehouse_id"] = {
            "type": "string",
            "x-relationship": {"type": "many-to-one", "target": "warehouse", "labelField": "code"},
        }
    defs["stock_pool"] = {
        "type": "object",
        "required": stock_pool_required,
        "properties": stock_pool_props,
    }
    return {"definitions": defs}


class TestReservationLinesPoolSeedExtraFk:
    """mode: count WITH lines (e.g. purchase_order/inventory) — the shape that
    actually failed live in proj_c."""

    def test_extra_fk_resolved_in_context(self):
        ctx = helper_context("purchase_order", [], _schema(lines=True, with_extra_fk=True),
                              "purchase_order", "purchase_order_detail", _entity_config())
        seed = ctx["reservation_lines_pool_seed"]
        assert seed is not None
        assert [d["target"] for d in seed["pool_extra_deps"]] == ["warehouse"]
        assert seed["pool_extra_fk_props"] == [{"prop_name": "warehouse_id", "dep_var_name": "warehouse"}]

    def test_generated_helper_sets_extra_required_fk_column(self):
        code = _render("purchase_order", _schema(lines=True, with_extra_fk=True))
        assert "const warehouse = await prisma.warehouse.create(" in code
        assert "warehouse_id: warehouse.id," in code
        # The extra dep must be created before the pool entity itself.
        assert code.index("const warehouse = await prisma.warehouse.create(") < \
            code.index("await prisma.stock_pool.create(")

    def test_no_extra_fk_shape_has_no_extra_deps_machinery(self):
        """Regression guard: the pre-existing/common shape (pool has no FK beyond
        the criteria field) must render byte-identical to pre-fix output."""
        code = _render("purchase_order", _schema(lines=True, with_extra_fk=False))
        assert "warehouse" not in code
        assert "await prisma.stock_pool.create({\n    data: {\n      product_id: product.id,\n      quantity: 100,\n      creator_id: testUser.id,\n      updater_id: testUser.id,\n    },\n  });" in code


class TestReservationNolinesPoolSeedExtraFk:
    """mode: count WITHOUT lines (e.g. supply_request/supply_pool) — same
    machinery, no criteria field, so ALL of the pool entity's required FKs are
    'extra'."""

    def test_extra_fk_resolved_in_context(self):
        ctx = helper_context("purchase_order", [], _schema(lines=False, with_extra_fk=True),
                              "purchase_order", "purchase_order_detail", _entity_config())
        seed = ctx["reservation_nolines_pool_seed"]
        assert seed is not None
        assert [d["target"] for d in seed["pool_extra_deps"]] == ["warehouse"]
        assert seed["pool_extra_fk_props"] == [{"prop_name": "warehouse_id", "dep_var_name": "warehouse"}]

    def test_generated_helper_sets_extra_required_fk_column(self):
        code = _render("purchase_order", _schema(lines=False, with_extra_fk=True))
        assert "const warehouse = await prisma.warehouse.create(" in code
        assert "warehouse_id: warehouse.id," in code

    def test_no_extra_fk_yields_empty_lists(self):
        """supply_request/supply_pool's actual (live) shape — no required FK on
        the pool entity at all."""
        ctx = helper_context("purchase_order", [], _schema(lines=False, with_extra_fk=False),
                              "purchase_order", "purchase_order_detail", _entity_config())
        seed = ctx["reservation_nolines_pool_seed"]
        assert seed["pool_extra_deps"] == []
        assert seed["pool_extra_fk_props"] == []
