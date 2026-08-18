"""
Tests for cmd_602: pool_entity required FKs other than the criteria field in
the generated x-reservation test helper (test_reservation_helper.ts.jinja2).

Root cause: `_reservation_base()` only ever resolved the pool entity's
criteria-field FK (e.g. inventory.product_id → product). Any OTHER required
FK on the pool entity (e.g. inventory.location_id, added 2026-08-06 alongside
product_id) was silently omitted from createPool()'s prisma.<pool>.create()
call, so the generated helper's Prisma call failed at seed time with a
missing-required-column error — reproduced live against proj_c's
purchase_order/inventory (an earlier report has the file:line trace).

This suite injects a deviation (a pool entity with a second required FK,
itself carrying its own required FK — a two-level transitive chain) into a
minimal fixture schema, per the injected-fixture verification convention
(cmd_476): don't just assert the context dict looks right, render the actual
jinja2 template and assert the generated TypeScript sets the column.
"""
import os

import pytest
from jinja2 import Environment, FileSystemLoader

from generators_test import reservation_helper_context


def _template_env() -> Environment:
    template_dir = os.path.join(os.path.dirname(__file__), "..", "templates")
    return Environment(loader=FileSystemLoader(template_dir), keep_trailing_newline=True)


def _render(entity: str, schema: dict) -> str:
    ctx = reservation_helper_context(entity, schema, [])
    tmpl = _template_env().get_template("test_reservation_helper.ts.jinja2")
    return tmpl.render(**ctx)


def _base_defs() -> dict:
    """product (criteria FK target) + user (parent_fk_entity, implicit)."""
    return {
        "product": {
            "type": "object",
            "required": ["id", "name"],
            "properties": {
                "id": {"type": "string", "pattern": "^c[a-z0-9]{24,}$"},
                "name": {"type": "string"},
            },
        },
    }


def _po_def() -> dict:
    return {
        "type": "object",
        "required": ["id", "name"],
        "properties": {
            "id": {"type": "string", "pattern": "^c[a-z0-9]{24,}$"},
            "name": {"type": "string"},
        },
        "x-reservation": {
            "mode": "count",
            "transaction": {"strategy": "conditional_update"},
            "lines": "lines",
            "pool": {
                "entity": "stock_pool",
                "quantityField": "quantity",
                "reservedField": "reserved_quantity",
            },
            "request": {
                "quantityField": "quantity",
                "criteria": {"product_id": "product_id"},
            },
            "policy": {"orderBy": [{"id": "asc"}]},
            "result": {
                "allocationEntity": "",
                "parentField": "order_id",
                "lineField": "line_id",
                "poolField": "stock_pool_id",
                "quantityField": "quantity",
            },
        },
    }


def _schema_with_extra_fk(two_level: bool = False) -> dict:
    """stock_pool (the pool entity) requires product_id (criteria — already
    handled pre-fix) AND warehouse_id (NOT criteria — the injected deviation
    that reproduces the cmd_602 bug shape). When two_level, warehouse itself
    requires a FK to region, proving the fix's transitive-chain claim."""
    defs = _base_defs()
    defs["purchase_order"] = _po_def()
    warehouse_required = ["id", "code"]
    warehouse_props = {
        "id": {"type": "string", "pattern": "^c[a-z0-9]{24,}$"},
        "code": {"type": "string"},
    }
    if two_level:
        warehouse_required.append("region_id")
        warehouse_props["region_id"] = {
            "type": "string",
            "x-relationship": {"type": "many-to-one", "target": "region", "labelField": "name"},
        }
        defs["region"] = {
            "type": "object",
            "required": ["id", "name"],
            "properties": {
                "id": {"type": "string", "pattern": "^c[a-z0-9]{24,}$"},
                "name": {"type": "string"},
            },
        }
    defs["warehouse"] = {
        "type": "object",
        "required": warehouse_required,
        "properties": warehouse_props,
    }
    defs["stock_pool"] = {
        "type": "object",
        "required": ["id", "product_id", "warehouse_id", "quantity", "reserved_quantity"],
        "properties": {
            "id": {"type": "string", "pattern": "^c[a-z0-9]{24,}$"},
            "product_id": {
                "type": "string",
                "x-relationship": {"type": "many-to-one", "target": "product", "labelField": "name"},
            },
            "warehouse_id": {
                "type": "string",
                "x-relationship": {"type": "many-to-one", "target": "warehouse", "labelField": "code"},
            },
            "quantity": {"type": "integer", "minimum": 0},
            "reserved_quantity": {"type": "integer", "minimum": 0},
        },
    }
    return {"definitions": defs}


def _schema_no_extra_fk() -> dict:
    """stock_pool requires ONLY the criteria FK (product_id) — the
    pre-existing/common shape, must render byte-identical to pre-fix output."""
    defs = _base_defs()
    defs["purchase_order"] = _po_def()
    defs["stock_pool"] = {
        "type": "object",
        "required": ["id", "product_id", "quantity", "reserved_quantity"],
        "properties": {
            "id": {"type": "string", "pattern": "^c[a-z0-9]{24,}$"},
            "product_id": {
                "type": "string",
                "x-relationship": {"type": "many-to-one", "target": "product", "labelField": "name"},
            },
            "quantity": {"type": "integer", "minimum": 0},
            "reserved_quantity": {"type": "integer", "minimum": 0},
        },
    }
    return {"definitions": defs}


class TestPoolExtraFkDepsContext:
    def test_extra_required_fk_beyond_criteria_is_resolved(self):
        ctx = reservation_helper_context("purchase_order", _schema_with_extra_fk(), [])
        targets = [d["target"] for d in ctx["pool_extra_deps"]]
        assert targets == ["warehouse"]

    def test_extra_fk_prop_maps_to_dep_var_name(self):
        ctx = reservation_helper_context("purchase_order", _schema_with_extra_fk(), [])
        assert ctx["pool_extra_fk_props"] == [
            {"prop_name": "warehouse_id", "dep_var_name": "warehouse"}
        ]

    def test_criteria_field_target_not_duplicated_into_extra_deps(self):
        """product (the criteria target, already created via createTestProduct)
        must not also appear in pool_extra_deps."""
        ctx = reservation_helper_context("purchase_order", _schema_with_extra_fk(), [])
        assert "product" not in [d["target"] for d in ctx["pool_extra_deps"]]

    def test_transitive_fk_on_extra_dep_is_resolved(self):
        """warehouse's own required FK (region) must appear, ordered before
        warehouse (dependency-creation order)."""
        ctx = reservation_helper_context("purchase_order", _schema_with_extra_fk(two_level=True), [])
        targets = [d["target"] for d in ctx["pool_extra_deps"]]
        assert targets == ["region", "warehouse"]
        warehouse_dep = next(d for d in ctx["pool_extra_deps"] if d["target"] == "warehouse")
        assert warehouse_dep["fk_deps"] == [{"prop_name": "region_id", "dep_var_name": "region"}]

    def test_no_extra_fk_yields_empty_list(self):
        ctx = reservation_helper_context("purchase_order", _schema_no_extra_fk(), [])
        assert ctx["pool_extra_deps"] == []
        assert ctx["pool_extra_fk_props"] == []


class TestPoolExtraFkDepsRendering:
    """Render the actual jinja2 template — the assertion that matters is that
    the generated TypeScript's prisma.<pool>.create() call sets the required
    column, since that's what fails at seed time otherwise."""

    def test_generated_helper_sets_extra_required_fk_column(self):
        code = _render("purchase_order", _schema_with_extra_fk())
        assert "warehouse_id: extraDeps['warehouse'].id," in code
        assert "async function createPoolExtraDeps(" in code
        assert "extraDeps['warehouse'] = await createTestPoolWarehouse(testUser, extraDeps);" in code

    def test_generated_helper_creates_transitive_dep_before_dependent(self):
        code = _render("purchase_order", _schema_with_extra_fk(two_level=True))
        region_create_idx = code.index("extraDeps['region'] = await createTestPoolRegion")
        warehouse_create_idx = code.index("extraDeps['warehouse'] = await createTestPoolWarehouse")
        assert region_create_idx < warehouse_create_idx
        assert "region_id: extraDeps['region'].id," in code

    def test_seed_functions_pass_extra_deps_into_create_pool(self):
        code = _render("purchase_order", _schema_with_extra_fk())
        assert "const extraDeps = await createPoolExtraDeps(testUser);" in code
        assert "createPool(testUser, product.id, 100, extraDeps)" in code

    def test_no_extra_fk_shape_has_no_extra_deps_machinery(self):
        """Regression guard: entities whose pool has no extra required FK
        (the pre-existing/common case) must not gain any extraDeps plumbing —
        protects every other x-reservation consumer from unwanted diff churn."""
        code = _render("purchase_order", _schema_no_extra_fk())
        assert "extraDeps" not in code
        assert "createPoolExtraDeps" not in code
