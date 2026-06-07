"""
Tests for reservation pattern (x-reservation) Phase 1 — count mode.

Covers:
1. backward_compat: schemas without x-reservation produce identical context
2. parse:           x-reservation count mode is parsed into reservation_config correctly
3. generate:        count mode entities get an allocation phase in service output
4. field_names:     allocation phase uses the field names declared in the schema
5. item_mode_skipped: item mode is not implemented in Phase 1 (reservation_config=None)
6. validate:        x-reservation validation catches missing required fields
"""
import pytest
from build_context import build_context
from generators import service_context, _build_reservation_allocation_code
from validate import validate_schema, SchemaValidationError


# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------

def _make_schema(extra_defs: dict = None) -> dict:
    base = {
        "definitions": {
            "product": {
                "type": "object",
                "required": ["id", "name"],
                "properties": {
                    "id": {"type": "string", "pattern": "^c[a-z0-9]{24,}$"},
                    "name": {"type": "string"},
                },
            },
            "inventory": {
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
                    "lot_number": {"type": ["string", "null"]},
                    "expiration_date": {"type": ["string", "null"], "format": "date"},
                },
            },
            "inventory_allocation": {
                "type": "object",
                "required": ["id", "order_id", "line_id", "inventory_id", "quantity"],
                "properties": {
                    "id": {"type": "string", "pattern": "^c[a-z0-9]{24,}$"},
                    "order_id": {
                        "type": "string",
                        "x-relationship": {"type": "many-to-one", "target": "purchase_order", "labelField": "name"},
                    },
                    "line_id": {
                        "type": "string",
                        "x-relationship": {"type": "many-to-one", "target": "order_line", "labelField": "quantity"},
                    },
                    "inventory_id": {
                        "type": "string",
                        "x-relationship": {"type": "many-to-one", "target": "inventory", "labelField": "lot_number"},
                    },
                    "quantity": {"type": "integer", "minimum": 1},
                },
            },
            "order_line": {
                "type": "object",
                "required": ["id", "order_id", "product_id", "quantity"],
                "properties": {
                    "id": {"type": "string", "pattern": "^c[a-z0-9]{24,}$"},
                    "order_id": {
                        "type": "string",
                        "x-relationship": {"type": "many-to-one", "target": "purchase_order", "labelField": "name"},
                    },
                    "product_id": {
                        "type": "string",
                        "x-relationship": {"type": "many-to-one", "target": "product", "labelField": "name"},
                    },
                    "quantity": {"type": "integer", "minimum": 1},
                },
            },
        }
    }
    if extra_defs:
        base["definitions"].update(extra_defs)
    return base


def _po_def_no_reservation() -> dict:
    return {
        "type": "object",
        "required": ["id", "name"],
        "properties": {
            "id": {"type": "string", "pattern": "^c[a-z0-9]{24,}$"},
            "name": {"type": "string"},
        },
    }


def _po_def_with_reservation(mode: str = "count") -> dict:
    base = _po_def_no_reservation()
    base["x-reservation"] = {
        "mode": mode,
        "transaction": {"strategy": "conditional_update"},
        "lines": "lines",
        "pool": {
            "entity": "inventory",
            "quantityField": "quantity",
            "reservedField": "reserved_quantity",
        },
        "request": {
            "quantityField": "quantity",
            "criteria": {"product_id": "product_id"},
        },
        "policy": {
            "orderBy": [
                {"expiration_date": "asc_nulls_last"},
                {"id": "asc"},
            ]
        },
        "result": {
            "allocationEntity": "inventory_allocation",
            "parentField": "order_id",
            "lineField": "line_id",
            "poolField": "inventory_id",
            "quantityField": "quantity",
        },
    }
    return base


def _entity_spec(model: str, schema: dict, children: list = None, gen_cfg: dict = None) -> dict:
    return {
        "parent": model,
        "model": model,
        "definition_key": f"{model}_detail",
        "children": children or [],
        "generate_config": gen_cfg or {
            "list": True, "view": True, "new": True, "edit": True,
            "delete": True, "api": False, "test": False, "fields": None,
        },
    }


def _line_child() -> dict:
    return {
        "name": "order_line",
        "property_name": "lines",
        "output_type": "list",
        "file_type": None,
        "relationship": None,
    }


# ---------------------------------------------------------------------------
# 1. Backward compatibility
# ---------------------------------------------------------------------------

class TestBackwardCompat:
    def test_no_reservation_gives_none_config(self):
        schema = _make_schema({"purchase_order": _po_def_no_reservation()})
        entity = _entity_spec("purchase_order", schema)
        ctx = build_context(entity, schema)
        assert ctx["reservation_config"] is None

    def test_no_reservation_service_unchanged(self):
        schema = _make_schema({"purchase_order": _po_def_no_reservation()})
        entity = _entity_spec("purchase_order", schema)
        ctx = build_context(entity, schema)
        svc = service_context(ctx, schema)
        assert svc["has_reservation"] is False
        assert svc["reservation_allocation_code"] == ""
        assert "InsufficientInventoryError" not in svc["utility_code"]


# ---------------------------------------------------------------------------
# 2. Parse: x-reservation is reflected in reservation_config
# ---------------------------------------------------------------------------

class TestParse:
    def _ctx(self):
        schema = _make_schema({"purchase_order": _po_def_with_reservation()})
        entity = _entity_spec("purchase_order", schema, children=[_line_child()])
        return build_context(entity, schema)

    def test_reservation_config_not_none(self):
        assert self._ctx()["reservation_config"] is not None

    def test_mode_is_count(self):
        assert self._ctx()["reservation_config"]["mode"] == "count"

    def test_pool_entity(self):
        assert self._ctx()["reservation_config"]["pool"]["entity"] == "inventory"

    def test_pool_quantity_field(self):
        assert self._ctx()["reservation_config"]["pool"]["quantityField"] == "quantity"

    def test_lines_resolved_to_entity(self):
        ctx = self._ctx()
        # With _line_child() providing property_name="lines" → name="order_line"
        assert ctx["reservation_config"]["lines_entity"] == "order_line"

    def test_result_allocation_entity(self):
        assert self._ctx()["reservation_config"]["result"]["allocationEntity"] == "inventory_allocation"

    def test_transaction_strategy(self):
        assert self._ctx()["reservation_config"]["transaction_strategy"] == "conditional_update"


# ---------------------------------------------------------------------------
# 3. Generate: allocation phase appears in service output
# ---------------------------------------------------------------------------

class TestGenerate:
    def _svc(self):
        schema = _make_schema({"purchase_order": _po_def_with_reservation()})
        entity = _entity_spec("purchase_order", schema, children=[_line_child()])
        ctx = build_context(entity, schema)
        return service_context(ctx, schema)

    def test_has_reservation_flag(self):
        assert self._svc()["has_reservation"] is True

    def test_allocation_code_non_empty(self):
        assert self._svc()["reservation_allocation_code"] != ""

    def test_finds_reservation_lines(self):
        code = self._svc()["reservation_allocation_code"]
        assert "order_line" in code

    def test_candidates_query_uses_pool_entity(self):
        code = self._svc()["reservation_allocation_code"]
        assert "tx.inventory.findMany" in code

    def test_conditional_update_present(self):
        code = self._svc()["reservation_allocation_code"]
        assert "tx.inventory.updateMany" in code

    def test_insufficient_inventory_error_thrown(self):
        code = self._svc()["reservation_allocation_code"]
        assert "InsufficientInventoryError" in code

    def test_error_class_in_utility(self):
        svc = self._svc()
        assert "InsufficientInventoryError" in svc["utility_code"]
        assert "class InsufficientInventoryError" in svc["utility_code"]

    def test_allocation_row_created(self):
        code = self._svc()["reservation_allocation_code"]
        assert "tx.inventory_allocation.create" in code


# ---------------------------------------------------------------------------
# 4. Correct field names used in generated code
# ---------------------------------------------------------------------------

class TestFieldNames:
    def _code(self):
        schema = _make_schema({"purchase_order": _po_def_with_reservation()})
        entity = _entity_spec("purchase_order", schema, children=[_line_child()])
        ctx = build_context(entity, schema)
        svc = service_context(ctx, schema)
        return svc["reservation_allocation_code"]

    def test_pool_qty_field_in_where(self):
        assert "quantity: { gt: 0 }" in self._code()

    def test_pool_qty_decrement(self):
        assert "quantity: { decrement: _claim }" in self._code()

    def test_pool_reserved_increment(self):
        assert "reserved_quantity: { increment: _claim }" in self._code()

    def test_criteria_product_id(self):
        assert "product_id: _line.product_id" in self._code()

    def test_parent_field_in_allocation(self):
        assert "order_id: created.id" in self._code()

    def test_line_field_in_allocation(self):
        assert "line_id: _line.id" in self._code()

    def test_pool_field_in_allocation(self):
        assert "inventory_id: _candidate.id" in self._code()

    def test_order_by_asc_nulls_last(self):
        assert "nulls: 'last'" in self._code()


# ---------------------------------------------------------------------------
# 5. Item mode produces no Phase 1 reservation config
# ---------------------------------------------------------------------------

class TestItemModeSkipped:
    def test_item_mode_gives_none_config(self):
        schema = _make_schema({"room_reservation": _po_def_with_reservation(mode="item")})
        entity = _entity_spec("room_reservation", schema)
        ctx = build_context(entity, schema)
        assert ctx["reservation_config"] is None

    def test_item_mode_no_allocation_code(self):
        schema = _make_schema({"room_reservation": _po_def_with_reservation(mode="item")})
        entity = _entity_spec("room_reservation", schema)
        ctx = build_context(entity, schema)
        svc = service_context(ctx, schema)
        assert svc["has_reservation"] is False
        assert svc["reservation_allocation_code"] == ""


# ---------------------------------------------------------------------------
# 6. Validate: x-reservation schema validation
# ---------------------------------------------------------------------------

class TestValidateReservation:
    def _base_schema(self, extra_entity: dict = None) -> dict:
        defs = {
            "inventory": {
                "type": "object",
                "required": ["id"],
                "properties": {
                    "id": {"type": "string", "pattern": "^c[a-z0-9]{24,}$"},
                    "name": {"type": "string"},
                    "quantity": {"type": "integer"},
                },
            },
        }
        if extra_entity:
            defs.update(extra_entity)
        return {"definitions": defs}

    def test_valid_count_mode_passes(self):
        schema = self._base_schema({
            "po": {
                "type": "object",
                "required": ["id", "name"],
                "properties": {"id": {"type": "string", "pattern": "^c[a-z0-9]{24,}$"}, "name": {"type": "string"}},
                "x-reservation": {
                    "mode": "count",
                    "pool": {"entity": "inventory", "quantityField": "quantity"},
                    "request": {"quantityField": "quantity"},
                },
            }
        })
        validate_schema(schema)  # must not raise

    def test_invalid_mode_raises(self):
        schema = self._base_schema({
            "po": {
                "type": "object",
                "required": ["id"],
                "properties": {"id": {"type": "string"}},
                "x-reservation": {"mode": "bulk"},
            }
        })
        with pytest.raises(SchemaValidationError, match="mode must be 'count' or 'item'"):
            validate_schema(schema)

    def test_count_mode_missing_pool_entity_raises(self):
        schema = self._base_schema({
            "po": {
                "type": "object",
                "required": ["id"],
                "properties": {"id": {"type": "string"}},
                "x-reservation": {
                    "mode": "count",
                    "pool": {"quantityField": "quantity"},
                    "request": {"quantityField": "quantity"},
                },
            }
        })
        with pytest.raises(SchemaValidationError, match="pool.entity is required"):
            validate_schema(schema)

    def test_count_mode_missing_request_qty_raises(self):
        schema = self._base_schema({
            "po": {
                "type": "object",
                "required": ["id"],
                "properties": {"id": {"type": "string"}},
                "x-reservation": {
                    "mode": "count",
                    "pool": {"entity": "inventory", "quantityField": "quantity"},
                    "request": {},
                },
            }
        })
        with pytest.raises(SchemaValidationError, match="request.quantityField is required"):
            validate_schema(schema)

    def test_nonexistent_pool_entity_raises(self):
        schema = self._base_schema({
            "po": {
                "type": "object",
                "required": ["id"],
                "properties": {"id": {"type": "string"}},
                "x-reservation": {
                    "mode": "count",
                    "pool": {"entity": "nonexistent_table", "quantityField": "quantity"},
                    "request": {"quantityField": "quantity"},
                },
            }
        })
        with pytest.raises(SchemaValidationError, match="nonexistent_table.*not defined"):
            validate_schema(schema)

    def test_nonexistent_allocation_entity_raises(self):
        schema = self._base_schema({
            "po": {
                "type": "object",
                "required": ["id"],
                "properties": {"id": {"type": "string"}},
                "x-reservation": {
                    "mode": "count",
                    "pool": {"entity": "inventory", "quantityField": "quantity"},
                    "request": {"quantityField": "quantity"},
                    "result": {"allocationEntity": "missing_allocation"},
                },
            }
        })
        with pytest.raises(SchemaValidationError, match="missing_allocation.*not defined"):
            validate_schema(schema)
