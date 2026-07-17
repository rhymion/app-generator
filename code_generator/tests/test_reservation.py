"""
Tests for reservation pattern (x-reservation) Phase 1 — count mode.

Covers:
1. backward_compat: schemas without x-reservation produce identical context
2. parse:           x-reservation count mode is parsed into reservation_config correctly
3. generate:        count mode entities get an allocation phase in service output
4. field_names:     allocation phase uses the field names declared in the schema
5. item_mode_skipped: item mode is not implemented in Phase 1 (reservation_config=None)
6. validate:        x-reservation validation catches missing required fields
7. batch3_actions:  Q3 action generator — shipOrder/releaseReservation/cancelReservation
"""
import pytest
from build_context import build_context
from generators import (
    service_context,
    _build_reservation_allocation_code,
    _build_reservation_action_functions,
    get_reservation_action_routes,
)
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
        assert "InsufficientPoolCapacityError" not in svc["utility_code"]


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
        assert "InsufficientPoolCapacityError" in code

    def test_error_class_in_utility(self):
        svc = self._svc()
        assert "InsufficientPoolCapacityError" in svc["utility_code"]
        assert "class InsufficientPoolCapacityError" in svc["utility_code"]

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
# 5a. Item mode WITH lines → still Phase 3 (reservation_config=None)
# ---------------------------------------------------------------------------

class TestItemModeWithLines:
    """item+lines is reserved for Phase 3 — generator returns None config."""

    def test_item_mode_with_lines_gives_none_config(self):
        # _po_def_with_reservation(mode="item") includes lines:"lines"
        schema = _make_schema({"room_reservation": _po_def_with_reservation(mode="item")})
        entity = _entity_spec("room_reservation", schema)
        ctx = build_context(entity, schema)
        assert ctx["reservation_config"] is None

    def test_item_mode_with_lines_no_allocation_code(self):
        schema = _make_schema({"room_reservation": _po_def_with_reservation(mode="item")})
        entity = _entity_spec("room_reservation", schema)
        ctx = build_context(entity, schema)
        svc = service_context(ctx, schema)
        assert svc["has_reservation"] is False
        assert svc["reservation_allocation_code"] == ""


# ---------------------------------------------------------------------------
# 5b. Item mode WITHOUT lines → Phase 2 implemented
# ---------------------------------------------------------------------------

def _item_mode_no_lines_def(with_date_range: bool = False) -> dict:
    """Item mode schema (no lines) for hotel-style room reservation."""
    xres: dict = {
        "mode": "item",
        "pool": {
            "entity": "room",
            "statusField": "status",
            "availableStatus": 0,
            "reservedStatus": 2,
        },
        "policy": {
            "orderBy": [{"floor": "asc"}, {"id": "asc"}],
        },
        "result": {
            "allocatedField": "room_id",
        },
    }
    if with_date_range:
        xres["request"] = {
            "criteria": {"room_type_id": "room_type_id"},
            "dateRange": {"start": "check_in", "end": "check_out"},
        }
    else:
        xres["request"] = {"criteria": {"room_type_id": "room_type_id"}}
    return {
        "type": "object",
        "required": ["id", "guest_name", "room_type_id", "check_in", "check_out"],
        "x-reservation": xres,
        "properties": {
            "id": {"type": "string", "pattern": "^c[a-z0-9]{24,}$"},
            "guest_name": {"type": "string"},
            "room_type_id": {
                "type": "string",
                "x-relationship": {"type": "many-to-one", "target": "room_type", "labelField": "name"},
            },
            "room_id": {"type": ["string", "null"]},
            "check_in": {"type": "string", "format": "date"},
            "check_out": {"type": "string", "format": "date"},
        },
    }


def _room_schema(extra_defs: dict = None) -> dict:
    base = {
        "definitions": {
            "room_type": {
                "type": "object",
                "required": ["id", "name"],
                "properties": {
                    "id": {"type": "string"},
                    "name": {"type": "string"},
                },
            },
            "room": {
                "type": "object",
                "required": ["id", "room_no", "status"],
                "properties": {
                    "id": {"type": "string"},
                    "room_no": {"type": "string"},
                    "floor": {"type": "integer"},
                    "room_type_id": {
                        "type": "string",
                        "x-relationship": {"type": "many-to-one", "target": "room_type", "labelField": "name"},
                    },
                    "status": {"type": "integer", "minimum": 0, "maximum": 2},
                },
            },
        }
    }
    if extra_defs:
        base["definitions"].update(extra_defs)
    return base


class TestItemModePhase2:
    """Item mode without lines: Phase 2 — reservation_config is populated."""

    def _ctx(self, with_date_range: bool = False):
        schema = _room_schema({"room_reservation": _item_mode_no_lines_def(with_date_range)})
        entity = _entity_spec("room_reservation", schema)
        return build_context(entity, schema)

    def test_item_mode_config_not_none(self):
        assert self._ctx()["reservation_config"] is not None

    def test_mode_is_item(self):
        assert self._ctx()["reservation_config"]["mode"] == "item"

    def test_status_field(self):
        assert self._ctx()["reservation_config"]["statusField"] == "status"

    def test_available_status(self):
        assert self._ctx()["reservation_config"]["availableStatus"] == 0

    def test_reserved_status(self):
        assert self._ctx()["reservation_config"]["reservedStatus"] == 2

    def test_available_status_ts_integer(self):
        assert self._ctx()["reservation_config"]["available_status_ts"] == "0"

    def test_reserved_status_ts_integer(self):
        assert self._ctx()["reservation_config"]["reserved_status_ts"] == "2"

    def test_allocated_field(self):
        assert self._ctx()["reservation_config"]["allocatedField"] == "room_id"

    def test_has_lines_false(self):
        assert self._ctx()["reservation_config"]["hasLines"] is False

    def test_no_date_range_when_absent(self):
        assert "dateRange" not in self._ctx()["reservation_config"]

    def test_date_range_when_present(self):
        ctx = self._ctx(with_date_range=True)
        dr = ctx["reservation_config"]["dateRange"]
        assert dr["startField"] == "check_in"
        assert dr["endField"] == "check_out"

    def test_reservation_alias_equals_config(self):
        ctx = self._ctx()
        assert ctx["reservation"] is ctx["reservation_config"]

    def test_has_reservation_false_for_item_mode(self):
        """has_reservation flag stays False for item mode (count mode flag)."""
        ctx = self._ctx()
        svc = service_context(ctx)
        assert svc["has_reservation"] is False

    def test_has_item_reservation_true(self):
        ctx = self._ctx()
        svc = service_context(ctx)
        assert svc["has_item_reservation"] is True

    def test_no_count_allocation_code_in_item_mode(self):
        ctx = self._ctx()
        svc = service_context(ctx)
        assert svc["reservation_allocation_code"] == ""

    def test_prisma_import_in_utility_code(self):
        ctx = self._ctx()
        svc = service_context(ctx)
        assert "import { Prisma } from '@/app/generated/prisma/client'" in svc["utility_code"]

    def test_pool_entity_in_transaction_client_type(self):
        ctx = self._ctx()
        svc = service_context(ctx)
        assert "| 'room'" in svc["utility_code"]

    def test_insufficient_inventory_error_exported_for_item_mode(self):
        """InsufficientPoolCapacityError must be exported so api_route.ts can import it."""
        ctx = self._ctx()
        svc = service_context(ctx)
        assert "export class InsufficientPoolCapacityError" in svc["utility_code"]

    def test_reservation_mutation_error_not_exported_for_item_mode(self):
        """ReservationMutationError is count-mode-only and must NOT be in item mode service."""
        ctx = self._ctx()
        svc = service_context(ctx)
        assert "export class ReservationMutationError" not in svc["utility_code"]


# ---------------------------------------------------------------------------
# 5c. Count mode without lines (④A)
# ---------------------------------------------------------------------------

class TestCountModeNoLines:
    """count mode without lines: hasLines=False + selfQuantityField."""

    def _def(self) -> dict:
        return {
            "type": "object",
            "required": ["id", "quantity"],
            "properties": {
                "id": {"type": "string"},
                "quantity": {"type": "integer"},
            },
            "x-reservation": {
                "mode": "count",
                "pool": {
                    "entity": "inventory",
                    "quantityField": "quantity",
                    "reservedField": "reserved_quantity",
                },
                "request": {"quantityField": "quantity"},
                "result": {
                    "allocationEntity": "inventory_allocation",
                    "parentField": "order_id",
                },
            },
        }

    def _ctx(self):
        schema = _make_schema({"simple_order": self._def()})
        entity = _entity_spec("simple_order", schema)
        return build_context(entity, schema)

    def test_has_lines_false(self):
        assert self._ctx()["reservation_config"]["hasLines"] is False

    def test_self_quantity_field(self):
        assert self._ctx()["reservation_config"]["selfQuantityField"] == "quantity"

    def test_has_reservation_true(self):
        ctx = self._ctx()
        svc = service_context(ctx, _make_schema({"simple_order": self._def()}))
        assert svc["has_reservation"] is True

    def test_allocation_code_non_empty(self):
        ctx = self._ctx()
        svc = service_context(ctx, _make_schema({"simple_order": self._def()}))
        assert svc["reservation_allocation_code"] != ""

    def test_allocation_code_uses_created_as_line(self):
        ctx = self._ctx()
        svc = service_context(ctx, _make_schema({"simple_order": self._def()}))
        # ④A: count mode without lines — allocates directly from created.quantity
        assert 'let _remaining = ' in svc["reservation_allocation_code"]


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
                    "reserved_qty": {"type": "integer"},
                },
            },
            "inventory_allocation": {
                "type": "object",
                "required": ["id"],
                "properties": {
                    "id": {"type": "string", "pattern": "^c[a-z0-9]{24,}$"},
                },
            },
        }
        if extra_entity:
            defs.update(extra_entity)
        return {"definitions": defs}

    def test_valid_count_mode_passes(self):
        # (C) count + lines omitted: request.quantityField on entity, no lineField required
        schema = self._base_schema({
            "po": {
                "type": "object",
                "required": ["id", "name"],
                "properties": {
                    "id": {"type": "string", "pattern": "^c[a-z0-9]{24,}$"},
                    "name": {"type": "string"},
                    "quantity": {"type": "integer"},
                },
                "x-reservation": {
                    "mode": "count",
                    "pool": {
                        "entity": "inventory",
                        "quantityField": "quantity",
                        "reservedField": "reserved_qty",
                    },
                    "request": {"quantityField": "quantity"},
                    "result": {
                        "allocationEntity": "inventory_allocation",
                        "parentField": "po_id",
                    },
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


# ---------------------------------------------------------------------------
# 7. Mode × lines assumption matrix validation (count/item × lines/no-lines)
# ---------------------------------------------------------------------------

class TestValidateReservationMatrix:
    """Validates the mode × lines assumption matrix (A/B/C/D cells)."""

    def _base_schema(self, extra_entity: dict = None) -> dict:
        defs = {
            "inventory": {
                "type": "object",
                "required": ["id"],
                "properties": {
                    "id": {"type": "string", "pattern": "^c[a-z0-9]{24,}$"},
                    "quantity": {"type": "integer"},
                    "reserved_qty": {"type": "integer"},
                },
            },
            "inventory_allocation": {
                "type": "object",
                "required": ["id"],
                "properties": {"id": {"type": "string", "pattern": "^c[a-z0-9]{24,}$"}},
            },
        }
        if extra_entity:
            defs.update(extra_entity)
        return {"definitions": defs}

    # -----------------------------------------------------------------------
    # Normal cases
    # -----------------------------------------------------------------------

    def test_count_no_lines_passes(self):
        # (C) count + lines omitted: request.quantityField on entity, lineField optional
        schema = self._base_schema({
            "booking": {
                "type": "object",
                "required": ["id"],
                "properties": {
                    "id": {"type": "string"},
                    "quantity": {"type": "integer"},
                },
                "x-reservation": {
                    "mode": "count",
                    "pool": {
                        "entity": "inventory",
                        "quantityField": "quantity",
                        "reservedField": "reserved_qty",
                    },
                    "request": {"quantityField": "quantity"},
                    "result": {
                        "allocationEntity": "inventory_allocation",
                        "parentField": "booking_id",
                    },
                },
            }
        })
        validate_schema(schema)  # must not raise

    def test_count_with_lines_passes(self):
        # (D) count + lines specified: result.lineField required and present
        schema = self._base_schema({
            "po": {
                "type": "object",
                "required": ["id"],
                "properties": {"id": {"type": "string"}},
                "x-reservation": {
                    "mode": "count",
                    "lines": "items",
                    "pool": {
                        "entity": "inventory",
                        "quantityField": "quantity",
                        "reservedField": "reserved_qty",
                    },
                    "request": {"quantityField": "quantity"},
                    "result": {
                        "allocationEntity": "inventory_allocation",
                        "parentField": "po_id",
                        "lineField": "line_id",
                    },
                },
            }
        })
        validate_schema(schema)  # must not raise

    def test_item_no_lines_passes(self):
        # (A) item + lines omitted: result.allocatedField required and present
        schema = self._base_schema({
            "room_res": {
                "type": "object",
                "required": ["id"],
                "properties": {
                    "id": {"type": "string"},
                    "room_id": {"type": ["string", "null"]},
                },
                "x-reservation": {
                    "mode": "item",
                    "pool": {"entity": "inventory"},
                    "result": {"allocatedField": "room_id"},
                },
            }
        })
        validate_schema(schema)  # must not raise

    # -----------------------------------------------------------------------
    # Error cases — required fields
    # -----------------------------------------------------------------------

    def test_count_mode_missing_reserved_field_raises(self):
        schema = self._base_schema({
            "po": {
                "type": "object",
                "required": ["id"],
                "properties": {"id": {"type": "string"}, "quantity": {"type": "integer"}},
                "x-reservation": {
                    "mode": "count",
                    "pool": {"entity": "inventory", "quantityField": "quantity"},
                    "request": {"quantityField": "quantity"},
                    "result": {
                        "allocationEntity": "inventory_allocation",
                        "parentField": "po_id",
                    },
                },
            }
        })
        with pytest.raises(SchemaValidationError, match="reservedField is required"):
            validate_schema(schema)

    def test_count_mode_missing_alloc_entity_raises(self):
        schema = self._base_schema({
            "po": {
                "type": "object",
                "required": ["id"],
                "properties": {"id": {"type": "string"}, "quantity": {"type": "integer"}},
                "x-reservation": {
                    "mode": "count",
                    "pool": {
                        "entity": "inventory",
                        "quantityField": "quantity",
                        "reservedField": "reserved_qty",
                    },
                    "request": {"quantityField": "quantity"},
                    "result": {"parentField": "po_id"},
                },
            }
        })
        with pytest.raises(SchemaValidationError, match="allocationEntity is required"):
            validate_schema(schema)

    def test_count_mode_missing_parent_field_raises(self):
        schema = self._base_schema({
            "po": {
                "type": "object",
                "required": ["id"],
                "properties": {"id": {"type": "string"}, "quantity": {"type": "integer"}},
                "x-reservation": {
                    "mode": "count",
                    "pool": {
                        "entity": "inventory",
                        "quantityField": "quantity",
                        "reservedField": "reserved_qty",
                    },
                    "request": {"quantityField": "quantity"},
                    "result": {"allocationEntity": "inventory_allocation"},
                },
            }
        })
        with pytest.raises(SchemaValidationError, match="parentField is required"):
            validate_schema(schema)

    # -----------------------------------------------------------------------
    # Error cases — mode × lines matrix
    # -----------------------------------------------------------------------

    def test_item_with_lines_raises(self):
        # (B) item + lines specified → Phase 2 reserved
        schema = self._base_schema({
            "room_res": {
                "type": "object",
                "required": ["id"],
                "properties": {"id": {"type": "string"}, "room_id": {"type": ["string", "null"]}},
                "x-reservation": {
                    "mode": "item",
                    "lines": "items",
                    "pool": {"entity": "inventory"},
                    "result": {"allocatedField": "room_id"},
                },
            }
        })
        with pytest.raises(SchemaValidationError, match="item mode with 'lines' is reserved for Phase 2"):
            validate_schema(schema)

    def test_item_no_lines_missing_allocated_field_raises(self):
        # (A) item + lines omitted but result.allocatedField missing
        schema = self._base_schema({
            "room_res": {
                "type": "object",
                "required": ["id"],
                "properties": {"id": {"type": "string"}},
                "x-reservation": {
                    "mode": "item",
                    "pool": {"entity": "inventory"},
                    "result": {},
                },
            }
        })
        with pytest.raises(SchemaValidationError, match="allocatedField is required"):
            validate_schema(schema)

    def test_count_with_lines_missing_line_field_raises(self):
        # (D) count + lines specified but result.lineField missing
        schema = self._base_schema({
            "po": {
                "type": "object",
                "required": ["id"],
                "properties": {"id": {"type": "string"}},
                "x-reservation": {
                    "mode": "count",
                    "lines": "items",
                    "pool": {
                        "entity": "inventory",
                        "quantityField": "quantity",
                        "reservedField": "reserved_qty",
                    },
                    "request": {"quantityField": "quantity"},
                    "result": {
                        "allocationEntity": "inventory_allocation",
                        "parentField": "po_id",
                    },
                },
            }
        })
        with pytest.raises(SchemaValidationError, match="lineField is required"):
            validate_schema(schema)

    def test_lines_dict_entity_not_in_schema_raises(self):
        # lines specified as dict with nonexistent entity
        schema = self._base_schema({
            "po": {
                "type": "object",
                "required": ["id"],
                "properties": {"id": {"type": "string"}},
                "x-reservation": {
                    "mode": "count",
                    "lines": {"entity": "nonexistent_lines_entity", "field": "order_id"},
                    "pool": {
                        "entity": "inventory",
                        "quantityField": "quantity",
                        "reservedField": "reserved_qty",
                    },
                    "request": {"quantityField": "quantity"},
                    "result": {
                        "allocationEntity": "inventory_allocation",
                        "parentField": "po_id",
                        "lineField": "line_id",
                    },
                },
            }
        })
        with pytest.raises(SchemaValidationError, match="nonexistent_lines_entity.*not defined"):
            validate_schema(schema)


# ---------------------------------------------------------------------------
# 8. Overlap availability mode (Q2)
# ---------------------------------------------------------------------------

def _overlap_mode_def(include_exclude_statuses: bool = False) -> dict:
    """Item mode schema with availabilitySource: overlap."""
    xres: dict = {
        "mode": "item",
        "pool": {
            "entity": "room",
            "statusField": "status",
            "availableStatus": 0,
            "reservedStatus": 2,
        },
        "request": {
            "criteria": {"room_type_id": "room_type_id"},
            "dateRange": {"start": "check_in", "end": "check_out"},
        },
        "policy": {
            "availabilitySource": "overlap",
            "updatePoolStatusOnReserve": False,
            "orderBy": [{"floor": "asc"}, {"id": "asc"}],
        },
        "result": {
            "allocatedField": "room_id",
        },
    }
    if include_exclude_statuses:
        xres["policy"]["excludePoolStatuses"] = [1]
    return {
        "type": "object",
        "required": ["id", "guest_name", "room_type_id", "check_in", "check_out"],
        "x-reservation": xres,
        "properties": {
            "id": {"type": "string", "pattern": "^c[a-z0-9]{24,}$"},
            "guest_name": {"type": "string"},
            "room_type_id": {
                "type": "string",
                "x-relationship": {"type": "many-to-one", "target": "room_type", "labelField": "name"},
            },
            "room_id": {"type": ["string", "null"]},
            "check_in": {"type": "string", "format": "date"},
            "check_out": {"type": "string", "format": "date"},
        },
    }


class TestItemModeOverlapAvailability:
    """Q2: overlap availability mode — assertNoDuplicateReservation used, status update suppressed."""

    def _ctx(self, include_exclude_statuses: bool = False):
        schema = _room_schema({"room_reservation": _overlap_mode_def(include_exclude_statuses)})
        entity = _entity_spec("room_reservation", schema)
        return build_context(entity, schema)

    def _svc(self, include_exclude_statuses: bool = False):
        schema = _room_schema({"room_reservation": _overlap_mode_def(include_exclude_statuses)})
        entity = _entity_spec("room_reservation", schema)
        ctx = build_context(entity, schema)
        return service_context(ctx, schema)

    # --- Context parsing ---

    def test_uses_overlap_availability_true(self):
        assert self._ctx()["reservation_config"]["usesOverlapAvailability"] is True

    def test_updates_pool_status_false(self):
        assert self._ctx()["reservation_config"]["updatesPoolStatusOnReserve"] is False

    def test_exclude_pool_statuses_empty_by_default(self):
        assert self._ctx()["reservation_config"]["excludePoolStatuses"] == []

    def test_exclude_pool_statuses_populated(self):
        assert self._ctx(include_exclude_statuses=True)["reservation_config"]["excludePoolStatuses"] == [1]

    # --- Generated service code ---

    def _service_code(self, include_exclude_statuses: bool = False) -> str:
        from jinja2 import Environment, FileSystemLoader
        import os
        schema = _room_schema({"room_reservation": _overlap_mode_def(include_exclude_statuses)})
        entity = _entity_spec("room_reservation", schema)
        ctx = build_context(entity, schema)
        svc_ctx = service_context(ctx, schema)
        template_dir = os.path.join(os.path.dirname(__file__), "..", "templates")
        env = Environment(loader=FileSystemLoader(template_dir), keep_trailing_newline=True)
        tmpl = env.get_template("service.ts.jinja2")
        return tmpl.render({**ctx, **svc_ctx})

    def test_status_update_suppressed_in_overlap_mode(self):
        code = self._service_code()
        assert "data: { status:" not in code

    def test_assert_no_duplicate_reservation_present(self):
        code = self._service_code()
        assert "assertNoDuplicateReservation" in code

    def test_find_many_used_in_overlap_mode(self):
        code = self._service_code()
        assert "findMany" in code

    def test_not_in_filter_when_exclude_statuses_set(self):
        code = self._service_code(include_exclude_statuses=True)
        assert "notIn" in code

    def test_no_not_in_filter_when_exclude_statuses_empty(self):
        code = self._service_code(include_exclude_statuses=False)
        assert "notIn" not in code

    # --- Status mode backward compatibility ---

    def test_status_mode_still_updates_pool_status(self):
        """Status mode (no availabilitySource) must still emit pool status update."""
        schema = _room_schema({"room_reservation": _item_mode_no_lines_def(with_date_range=True)})
        entity = _entity_spec("room_reservation", schema)
        ctx = build_context(entity, schema)
        svc_ctx = service_context(ctx, schema)
        from jinja2 import Environment, FileSystemLoader
        import os
        template_dir = os.path.join(os.path.dirname(__file__), "..", "templates")
        env = Environment(loader=FileSystemLoader(template_dir), keep_trailing_newline=True)
        tmpl = env.get_template("service.ts.jinja2")
        code = tmpl.render({**ctx, **svc_ctx})
        assert "data: { status:" in code

    def test_status_mode_uses_overlap_false(self):
        schema = _room_schema({"room_reservation": _item_mode_no_lines_def()})
        entity = _entity_spec("room_reservation", schema)
        ctx = build_context(entity, schema)
        assert ctx["reservation_config"]["usesOverlapAvailability"] is False

    def test_status_mode_updates_pool_true(self):
        schema = _room_schema({"room_reservation": _item_mode_no_lines_def()})
        entity = _entity_spec("room_reservation", schema)
        ctx = build_context(entity, schema)
        assert ctx["reservation_config"]["updatesPoolStatusOnReserve"] is True

    # --- Validation ---

    def test_overlap_without_date_range_raises(self):
        schema = _room_schema({
            "room_reservation": {
                "type": "object",
                "required": ["id"],
                "properties": {"id": {"type": "string"}, "room_id": {"type": ["string", "null"]}},
                "x-reservation": {
                    "mode": "item",
                    "pool": {"entity": "room"},
                    "request": {"criteria": {"room_type_id": "room_type_id"}},
                    "policy": {"availabilitySource": "overlap"},
                    "result": {"allocatedField": "room_id"},
                },
            }
        })
        with pytest.raises(SchemaValidationError, match="dateRange"):
            validate_schema(schema)

    def test_exclude_pool_statuses_non_integer_raises(self):
        schema = _room_schema({
            "room_reservation": {
                "type": "object",
                "required": ["id"],
                "properties": {"id": {"type": "string"}, "room_id": {"type": ["string", "null"]}},
                "x-reservation": {
                    "mode": "item",
                    "pool": {"entity": "room"},
                    "request": {
                        "criteria": {"room_type_id": "room_type_id", "dateRange": {"start": "check_in", "end": "check_out"}},
                    },
                    "policy": {
                        "availabilitySource": "overlap",
                        "excludePoolStatuses": ["maintenance"],
                    },
                    "result": {"allocatedField": "room_id"},
                },
            }
        })
        with pytest.raises(SchemaValidationError, match="integers"):
            validate_schema(schema)

    def test_start_end_check_is_before_find_many_in_generated_code(self):
        """start >= end validation must appear before candidates findMany (not inside try/catch)."""
        code = self._service_code(include_exclude_statuses=True)
        pos_start_check = code.find('Start date must be before end date')
        pos_find_many = code.find('findMany')
        assert pos_start_check != -1, "Start date check not found in generated code"
        assert pos_find_many != -1, "findMany not found in generated code"
        assert pos_start_check < pos_find_many, (
            "start >= end check must appear before findMany, but findMany comes first"
        )

    def test_start_end_error_not_wrapped_in_insufficient_inventory(self):
        """start >= end must NOT be swallowed into InsufficientPoolCapacityError."""
        code = self._service_code()
        # The start/end check must come before the for-loop try/catch block.
        # Verify: 'Start date must be before end date' appears before 'for (const candidate'
        pos_start_check = code.find('Start date must be before end date')
        pos_for_loop = code.find('for (const candidate')
        assert pos_start_check != -1, "Start date check not found in generated code"
        assert pos_for_loop != -1, "candidate loop not found in generated code"
        assert pos_start_check < pos_for_loop, (
            "start >= end check must be before the candidates loop to avoid being swallowed"
        )


# ---------------------------------------------------------------------------
# 7. Batch3: Q3 action generator tests
# ---------------------------------------------------------------------------

def _make_actions_schema() -> dict:
    """Schema with inventory_allocation having remaining_quantity + status fields."""
    schema = _make_schema()
    # Extend inventory_allocation with Batch3 fields
    schema["definitions"]["inventory_allocation"]["required"] += [
        "remaining_quantity", "status"
    ]
    schema["definitions"]["inventory_allocation"]["properties"]["remaining_quantity"] = {
        "type": "integer", "minimum": 0
    }
    schema["definitions"]["inventory_allocation"]["properties"]["status"] = {
        "type": "string",
        "enum": ["reserved", "partially_shipped", "shipped", "released", "cancelled"],
    }
    return schema


def _po_def_with_actions() -> dict:
    base = _po_def_no_reservation()
    base["x-reservation"] = {
        "mode": "count",
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
        "result": {
            "allocationEntity": "inventory_allocation",
            "parentField": "order_id",
            "lineField": "line_id",
            "poolField": "inventory_id",
            "quantityField": "quantity",
        },
        "actions": {
            "shipOrder": {
                "type": "ship",
                "allocationEntity": "inventory_allocation",
                "quantityField": "quantity",
                "remainingField": "remaining_quantity",
                "statusField": "status",
                "openStatuses": ["reserved", "partially_shipped"],
                "doneStatus": "shipped",
            },
            "releaseReservation": {
                "type": "release",
                "allocationEntity": "inventory_allocation",
                "quantityField": "quantity",
                "remainingField": "remaining_quantity",
                "statusField": "status",
                "openStatuses": ["reserved", "partially_shipped"],
                "doneStatus": "released",
            },
            "cancelReservation": {
                "type": "cancel",
                "allocationEntity": "inventory_allocation",
                "quantityField": "quantity",
                "remainingField": "remaining_quantity",
                "statusField": "status",
                "openStatuses": ["reserved", "partially_shipped"],
                "doneStatus": "cancelled",
            },
        },
    }
    return base


def _actions_ctx():
    schema = _make_actions_schema()
    schema["definitions"]["purchase_order"] = _po_def_with_actions()
    entity = _entity_spec("purchase_order", schema, children=[_line_child()])
    return build_context(entity, schema)


class TestBatch3ActionsParse:
    """Verify build_context.py parses x-reservation.actions correctly."""

    def test_has_actions_true(self):
        ctx = _actions_ctx()
        rc = ctx["reservation_config"]
        assert rc is not None
        assert rc.get("has_actions") is True

    def test_reservation_actions_list_length(self):
        rc = _actions_ctx()["reservation_config"]
        assert len(rc["reservation_actions"]) == 3

    def test_action_names(self):
        rc = _actions_ctx()["reservation_config"]
        names = [a["name"] for a in rc["reservation_actions"]]
        assert "shipOrder" in names
        assert "releaseReservation" in names
        assert "cancelReservation" in names

    def test_action_types(self):
        rc = _actions_ctx()["reservation_config"]
        by_name = {a["name"]: a for a in rc["reservation_actions"]}
        assert by_name["shipOrder"]["type"] == "ship"
        assert by_name["releaseReservation"]["type"] == "release"
        assert by_name["cancelReservation"]["type"] == "cancel"

    def test_action_remaining_field(self):
        rc = _actions_ctx()["reservation_config"]
        by_name = {a["name"]: a for a in rc["reservation_actions"]}
        assert by_name["shipOrder"]["remainingField"] == "remaining_quantity"

    def test_action_status_field(self):
        rc = _actions_ctx()["reservation_config"]
        by_name = {a["name"]: a for a in rc["reservation_actions"]}
        assert by_name["shipOrder"]["statusField"] == "status"

    def test_action_open_statuses(self):
        rc = _actions_ctx()["reservation_config"]
        by_name = {a["name"]: a for a in rc["reservation_actions"]}
        assert by_name["shipOrder"]["openStatuses"] == ["reserved", "partially_shipped"]

    def test_action_done_status(self):
        rc = _actions_ctx()["reservation_config"]
        by_name = {a["name"]: a for a in rc["reservation_actions"]}
        assert by_name["cancelReservation"]["doneStatus"] == "cancelled"

    def test_actions_remaining_field_shortcut(self):
        rc = _actions_ctx()["reservation_config"]
        assert rc.get("actions_remaining_field") == "remaining_quantity"

    def test_actions_status_field_shortcut(self):
        rc = _actions_ctx()["reservation_config"]
        assert rc.get("actions_status_field") == "status"

    def test_actions_initial_status(self):
        rc = _actions_ctx()["reservation_config"]
        assert rc.get("actions_initial_status") == "reserved"

    def test_no_actions_has_actions_false(self):
        schema = _make_schema({"purchase_order": _po_def_with_reservation()})
        entity = _entity_spec("purchase_order", schema, children=[_line_child()])
        ctx = build_context(entity, schema)
        rc = ctx["reservation_config"]
        assert rc.get("has_actions") is False


class TestBatch3ActionsValidate:
    """Verify validate.py catches invalid action configurations."""

    def _schema_with_action_override(self, action_override: dict) -> dict:
        schema = _make_actions_schema()
        po = _po_def_with_actions()
        po["x-reservation"]["actions"].update(action_override)
        schema["definitions"]["purchase_order"] = po
        return schema

    def test_valid_schema_passes(self):
        schema = _make_actions_schema()
        schema["definitions"]["purchase_order"] = _po_def_with_actions()
        validate_schema(schema)  # must not raise

    def test_invalid_action_type_raises(self):
        schema = _make_actions_schema()
        po = _po_def_with_actions()
        po["x-reservation"]["actions"]["shipOrder"]["type"] = "explode"
        schema["definitions"]["purchase_order"] = po
        with pytest.raises(SchemaValidationError, match="type"):
            validate_schema(schema)

    def test_invalid_action_name_raises(self):
        schema = _make_actions_schema()
        po = _po_def_with_actions()
        po["x-reservation"]["actions"]["123invalid"] = {
            "type": "ship",
            "allocationEntity": "inventory_allocation",
            "remainingField": "remaining_quantity",
            "statusField": "status",
        }
        schema["definitions"]["purchase_order"] = po
        with pytest.raises(SchemaValidationError, match="identifier"):
            validate_schema(schema)

    def test_missing_allocation_entity_raises(self):
        schema = _make_actions_schema()
        po = _po_def_with_actions()
        po["x-reservation"]["actions"]["shipOrder"]["allocationEntity"] = "nonexistent_entity"
        # Remove from result so fallback also fails
        po["x-reservation"]["result"].pop("allocationEntity", None)
        schema["definitions"]["purchase_order"] = po
        with pytest.raises(SchemaValidationError, match="allocationEntity"):
            validate_schema(schema)

    def test_missing_remaining_field_raises(self):
        schema = _make_actions_schema()
        po = _po_def_with_actions()
        for act in po["x-reservation"]["actions"].values():
            act["remainingField"] = "nonexistent_remaining"
        schema["definitions"]["purchase_order"] = po
        with pytest.raises(SchemaValidationError, match="remainingField"):
            validate_schema(schema)

    def test_missing_status_field_raises(self):
        schema = _make_actions_schema()
        po = _po_def_with_actions()
        for act in po["x-reservation"]["actions"].values():
            act["statusField"] = "nonexistent_status"
        schema["definitions"]["purchase_order"] = po
        with pytest.raises(SchemaValidationError, match="statusField"):
            validate_schema(schema)


class TestBatch3AllocationCreateStatus:
    """Verify allocation create block emits remaining_quantity and status when has_actions."""

    def _alloc_code(self):
        rc = _actions_ctx()["reservation_config"]
        return _build_reservation_allocation_code(rc, "purchase_order")

    def test_remaining_quantity_in_alloc_create(self):
        code = self._alloc_code()
        assert "remaining_quantity" in code, "remaining_quantity must be in allocation create"

    def test_status_reserved_in_alloc_create(self):
        code = self._alloc_code()
        assert "'reserved'" in code, "status: 'reserved' must be in allocation create"

    def test_no_remaining_quantity_without_actions(self):
        schema = _make_schema({"purchase_order": _po_def_with_reservation()})
        entity = _entity_spec("purchase_order", schema, children=[_line_child()])
        ctx = build_context(entity, schema)
        rc = ctx["reservation_config"]
        code = _build_reservation_allocation_code(rc, "purchase_order")
        assert "remaining_quantity" not in code, (
            "remaining_quantity must NOT appear when has_actions is False"
        )


class TestBatch3ActionFunctions:
    """Verify _build_reservation_action_functions generates correct TypeScript."""

    def _action_code(self):
        rc = _actions_ctx()["reservation_config"]
        return _build_reservation_action_functions(rc, "purchase_order")

    def test_ship_order_function_exists(self):
        code = self._action_code()
        assert "shipOrder" in code

    def test_release_reservation_function_exists(self):
        code = self._action_code()
        assert "releaseReservation" in code

    def test_cancel_reservation_function_exists(self):
        code = self._action_code()
        assert "cancelReservation" in code

    def test_reserved_quantity_decrement_in_ship(self):
        code = self._action_code()
        assert "reserved_quantity" in code
        assert "decrement" in code

    def test_quantity_increment_in_release(self):
        code = self._action_code()
        assert "increment" in code

    def test_done_status_shipped_in_ship(self):
        code = self._action_code()
        assert "'shipped'" in code

    def test_done_status_released_in_release(self):
        code = self._action_code()
        assert "'released'" in code

    def test_done_status_cancelled_in_cancel(self):
        code = self._action_code()
        assert "'cancelled'" in code

    def test_serializable_transaction(self):
        code = self._action_code()
        assert "Serializable" in code

    def test_open_statuses_filter_in_ship(self):
        code = self._action_code()
        assert "'reserved'" in code
        assert "'partially_shipped'" in code

    def test_no_actions_returns_empty(self):
        schema = _make_schema({"purchase_order": _po_def_with_reservation()})
        entity = _entity_spec("purchase_order", schema, children=[_line_child()])
        ctx = build_context(entity, schema)
        rc = ctx["reservation_config"]
        code = _build_reservation_action_functions(rc, "purchase_order")
        assert code == ""

    def test_service_context_includes_action_code(self):
        schema = _make_actions_schema()
        schema["definitions"]["purchase_order"] = _po_def_with_actions()
        entity = _entity_spec("purchase_order", schema, children=[_line_child()])
        ctx = build_context(entity, schema)
        svc = service_context(ctx, schema)
        assert "reservation_actions_code" in svc
        assert "shipOrder" in svc["reservation_actions_code"]


class TestBatch3ActionRoutes:
    """Verify get_reservation_action_routes generates valid POST handler content."""

    def _routes(self):
        rc = _actions_ctx()["reservation_config"]
        return get_reservation_action_routes(rc, "purchase_order")

    def test_three_routes_generated(self):
        routes = self._routes()
        assert len(routes) == 3

    def test_route_types(self):
        routes = self._routes()
        types = {r["act_type"] for r in routes}
        assert types == {"ship", "release", "cancel"}

    def test_route_names(self):
        routes = self._routes()
        names = {r["act_name"] for r in routes}
        assert names == {"shipOrder", "releaseReservation", "cancelReservation"}

    def test_route_has_post_handler(self):
        for route in self._routes():
            assert "export async function POST" in route["code"], (
                f"Route {route['act_name']} missing POST handler"
            )

    def test_ship_route_imports_ship_order(self):
        routes = self._routes()
        ship = next(r for r in routes if r["act_type"] == "ship")
        assert "shipOrder" in ship["code"]

    def test_cancel_route_no_qty_param(self):
        routes = self._routes()
        cancel = next(r for r in routes if r["act_type"] == "cancel")
        assert "requestedQty" not in cancel["code"]
        assert "releaseQty" not in cancel["code"]

    def test_release_route_has_qty_param(self):
        routes = self._routes()
        release = next(r for r in routes if r["act_type"] == "release")
        assert "releaseQty" in release["code"]

    def test_ship_route_has_qty_param(self):
        routes = self._routes()
        ship = next(r for r in routes if r["act_type"] == "ship")
        assert "requestedQty" in ship["code"]


class TestBatch4ActionButtonsTemplate:
    """Verify action_buttons.tsx.jinja2 renders ReservationActionButtons component."""

    def _rendered(self) -> str:
        from jinja2 import Environment, FileSystemLoader
        from helpers.naming import to_pascal_case
        import os
        schema = _make_actions_schema()
        schema["definitions"]["purchase_order"] = _po_def_with_actions()
        entity = _entity_spec("purchase_order", schema, children=[_line_child()])
        ctx = build_context(entity, schema)
        template_dir = os.path.join(os.path.dirname(__file__), "..", "templates")
        env = Environment(loader=FileSystemLoader(template_dir), keep_trailing_newline=True)
        env.filters["pascal_case"] = to_pascal_case
        tmpl = env.get_template("action_buttons.tsx.jinja2")
        return tmpl.render(ctx)

    def test_reservation_action_buttons_exported(self):
        assert "ReservationActionButtons" in self._rendered()

    def test_handle_ship_order_present(self):
        assert "handleShipOrder" in self._rendered()

    def test_handle_release_reservation_present(self):
        assert "handleReleaseReservation" in self._rendered()

    def test_handle_cancel_reservation_present(self):
        assert "handleCancelReservation" in self._rendered()

    def test_use_client_directive(self):
        assert "'use client'" in self._rendered()

    def test_loading_state(self):
        assert "useState" in self._rendered()

    def test_fetch_ship_route(self):
        assert "/actions/ship" in self._rendered()

    def test_fetch_release_route(self):
        assert "/actions/release" in self._rendered()

    def test_fetch_cancel_route(self):
        assert "/actions/cancel" in self._rendered()


# ---------------------------------------------------------------------------
# G11 (cmd_281 B-5 Phase2b): strategy: ledger_transaction — reserve/ship/cancel
# quantity invariant (O-4: reserved_quantity = SUM(reserved_delta), quantity =
# SUM(quantity_delta); reserve/cancel never touch quantity, ship touches both).
#
# The reserve path is generated by _build_reservation_allocation_code (via the
# ledger_transaction branch); ship/cancel are NOT code-generated — they're
# hand-implemented once-stub files (lib/purchase_per_item/service_after_approve.ts
# and service_after_reject.ts, mirroring the corrected_reserve_flow design in
# queue/reports/subtask_281n_gunshi.yaml). So the ship/cancel tests here read
# those real files directly, the same way the generator tests assert on
# generated code strings.
# ---------------------------------------------------------------------------

def _po_def_ledger_transaction() -> dict:
    base = _po_def_no_reservation()
    base["x-reservation"] = {
        "mode": "count",
        "transaction": {"strategy": "ledger_transaction", "ledgerDomain": "inventory_domain"},
        "lines": "lines",
        "pool": {
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
                {"lot_number": "asc"},
                {"id": "asc"},
            ]
        },
        "result": {
            "parentField": "order_id",
            "lineTransactionableField": "inventory_transactionable_id",
            "quantityField": "quantity",
        },
    }
    return base


def _make_ledger_schema() -> dict:
    schema = _make_schema({"purchase_order": _po_def_ledger_transaction()})
    # Ledger strategy's lineTransactionableField has no x-relationship (build_context.py
    # excludes it from the nested-create body by name, not by relationship type).
    schema["definitions"]["order_line"]["properties"]["inventory_transactionable_id"] = {
        "type": ["string", "null"],
        "pattern": "^c[a-z0-9]{24,}$",
    }
    # OD-1: top-level domain declaration resolved via transaction.ledgerDomain
    schema["x-ledger-entities"] = {
        "inventory_domain": {
            "pool": "inventory",
            "ledger": "inventory_transaction",
            "transactionable": "inventory_transactionable",
        }
    }
    return schema


def _ledger_reservation_config() -> dict:
    schema = _make_ledger_schema()
    entity = _entity_spec("purchase_order", schema, children=[_line_child()])
    ctx = build_context(entity, schema)
    return ctx["reservation_config"]


def _ledger_allocation_code() -> str:
    rc = _ledger_reservation_config()
    schema = _make_ledger_schema()
    return _build_reservation_allocation_code(rc, "purchase_order", schema)


class TestLedgerTransactionReservePath:
    """Reserve path (generated): must claim via ledger rows, never touch physical quantity."""

    def test_strategy_parsed_as_ledger_transaction(self):
        rc = _ledger_reservation_config()
        assert rc["transaction_strategy"] == "ledger_transaction"

    def test_no_allocation_entity_configured(self):
        rc = _ledger_reservation_config()
        assert not rc["result"].get("allocationEntity"), (
            "ledger_transaction strategy has no allocation table — result must not "
            "carry an allocationEntity."
        )

    def test_reserve_creates_ledger_row_not_allocation_row(self):
        code = _ledger_allocation_code()
        assert "inventory_transaction.create" in code
        assert "inventory_allocation" not in code

    def test_reserve_event_type(self):
        code = _ledger_allocation_code()
        assert "event_type: 'reserve'" in code

    def test_reserve_o4_quantity_delta_is_zero(self):
        """O-4: reserve must never move physical quantity."""
        code = _ledger_allocation_code()
        assert "quantity_delta: 0" in code

    def test_reserve_o4_reserved_delta_is_claim(self):
        """O-4: reserve only moves the reserved-slot delta, by the claimed amount."""
        code = _ledger_allocation_code()
        assert "reserved_delta: _claim" in code

    def test_reserve_pool_update_only_touches_reserved_field(self):
        """The pool (inventory) cache update during reserve increments reserved_quantity
        only — it must never touch the bare quantity field (that's ship's job, O-4).
        Checks for "{ quantity: " (brace + space) rather than a bare substring, since
        "quantity: { increment" is also a substring of "reserved_quantity: { increment"."""
        code = _ledger_allocation_code()
        assert "reserved_quantity: { increment: _claim }" in code
        assert "{ quantity: { decrement" not in code
        assert "{ quantity: { increment" not in code

    def test_reserve_creates_bridge(self):
        """O-2: a fresh inventory_transactionable bridge anchors the line's ledger rows."""
        code = _ledger_allocation_code()
        assert "inventory_transactionable.create" in code

    def test_reserve_uses_denormalized_inventory_identity(self):
        """O-6: inventory_transaction has no inventory_id FK — identity is denormalized."""
        code = _ledger_allocation_code()
        for field in ("product_id", "location", "lot_number", "expiration_date"):
            assert field in code


class TestLedgerTransactionMutationGuards:
    """Mutation guards for ledger_transaction: allocated = lineTransactionableField set."""

    def _guards(self):
        schema = _make_ledger_schema()
        entity = _entity_spec("purchase_order", schema, children=[_line_child()])
        ctx = build_context(entity, schema)
        return service_context(ctx, schema)

    def test_update_guard_checks_transactionable_field_not_null(self):
        guard = self._guards()["reservation_mutation_guard_update"]
        assert "inventory_transactionable_id" in guard
        assert "{ not: null }" in guard
        assert "inventory_allocation" not in guard

    def test_delete_guard_checks_transactionable_field_not_null(self):
        guard = self._guards()["reservation_mutation_guard_delete"]
        assert "inventory_transactionable_id" in guard
        assert "{ not: null }" in guard
        assert "inventory_allocation" not in guard


class TestLedgerTransactionShipAndCancelFiles:
    """Ship (afterApprove) and cancel (afterReject) are hand-implemented once-stubs,
    not code-generated (generate.py only emits a comment/TODO skeleton for them —
    see test_ship_skeleton_stub.py). Read a tracked fixture snapshot of the real
    hand-authored implementation directly to verify the O-4 invariant holds (ship
    is the only path touching physical quantity; cancel never does), instead of
    reading the gitignored generated-app working-tree file — that path only
    exists after a prj/ copy + generate-code run with non-default
    inventory/reservation entities, which is not the case in a pristine
    app-generator checkout. See fixtures/purchase_per_item_ledger_ship_cancel/README.md."""

    @staticmethod
    def _read(filename: str) -> str:
        from pathlib import Path
        fixtures = Path(__file__).parent / "fixtures" / "purchase_per_item_ledger_ship_cancel"
        return (fixtures / filename).read_text()

    def _ship_code(self) -> str:
        return self._read("service_after_approve.ts")

    def _cancel_code(self) -> str:
        return self._read("service_after_reject.ts")

    def test_ship_event_type(self):
        assert "event_type: 'ship'" in self._ship_code()

    def test_ship_o4_decrements_both_quantity_and_reserved(self):
        """O-4: ship is the ONLY path that decrements physical quantity, and it
        always moves reserved_quantity down by the same amount."""
        code = self._ship_code()
        assert "quantity: { decrement: reserve.net }" in code
        assert "reserved_quantity: { decrement: reserve.net }" in code
        assert "quantity_delta: -reserve.net" in code
        assert "reserved_delta: -reserve.net" in code

    def test_cancel_event_type(self):
        assert "event_type: 'cancel'" in self._cancel_code()

    def test_cancel_o4_never_touches_physical_quantity(self):
        """O-4: cancel only releases the reserved slot; physical quantity is untouched.
        Checks for "{ quantity: " (brace + space) rather than a bare substring, since
        "quantity: { decrement" is also a substring of "reserved_quantity: { decrement"."""
        code = self._cancel_code()
        assert "quantity_delta: 0" in code
        assert "reserved_quantity: { decrement: reserve.net }" in code
        assert "{ quantity: { decrement" not in code, (
            "cancel must never decrement physical quantity — only ship does (O-4)."
        )

    def test_cancel_and_ship_are_symmetric_netting(self):
        """Both derive the outstanding amount by netting reserved_delta across the
        bridge's full transaction history (O-8 multi-lot support)."""
        for code in (self._ship_code(), self._cancel_code()):
            assert "existing.net += t.reserved_delta" in code or "existing.net += t.reserved_delta;" in code


class TestO4QuantityInvariantArithmetic:
    """Executable version of the O-4 proof in queue/reports/subtask_281n_gunshi.yaml:
    available = quantity - reserved_quantity must hold across reserve -> ship and
    reserve -> cancel, for every event's (quantity_delta, reserved_delta) pair."""

    def test_reserve_then_ship_full_cycle(self):
        quantity, reserved = 100, 0
        available = quantity - reserved
        assert available == 100

        # reserve 30: quantity_delta=0, reserved_delta=+30
        quantity += 0
        reserved += 30
        assert quantity - reserved == 70  # available drops by the reserved amount

        # ship the same 30: quantity_delta=-30, reserved_delta=-30
        quantity += -30
        reserved += -30
        assert quantity - reserved == 70  # unchanged: physically left, reservation released together
        assert (quantity, reserved) == (70, 0)

    def test_reserve_then_cancel_full_cycle(self):
        quantity, reserved = 100, 0

        # reserve 40: quantity_delta=0, reserved_delta=+40
        quantity += 0
        reserved += 40
        assert quantity - reserved == 60

        # cancel the same 40: quantity_delta=0, reserved_delta=-40
        quantity += 0
        reserved += -40
        assert quantity - reserved == 100  # back to original: nothing physically moved
        assert (quantity, reserved) == (100, 0)

    def test_partial_ship_then_cancel_remainder(self):
        """O-8-relevant case: a line reserves 50, ships 20, then cancels the
        remaining 30 (e.g. terminal reject after partial fulfillment)."""
        quantity, reserved = 100, 0

        quantity += 0
        reserved += 50  # reserve 50
        assert quantity - reserved == 50

        quantity += -20
        reserved += -20  # ship 20
        assert quantity - reserved == 50
        assert (quantity, reserved) == (80, 30)

        quantity += 0
        reserved += -30  # cancel remaining 30 (never shipped -> returns to available pool)
        assert quantity - reserved == 80, (
            "cancelling the un-shipped remainder frees it back to available: "
            "80 physically on hand, 0 now reserved."
        )
        assert (quantity, reserved) == (80, 0)
