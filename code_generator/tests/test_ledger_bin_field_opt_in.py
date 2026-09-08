"""
cmd_991 [甲]: bin_field is an OPT-IN dimension on x-ledger-entities.<domain>
(declared as `binField`, e.g. proj_g's inventory bin_id column) — unlike the
four required fields (itemField/locationField/lotField/expirationField,
OD-1: config required, no defaults), a domain may omit `binField` entirely.

Scope confirmed empirically (grep across code_generator/, excluding tests)
before writing this file: every consumer of the ledger domain dict's
item/location/lot/expiration fields is exactly the four jinja2 templates
covered by test_ledger_location_id_fk.py (ledger_write_stub.ts.jinja2,
ledger_move_stub.ts.jinja2, ledger_adjust_stub.ts.jinja2,
split_action_route.ts.jinja2, via generate.py's `_ledger_stub_field_vars`)
plus generators.py's two reserve/resubmit-claim ledger-row builders
(`_build_ledger_reservation_allocation_code` line ~1491,
`_build_reservation_guard_and_resubmit_approval_lines` line ~1803) — no
additional consumption site exists. This file extends coverage to all of
these for the opt-in `bin_field`/`pool_bin_field` key, mirroring
test_ledger_location_id_fk.py's structure one-for-one.

Golden-diff-zero (a consumer that never declares binField, e.g. proj_c's
inventory_domain, renders byte-identical output to before this key
existed): every site reads bin_field/pool_bin_field behind a Python
`if bin_field:` or jinja2 `{% if pool_bin_field %}` guard, so omitting the
key (Jinja's default Undefined is falsy, so even a caller unaware of the
new key, e.g. an old context dict, behaves identically) renders nothing new.
The "context dict unaware of pool_bin_field" cases below prove this without
needing a code change on the caller's part.

The afterReject re-identification query (ledger_write_stub.ts.jinja2) and
the parent reserved-inventory release query (split_action_route.ts.jinja2)
both re-identify a pool row via a tuple match on
item/location/lot/expiration with no unique id — ambiguous once bin is a
real dimension (two rows can share item/location/lot/expiration and differ
only by bin), the same ambiguous-resolution bug shape cmd_989 fixed in
release_hold.ts. This file proves bin_field/pool_bin_field, when declared,
joins both of those tuple matches.
"""
import pytest

from generate import _ledger_stub_field_vars
from generators import (
    _build_ledger_reservation_allocation_code,
    _build_reservation_guard_and_resubmit_approval_lines,
)
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


def _schema(**domain_overrides) -> dict:
    return {"x-ledger-entities": {"inventory_domain": _domain_dict(**domain_overrides)}}


class TestResolveLedgerDomainBinFieldOptIn:
    """bin_field is OPT-IN — unlike the four OD-1 required fields, a domain
    missing `binField` must NOT raise; it resolves to bin_field=None."""

    def test_bin_field_none_when_binfield_absent(self):
        resolved = resolve_ledger_domain(_schema(), "inventory_domain")
        assert resolved["bin_field"] is None

    def test_bin_field_resolves_when_declared(self):
        schema = _schema(binField="bin_id")
        resolved = resolve_ledger_domain(schema, "inventory_domain")
        assert resolved["bin_field"] == "bin_id"

    def test_missing_binfield_does_not_raise(self):
        # Contrast with the four required fields (test_ledger_item_naming_
        # generalization.py's test_missing_required_key_fails_loud_and_names_it) —
        # binField's absence is not an error at all.
        domain = _domain_dict()
        assert "binField" not in domain
        resolve_ledger_domain({"x-ledger-entities": {"inventory_domain": domain}}, "inventory_domain")


class TestLedgerStubFieldVarsBinFieldOptIn:
    """_ledger_stub_field_vars — the shared Python context builder for all
    four templates below — must expose pool_bin_field=None when the domain
    doesn't declare it, and the declared column name when it does."""

    def test_pool_bin_field_none_when_absent(self):
        schema = _schema()
        domain = resolve_ledger_domain(schema, "inventory_domain")
        ctx = _ledger_stub_field_vars(domain, schema)
        assert ctx["pool_bin_field"] is None

    def test_pool_bin_field_present_when_declared(self):
        schema = _schema(binField="bin_id")
        domain = resolve_ledger_domain(schema, "inventory_domain")
        ctx = _ledger_stub_field_vars(domain, schema)
        assert ctx["pool_bin_field"] == "bin_id"


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

# Deliberately mirrors test_ledger_location_id_fk.py's _COMMON_LEDGER_STUB_CTX
# with NO pool_bin_field key at all, to prove golden-diff-zero for a caller
# that has never heard of this cmd_991 key (Jinja's default Undefined is
# falsy in `{% if %}`, so this must behave exactly like pool_bin_field=None).
_COMMON_LEDGER_STUB_CTX_NO_BIN_KEY = {
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

_COMMON_LEDGER_STUB_CTX_WITH_BIN = {
    **_COMMON_LEDGER_STUB_CTX_NO_BIN_KEY,
    "pool_bin_field": "bin_id",
}


class TestLedgerAdjustStubBinFieldOptIn:
    def test_no_bin_key_renders_no_bin_reference(self):
        ctx = {
            **_COMMON_LEDGER_STUB_CTX_NO_BIN_KEY,
            "ledger_source": {"poolIdField": "inventory_id", "quantity_delta_field": "quantity_delta"},
        }
        rendered = _ENV.get_template("ledger_adjust_stub.ts.jinja2").render(**ctx)
        assert "bin_id" not in rendered

    def test_bin_declared_copies_bin_id_verbatim(self):
        ctx = {
            **_COMMON_LEDGER_STUB_CTX_WITH_BIN,
            "ledger_source": {"poolIdField": "inventory_id", "quantity_delta_field": "quantity_delta"},
        }
        rendered = _ENV.get_template("ledger_adjust_stub.ts.jinja2").render(**ctx)
        assert "bin_id: inventory.bin_id," in rendered


class TestLedgerMoveStubBinFieldOptIn:
    def _ctx(self, **overrides):
        return {
            **overrides,
            "ledger_source": {
                "fromPoolIdField": "from_inventory_id",
                "toPoolIdField": "to_inventory_id",
                "quantity_delta_field": "quantity_delta",
            },
        }

    def test_no_bin_key_renders_no_bin_reference(self):
        rendered = _ENV.get_template("ledger_move_stub.ts.jinja2").render(
            **self._ctx(**_COMMON_LEDGER_STUB_CTX_NO_BIN_KEY)
        )
        assert "bin_id" not in rendered

    def test_bin_declared_copies_bin_id_verbatim_both_sides(self):
        rendered = _ENV.get_template("ledger_move_stub.ts.jinja2").render(
            **self._ctx(**_COMMON_LEDGER_STUB_CTX_WITH_BIN)
        )
        assert "bin_id: fromInventory.bin_id," in rendered
        assert "bin_id: toInventory.bin_id," in rendered


class TestLedgerWriteStubBinFieldOptIn:
    def _ctx(self, **overrides):
        return {
            **overrides,
            "ledger_source": {
                "poolIdField": "inventory_id",
                "event_type": "receive",
                "quantity_delta_field": "quantity_delta",
                "reserved_delta_field": None,
                "reject_event_type": "receive_reject",
            },
        }

    def test_no_bin_key_renders_no_bin_reference(self):
        rendered = _ENV.get_template("ledger_write_stub.ts.jinja2").render(
            **self._ctx(**_COMMON_LEDGER_STUB_CTX_NO_BIN_KEY)
        )
        assert "bin_id" not in rendered

    def test_bin_declared_copies_on_approve_and_reject(self):
        rendered = _ENV.get_template("ledger_write_stub.ts.jinja2").render(
            **self._ctx(**_COMMON_LEDGER_STUB_CTX_WITH_BIN)
        )
        # Forward (afterApprove).
        assert "bin_id: inventory.bin_id," in rendered
        # afterReject ledger row copy.
        assert "bin_id: source.bin_id," in rendered

    def test_bin_declared_joins_after_reject_reidentify_tuple_match(self):
        """cmd_991 [甲] landmine fix: the afterReject inventoryCache findFirst
        re-identifies the pool row via a tuple match with no unique id —
        ambiguous once bin is a real dimension. bin_id must join this where
        clause when declared."""
        rendered = _ENV.get_template("ledger_write_stub.ts.jinja2").render(
            **self._ctx(**_COMMON_LEDGER_STUB_CTX_WITH_BIN)
        )
        find_first_start = rendered.index("const inventoryCache = await tx.inventory.findFirst({")
        find_first_block = rendered[find_first_start:find_first_start + 400]
        assert "bin_id: source.bin_id," in find_first_block

    def test_no_bin_after_reject_reidentify_unchanged(self):
        """Golden-diff-zero: without binField, the same tuple match must be
        exactly the four pre-existing fields, no bin_id anywhere."""
        rendered = _ENV.get_template("ledger_write_stub.ts.jinja2").render(
            **self._ctx(**_COMMON_LEDGER_STUB_CTX_NO_BIN_KEY)
        )
        find_first_start = rendered.index("const inventoryCache = await tx.inventory.findFirst({")
        find_first_block = rendered[find_first_start:find_first_start + 400]
        assert "product_id: source.product_id," in find_first_block
        assert "location_id: source.location_id," in find_first_block
        assert "lot_number: source.lot_number," in find_first_block
        assert "expiration_date: source.expiration_date," in find_first_block
        assert "bin_id" not in find_first_block


class TestSplitActionRouteBinFieldOptIn:
    _BASE_SPLIT_CTX_NO_BIN = {
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
        **_COMMON_LEDGER_STUB_CTX_NO_BIN_KEY,
    }
    _BASE_SPLIT_CTX_WITH_BIN = {
        **_BASE_SPLIT_CTX_NO_BIN,
        "pool_bin_field": "bin_id",
    }

    def _render(self, ctx):
        return _ENV.get_template("split_action_route.ts.jinja2").render(**ctx)

    def test_no_bin_key_renders_no_bin_reference(self):
        rendered = self._render(self._BASE_SPLIT_CTX_NO_BIN)
        assert "bin_id" not in rendered

    def test_bin_declared_all_forward_copy_sites(self):
        rendered = self._render(self._BASE_SPLIT_CTX_WITH_BIN)
        # Auto-allocate candidate (forward).
        assert "bin_id: _cand.bin_id," in rendered
        # Specified-lot child select + forward copy.
        assert "bin_id: true" in rendered
        assert "bin_id: _childInv.bin_id," in rendered
        # Parent reserved-row release cancel ledger row.
        assert "bin_id: _row.bin_id," in rendered

    def test_bin_declared_joins_parent_release_tuple_match(self):
        """cmd_991 [甲] landmine fix: the parent reserved-inventory release
        updateMany re-identifies the pool row via the same ambiguous tuple
        match shape as the ledger_write_stub afterReject fix above. bin_id
        must join this where clause when declared."""
        rendered = self._render(self._BASE_SPLIT_CTX_WITH_BIN)
        update_many_start = rendered.index("await tx.inventory.updateMany({")
        update_many_block = rendered[update_many_start:update_many_start + 500]
        assert "{ bin_id: _row.bin_id }" in update_many_block

    def test_no_bin_parent_release_tuple_match_unchanged(self):
        rendered = self._render(self._BASE_SPLIT_CTX_NO_BIN)
        update_many_start = rendered.index("await tx.inventory.updateMany({")
        update_many_block = rendered[update_many_start:update_many_start + 500]
        assert "product_id: _row.product_id," in update_many_block
        assert "location_id: _row.location_id," in update_many_block
        assert "lot_number: _row.lot_number }" in update_many_block
        assert "expiration_date: _row.expiration_date }" in update_many_block
        assert "bin_id" not in update_many_block


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


class TestLedgerReservationAllocationCodeBinFieldOptIn:
    """generators.py's own reserve-phase ledger row write (the fifth call
    site, alongside the four jinja2 templates above)."""

    def test_no_binfield_renders_no_bin_reference(self):
        schema = _schema()
        rc = _make_reservation_config(schema)
        code = _build_ledger_reservation_allocation_code(rc, "purchase_order", schema)
        assert "bin_id" not in code

    def test_binfield_declared_copies_bin_id_verbatim(self):
        schema = _schema(binField="bin_id")
        rc = _make_reservation_config(schema)
        code = _build_ledger_reservation_allocation_code(rc, "purchase_order", schema)
        assert "bin_id: _candidate.bin_id," in code


class TestReservationGuardAndResubmitApprovalLinesBinFieldOptIn:
    """generators.py's per-line resubmit-claim ledger row write (the sixth
    call site — the second of the two generators.py functions cmd_991
    named as consuming the domain dict outside the four templates)."""

    def _call(self, schema, bin_field=None):
        rc = {
            "result": {"lineTransactionableField": "inventory_transactionable_id"},
            "request": {"quantityField": "quantity", "criteria": {"product_id": "product_id"}},
            "pool": {"quantityField": "quantity", "reservedField": "reserved_quantity"},
            "policy": {"orderBy": [{"expiration_date": "asc_nulls_last"}]},
            "ledger_domain": "inventory_domain",
        }
        return _build_reservation_guard_and_resubmit_approval_lines(
            rc,
            model="purchase_per_item",
            schema=schema,
            lines_entity="purchase_per_item",
            lines_var="items",
            line_txable_f="inventory_transactionable_id",
            select_fields_str="quantity: true",
            select_fields_set=["quantity"],
        )

    def test_no_binfield_renders_no_bin_reference(self):
        schema = _schema()
        code = self._call(schema)
        assert "bin_id" not in code

    def test_binfield_declared_copies_bin_id_verbatim(self):
        schema = _schema(binField="bin_id")
        code = self._call(schema)
        assert "bin_id: _candidate.bin_id," in code
