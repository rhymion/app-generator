"""
B4/B5/B6: Reservation guard correctness — verifies the generated code is safe
under concurrent purchase order creation, and that mutation guards are generated.

B4: allocation code uses conditional-update guard (gte: _claim) so concurrent
    transactions cannot both claim the last unit.

B5: service.ts template generates ReservationMutationError class + update/delete
    mutation guards when the entity has a reservation_config.

B6 (true concurrent HTTP test): implemented in Cypress via Promise.all(fetch, fetch)
    in cypress/e2e/api/purchase_order_reservation.cy.ts (R3-concurrent).
    Reason: Cypress already manages DB seed/teardown and the Next.js server lifecycle;
    repeating that in pytest would require a heavyweight fixture with no extra coverage.
    Command: npm run test:e2e:cy:api -- --spec cypress/e2e/api/purchase_order_reservation.cy.ts

G12 (cmd_281 B-5 Phase2b): strategy: ledger_transaction (inventory_transaction
ledger, introduced in Phase2a) is a SECOND concurrency-safe strategy alongside
conditional_update — it does not replace it (conditional_update is still used
by other entities, e.g. supply_request/supply_allocation). TestLedgerTransaction*
below mirrors TestConcurrentSafety/TestMutationGuards for the ledger strategy:
the concurrency guard is `reserved_quantity: { lte: quantity - claim }` in the
updateMany WHERE (O-4: reserve never touches quantity, so the safety margin is
checked against reserved_quantity rather than decrementing quantity directly).
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from build_context import build_context
from generators import service_context


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


def _po_def_count_mode() -> dict:
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
        },
    }


def _get_service_context() -> dict:
    schema = _make_schema({"purchase_order": _po_def_count_mode()})
    entity = {
        "parent": "purchase_order",
        "model": "purchase_order",
        "definition_key": "purchase_order_detail",
        "children": [
            {
                "name": "order_line",
                "property_name": "lines",
                "output_type": "list",
                "file_type": None,
                "relationship": None,
            }
        ],
        "generate_config": {
            "list": True, "view": True, "new": True, "edit": True,
            "delete": True, "api": False, "test": False, "fields": None,
        },
    }
    ctx = build_context(entity, schema)
    return service_context(ctx, schema)


def _get_allocation_code() -> str:
    return _get_service_context()["reservation_allocation_code"]


class TestConcurrentSafety:
    """
    Validates that the generated allocation code uses patterns that are
    safe under concurrent purchase order creation (B4).

    The key invariant: inventory.quantity must never go below 0, even when
    two orders race to claim the last unit. This is guaranteed by the
    conditional UPDATE WHERE quantity >= N being atomic at the DB level.
    """

    def test_gte_guard_in_updateMany_where(self):
        """Generated updateMany WHERE includes quantity >= claimQuantity guard."""
        code = _get_allocation_code()
        # The guard prevents concurrent transactions from both claiming the same stock
        assert "gte: _claim" in code, (
            "Concurrent safety requires `quantity: { gte: _claim }` in the updateMany WHERE. "
            "Without this guard, two concurrent transactions can both read quantity=1 and "
            "both decrement, producing quantity=-1."
        )

    def test_count_checked_before_decrement(self):
        """Generated code checks updateMany result count before committing the claim."""
        code = _get_allocation_code()
        assert "_claimResult.count > 0" in code, (
            "Must verify the conditional update affected a row (count > 0) before decrementing "
            "_remaining. This handles the race where another transaction won the same row."
        )

    def test_insufficient_inventory_thrown_when_remaining_positive(self):
        """Generated code throws InsufficientPoolCapacityError when candidates are exhausted."""
        code = _get_allocation_code()
        assert "_remaining > 0" in code, (
            "After the candidate loop, _remaining > 0 means stock was insufficient. "
            "The error must be thrown inside the transaction so all writes are rolled back."
        )
        assert "InsufficientPoolCapacityError" in code

    def test_no_unconditional_decrement(self):
        """Generated code never unconditionally decrements — only via guarded updateMany."""
        code = _get_allocation_code()
        # There should be no bare `decrement` outside the conditional update
        # The only decrement is inside updateMany.data, gated by the WHERE gte guard
        lines = code.split("\n")
        decrement_lines = [l for l in lines if "decrement" in l]
        # All decrements should be in the data block of updateMany (not a raw assignment)
        for line in decrement_lines:
            assert "decrement:" in line, (
                f"Unexpected unconditional decrement pattern: {line!r}"
            )


class TestMutationGuards:
    """
    B5: Validates that the generator produces update/delete mutation guards
    and exports both error classes for reservation entities.
    """

    def test_error_classes_exported(self):
        """Generated utility_code exports both error classes."""
        svc = _get_service_context()
        code = svc["utility_code"]
        assert "export class InsufficientPoolCapacityError" in code, (
            "InsufficientPoolCapacityError must be exported so api_route.ts can import it."
        )
        assert "export class ReservationMutationError" in code, (
            "ReservationMutationError must be exported so api_detail_route.ts can import it."
        )

    def test_update_guard_rejects_criteria_change(self):
        """Generated update guard checks for allocation before allowing criteria mutation."""
        svc = _get_service_context()
        guard = svc["reservation_mutation_guard_update"]
        assert guard, "reservation_mutation_guard_update must not be empty for reservation entities."
        assert "inventory_allocation" in guard, "Guard must query the allocation entity."
        assert "ReservationMutationError" in guard, "Guard must throw ReservationMutationError."
        assert "_mutated" in guard, "Guard must compute a _mutated flag."
        assert "linesItems" in guard or "Lines" in guard.lower() or "Items" in guard, (
            "Guard must reference the incoming lines items parameter."
        )

    def test_update_guard_checks_criteria_fields(self):
        """Update guard compares criteria fields (product_id) and quantity."""
        svc = _get_service_context()
        guard = svc["reservation_mutation_guard_update"]
        assert "product_id" in guard, "Guard must check product_id (a criteria field)."
        assert "quantity" in guard, "Guard must check quantity (the quantity field)."

    def test_delete_guard_rejects_allocated_order(self):
        """Generated delete guard blocks deletion when allocation exists."""
        svc = _get_service_context()
        guard = svc["reservation_mutation_guard_delete"]
        assert guard, "reservation_mutation_guard_delete must not be empty for reservation entities."
        assert "inventory_allocation" in guard, "Guard must query the allocation entity."
        assert "ReservationMutationError" in guard, "Guard must throw ReservationMutationError."
        assert "{ in: ids }" in guard, "Delete guard must use { in: ids } to handle bulk delete."

    def test_no_mutation_guard_for_non_reservation_entity(self):
        """Non-reservation entity must not generate mutation guards."""
        schema = _make_schema({
            "plain_entity": {
                "type": "object",
                "required": ["id", "name"],
                "properties": {
                    "id": {"type": "string", "pattern": "^c[a-z0-9]{24,}$"},
                    "name": {"type": "string"},
                },
            }
        })
        entity = {
            "parent": "plain_entity",
            "model": "plain_entity",
            "definition_key": "plain_entity",
            "children": [],
            "generate_config": {
                "list": True, "view": True, "new": True, "edit": True,
                "delete": True, "api": False, "test": False, "fields": None,
            },
        }
        ctx = build_context(entity, schema)
        svc = service_context(ctx, schema)
        assert svc["reservation_mutation_guard_update"] == ""
        assert svc["reservation_mutation_guard_delete"] == ""


# ---------------------------------------------------------------------------
# G12: strategy: ledger_transaction concurrency guard (see module docstring).
# ---------------------------------------------------------------------------

def _po_def_ledger_transaction() -> dict:
    return {
        "type": "object",
        "required": ["id", "name"],
        "properties": {
            "id": {"type": "string", "pattern": "^c[a-z0-9]{24,}$"},
            "name": {"type": "string"},
        },
        "x-reservation": {
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
                    {"id": "asc"},
                ]
            },
            "result": {
                "parentField": "order_id",
                "lineTransactionableField": "inventory_transactionable_id",
                "quantityField": "quantity",
            },
        },
    }


def _get_ledger_service_context() -> dict:
    schema = _make_schema({"purchase_order": _po_def_ledger_transaction()})
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
            "itemField": "product_id",
            "locationField": "location_id",
            "lotField": "lot_number",
            "expirationField": "expiration_date",
        }
    }
    entity = {
        "parent": "purchase_order",
        "model": "purchase_order",
        "definition_key": "purchase_order_detail",
        "children": [
            {
                "name": "order_line",
                "property_name": "lines",
                "output_type": "list",
                "file_type": None,
                "relationship": None,
            }
        ],
        "generate_config": {
            "list": True, "view": True, "new": True, "edit": True,
            "delete": True, "api": False, "test": False, "fields": None,
        },
    }
    ctx = build_context(entity, schema)
    return service_context(ctx, schema)


def _get_ledger_allocation_code() -> str:
    return _get_ledger_service_context()["reservation_allocation_code"]


class TestLedgerTransactionConcurrentSafety:
    """
    Ledger-strategy equivalent of TestConcurrentSafety. The claim is guarded by
    comparing reserved_quantity against quantity in the updateMany WHERE — since
    O-4 forbids reserve from touching quantity directly, the conditional-update
    guard has to be phrased in terms of reserved_quantity's remaining headroom
    (quantity - reserved_quantity >= claim) rather than a bare `quantity: { gte }`.

    The key invariant is identical to the conditional_update case: two concurrent
    transactions can never both successfully claim more than what's available,
    because the WHERE clause is re-evaluated atomically by postgres per row.
    """

    def test_lte_guard_in_updateMany_where(self):
        """Generated updateMany WHERE includes the reserved_quantity headroom guard."""
        code = _get_ledger_allocation_code()
        assert "reserved_quantity: { lte: _candidate.quantity - _claim }" in code, (
            "Concurrent safety requires the updateMany WHERE to re-check "
            "`reserved_quantity <= quantity - claim` atomically. Without this guard, "
            "two concurrent transactions can both read the same availability and "
            "both increment reserved_quantity past quantity."
        )

    def test_count_checked_before_ledger_row_written(self):
        """Generated code checks updateMany result count before writing the ledger row."""
        code = _get_ledger_allocation_code()
        assert "_claimResult.count > 0" in code, (
            "Must verify the conditional update affected a row (count > 0) before "
            "writing the inventory_transaction row. This handles the race where "
            "another transaction won the same row."
        )

    def test_insufficient_inventory_thrown_when_remaining_positive(self):
        """Generated code throws InsufficientPoolCapacityError when candidates are exhausted."""
        code = _get_ledger_allocation_code()
        assert "_remaining > 0" in code
        assert "InsufficientPoolCapacityError" in code

    def test_no_unconditional_reserved_quantity_increment(self):
        """Generated code never increments reserved_quantity outside the guarded updateMany."""
        code = _get_ledger_allocation_code()
        lines = code.split("\n")
        increment_lines = [l for l in lines if "increment" in l]
        for line in increment_lines:
            assert "increment:" in line, f"Unexpected unconditional increment pattern: {line!r}"

    def test_reserve_never_decrements_quantity(self):
        """O-4: even under the ledger strategy, reserve must never touch physical quantity."""
        code = _get_ledger_allocation_code()
        assert "{ quantity: { decrement" not in code, (
            "reserve must never decrement quantity — only ship does (O-4)."
        )


class TestLedgerTransactionMutationGuardsConcurrent:
    """Ledger-strategy equivalent of TestMutationGuards (allocated = bridge FK set)."""

    def test_update_guard_checks_bridge_field(self):
        svc = _get_ledger_service_context()
        guard = svc["reservation_mutation_guard_update"]
        assert guard, "reservation_mutation_guard_update must not be empty for ledger reservation entities."
        assert "inventory_transactionable_id" in guard
        assert "{ not: null }" in guard
        assert "ReservationMutationError" in guard

    def test_delete_guard_checks_bridge_field(self):
        svc = _get_ledger_service_context()
        guard = svc["reservation_mutation_guard_delete"]
        assert guard, "reservation_mutation_guard_delete must not be empty for ledger reservation entities."
        assert "inventory_transactionable_id" in guard
        assert "{ not: null }" in guard
        assert "ReservationMutationError" in guard
