"""
cmd_562: the ledger entity's own location column is now an id-FK
(location_id), copied verbatim from the pool row that was claimed/moved/
adjusted/reserved — not a denormalized display-string snapshot.

This supersedes cmd_550's PR #269 fix (test_ledger_stub_location_label_field.py,
now removed), which taught the ledger_*_stub / split_action_route.ts.jinja2
templates to render a location entity's *declared* labelField (e.g. 'code')
into the ledger row instead of hardcoding `.name`, and to reverse-look-up
that denormalized string back to a location row via
`findFirst({ where: { <labelField>: <string> } })`. Both the original bug
and its fix are now moot: with location_id copied by id, there is nothing
to render (no label lookup at write time) and nothing to invert (no
reverse findFirst at read time). This file proves, across all four affected
templates plus their shared Python context builders, that:
  1. every ledger row write copies `<pool_var>.location_id` verbatim
     (no `?.` optional-chaining, no `?? ''`/`?? null` label fallback);
  2. no template renders a `findFirst`/`where: { <field>: <name> }` reverse
     lookup keyed on a location display field;
  3. no `include: { location: true }` (or nested variant) survives — a
     scalar FK column needs no Prisma relation include to read.
"""
import pytest

from generate import _ledger_stub_field_vars
from generators import _build_ledger_reservation_allocation_code
from helpers.schema_helpers import resolve_ledger_domain
from helpers.naming import to_pascal_case, to_camel_case
from jinja2 import Environment, FileSystemLoader
from pathlib import Path


def _domain_dict(**overrides) -> dict:
    base = {
        "pool": "inventory",
        "ledger": "inventory_transaction",
        "transactionable": "inventory_transactionable",
        "itemField": "product_id",
        "locationField": "location_id",
        "lotField": "lot_number",
        "expirationField": "expiration_date",
    }
    base.update(overrides)
    return base


def _schema() -> dict:
    return {"x-ledger-entities": {"inventory_domain": _domain_dict()}}


class TestLedgerStubFieldVarsLocationIdCopy:
    """_ledger_stub_field_vars — the shared Python context builder for all
    four templates below — must expose only pool_location_field (the id-FK
    column name), with none of the removed label-rendering machinery."""

    def test_exposes_plain_location_field_only(self):
        schema = _schema()
        domain = resolve_ledger_domain(schema, "inventory_domain")
        ctx = _ledger_stub_field_vars(domain, schema)
        assert ctx["pool_location_field"] == "location_id"
        assert "pool_location_relation" not in ctx
        assert "pool_location_label_field" not in ctx
        assert "pool_location_label_exprs" not in ctx
        assert "pool_location_target_entity" not in ctx

    def test_no_schema_lookup_required(self):
        """Unlike the removed label-rendering path, building this context
        needs no location entity definition in the schema at all — it's a
        pure passthrough of the domain's declared field names."""
        domain = resolve_ledger_domain(_schema(), "inventory_domain")
        ctx = _ledger_stub_field_vars(domain, {"x-ledger-entities": _schema()["x-ledger-entities"]})
        assert ctx["pool_location_field"] == "location_id"


def _make_env() -> Environment:
    templates_dir = Path(__file__).parent.parent / "templates"
    env = Environment(
        loader=FileSystemLoader(templates_dir),
        trim_blocks=True, lstrip_blocks=True, keep_trailing_newline=True,
    )
    env.filters["pascal_case"] = to_pascal_case
    env.filters["camel_case"] = to_camel_case
    return env


_ENV = _make_env()

_COMMON_LEDGER_STUB_CTX = {
    "snake_name": "inventory_adjustment",
    "bridge_fk_field": "inventory_transactionable_id",
    "ledger_entity": "inventory_transaction",
    "transactionable_entity": "inventory_transactionable",
    "pool_entity": "inventory",
    "pool_item_field": "product_id",
    "pool_location_field": "location_id",
    "pool_lot_field": "lot_number",
    "pool_expiration_field": "expiration_date",
}


class TestLedgerAdjustStubIdCopy:
    def test_copies_location_id_verbatim_no_include(self):
        ctx = {
            **_COMMON_LEDGER_STUB_CTX,
            "ledger_source": {"poolIdField": "inventory_id", "quantity_delta_field": "quantity_delta"},
        }
        rendered = _ENV.get_template("ledger_adjust_stub.ts.jinja2").render(**ctx)
        assert "location_id: inventory.location_id," in rendered
        assert "include:" not in rendered
        assert "location?." not in rendered


class TestLedgerMoveStubIdCopy:
    def test_copies_location_id_verbatim_both_sides_no_include(self):
        ctx = {
            **_COMMON_LEDGER_STUB_CTX,
            "ledger_source": {
                "fromPoolIdField": "from_inventory_id",
                "toPoolIdField": "to_inventory_id",
                "quantity_delta_field": "quantity_delta",
            },
        }
        rendered = _ENV.get_template("ledger_move_stub.ts.jinja2").render(**ctx)
        assert "location_id: fromInventory.location_id," in rendered
        assert "location_id: toInventory.location_id," in rendered
        assert "include:" not in rendered
        assert "location?." not in rendered


class TestLedgerWriteStubIdCopy:
    def test_forward_write_and_reject_reidentify_use_plain_id_no_reverse_lookup(self):
        ctx = {
            **_COMMON_LEDGER_STUB_CTX,
            "ledger_source": {
                "poolIdField": "inventory_id",
                "event_type": "receive",
                "quantity_delta_field": "quantity_delta",
                "reserved_delta_field": None,
                "reject_event_type": "receive_reject",
            },
        }
        rendered = _ENV.get_template("ledger_write_stub.ts.jinja2").render(**ctx)
        # Forward (O-6): plain id copy.
        assert "location_id: inventory.location_id," in rendered
        # afterReject re-identifies the inventory cache row using the ledger
        # row's own location_id directly — no reverse findFirst, no include.
        assert "location_id: source.location_id," in rendered
        assert "findFirst({ where: { name:" not in rendered
        assert "findFirst({ where: { code:" not in rendered
        assert "_sourceLocName" not in rendered
        assert "include:" not in rendered
        assert "location?." not in rendered


class TestSplitActionRouteIdCopy:
    _BASE_SPLIT_CTX = {
        "entity_name": "purchase_per_item",
        "status_split_value": "split",
        "status_rejected_value": "rejected",
        "inherited_fields": [],
        "quantity_field": "quantity",
        "has_quantity_check": True,
        "per_part_required": ["inventory_id"],
        "per_part_required_mandatory": [],
        "parent_field": "parent_purchase_per_item_id",
        "split_result_field": None,
        "has_approvable": False,
        "has_inventory_bridge": True,
        "split_reserves_inventory": True,
        "pool_fk_field": "inventory_id",
        "bridge_fk_field": "inventory_transactionable_id",
        "ledger_entity": "inventory_transaction",
        "transactionable_entity": "inventory_transactionable",
        "pool_entity": "inventory",
        "split_item_field": "product_id",
        **_COMMON_LEDGER_STUB_CTX,
    }

    def _render(self):
        return _ENV.get_template("split_action_route.ts.jinja2").render(**self._BASE_SPLIT_CTX)

    def test_all_split_route_location_sites_copy_id_verbatim(self):
        rendered = self._render()
        # Auto-allocate candidate (forward).
        assert "location_id: _cand.location_id," in rendered
        # Specified-lot child (forward).
        assert "location_id: _childInv.location_id," in rendered
        # Parent reserved-row release re-identifies via the ledger row's own
        # location_id directly — no reverse lookup.
        assert "location_id: _row.location_id," in rendered
        assert "findFirst({ where: { name:" not in rendered
        assert "findFirst({ where: { code:" not in rendered
        assert "_rowLocName" not in rendered

    def test_no_location_relation_include_anywhere(self):
        rendered = self._render()
        assert "location: true" not in rendered
        assert "location?." not in rendered
        assert "include: { location" not in rendered


def _make_reservation_config(schema):
    return {
        "transaction_strategy": "ledger_transaction",
        "ledger_domain": "inventory_domain",
        "pool": {"quantityField": "quantity", "reservedField": "reserved_quantity"},
        "request": {"quantityField": "quantity", "criteria": {"product_id": "product_id"}},
        "policy": {"orderBy": [{"expiration_date": "asc_nulls_last"}]},
        "result": {"lineTransactionableField": "inventory_transactionable_id"},
        "hasLines": True,
    }


class TestLedgerReservationAllocationCodeIdCopy:
    """generators.py's own reserve-phase ledger row write (the fifth call
    site, alongside the four jinja2 templates above)."""

    def test_reserve_phase_copies_location_id_verbatim_no_include(self):
        schema = _schema()
        rc = _make_reservation_config(schema)
        code = _build_ledger_reservation_allocation_code(rc, "purchase_order", schema)
        assert "location_id: _candidate.location_id," in code
        assert "include:" not in code
        assert "location?." not in code
