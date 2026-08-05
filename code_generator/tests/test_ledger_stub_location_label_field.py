"""
Deviation-injection tests for cmd_550's PR #269 follow-up: the ledger_*_stub
/ split_action_route.ts.jinja2 templates' location-relation snapshot write
(forward: display value -> denormalized ledger string column) and reverse
lookup (denormalized string -> location row) hardcoded `.name` / `where: {
name: ... }` / `select: { name: true } }` in nine places across four files,
even after resolve_ledger_domain() (cmd_550 main) started resolving the
pool entity's *declared* x-relationship.labelField into
location_label_field/location_label_target. generators.py's own reserve-
phase ledger row write was fixed to read that declaration via
build_label_expression(); these four GENERATED-ONCE/regenerated templates
were not — this file proves all nine sites now read the declared field
(here: 'code', not 'name') instead of assuming 'name'.

Forward sites (write display value into ledger row):
  1. ledger_adjust_stub.ts.jinja2 : inventory
  2. ledger_move_stub.ts.jinja2   : fromInventory
  3. ledger_move_stub.ts.jinja2   : toInventory
  4. ledger_write_stub.ts.jinja2  : inventory (O-6)
  5. split_action_route.ts.jinja2 : _childInv
  6. split_action_route.ts.jinja2 : _cand

Reverse sites (denormalized string -> row lookup):
  7. ledger_write_stub.ts.jinja2  : findFirst({ where: { name: ... } })
  8. split_action_route.ts.jinja2 : findFirst({ where: { name: ... } })
  9. split_action_route.ts.jinja2 : select: { name: true } narrowing (feeds
     site 5's forward read — widened to full-row `true` instead, since a
     narrow `select: { name: true }` would silently omit 'code' entirely)
"""
import pytest

from generate import _ledger_stub_field_vars
from helpers.schema_helpers import resolve_ledger_domain
from helpers.naming import to_pascal_case, to_camel_case
from jinja2 import Environment, FileSystemLoader
from pathlib import Path


# ---------------------------------------------------------------------------
# Shared: a ledger domain whose location entity displays 'code', not 'name'
# (no 'name' property exists at all on the location entity).
# ---------------------------------------------------------------------------

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


def _code_schema(location_label_field: str = "code") -> dict:
    domain = _domain_dict()
    return {
        "x-ledger-entities": {"inventory_domain": domain},
        "definitions": {
            "inventory": {
                "type": "object",
                "properties": {
                    "location_id": {
                        "type": "string",
                        "x-relationship": {
                            "type": "many-to-one",
                            "target": "location",
                            "labelField": location_label_field,
                        },
                    },
                },
            },
            "location": {
                "type": "object",
                "required": ["id", location_label_field],
                "properties": {
                    "id": {"type": "string"},
                    location_label_field: {"type": "string"},
                },
            },
        },
    }


def _resolved_code_domain() -> dict:
    schema = _code_schema()
    return resolve_ledger_domain(schema, "inventory_domain")


class TestLedgerStubFieldVarsLocationLabelDeviation:
    """Deviation injection at the Python context-building layer
    (_ledger_stub_field_vars) shared by all four templates."""

    def test_deviation_schema_has_no_name_property(self):
        schema = _code_schema()
        location_props = schema["definitions"]["location"]["properties"]
        assert "name" not in location_props
        assert "code" in location_props

    def test_all_five_row_var_expressions_read_declared_field(self):
        schema = _code_schema()
        domain = resolve_ledger_domain(schema, "inventory_domain")
        ctx = _ledger_stub_field_vars(domain, schema)
        exprs = ctx["pool_location_label_exprs"]
        assert exprs["inventory"] == "(inventory.location?.code ?? '')"
        assert exprs["fromInventory"] == "(fromInventory.location?.code ?? '')"
        assert exprs["toInventory"] == "(toInventory.location?.code ?? '')"
        assert exprs["_childInv"] == "(_childInv.location?.code ?? '')"
        assert exprs["_cand"] == "(_cand.location?.code ?? '')"
        for expr in exprs.values():
            assert ".name" not in expr

    def test_reverse_lookup_field_is_declared_field_not_name(self):
        schema = _code_schema()
        domain = resolve_ledger_domain(schema, "inventory_domain")
        ctx = _ledger_stub_field_vars(domain, schema)
        assert ctx["pool_location_label_field"] == "code"

    def test_default_name_still_works(self):
        """Regression guard: an undeclared labelField (or explicit 'name')
        still resolves and renders exactly as before this fix."""
        schema = _code_schema(location_label_field="name")
        domain = resolve_ledger_domain(schema, "inventory_domain")
        ctx = _ledger_stub_field_vars(domain, schema)
        assert ctx["pool_location_label_exprs"]["inventory"] == "(inventory.location?.name ?? '')"
        assert ctx["pool_location_label_field"] == "name"

    def test_composite_label_field_fails_closed(self):
        """A composite (multi-path) location labelField is rejected for the
        whole domain: forward rendering could concatenate it, but the
        reverse lookup (denormalized string -> row) can't unambiguously
        invert a concatenated string back into per-field equality."""
        domain = _domain_dict()
        schema = {
            "x-ledger-entities": {"inventory_domain": domain},
            "definitions": {
                "inventory": {
                    "type": "object",
                    "properties": {
                        "location_id": {
                            "type": "string",
                            "x-relationship": {
                                "type": "many-to-one",
                                "target": "location",
                                "labelField": ["code", "building"],
                            },
                        },
                    },
                },
                "location": {
                    "type": "object",
                    "required": ["id", "code", "building"],
                    "properties": {
                        "id": {"type": "string"},
                        "code": {"type": "string"},
                        "building": {"type": "string"},
                    },
                },
            },
        }
        domain = resolve_ledger_domain(schema, "inventory_domain")
        with pytest.raises(ValueError, match="composite"):
            _ledger_stub_field_vars(domain, schema)

    def test_date_format_label_field_fails_closed(self):
        schema = _code_schema(location_label_field="opened_at")
        schema["definitions"]["location"]["properties"] = {
            "id": {"type": "string"},
            "opened_at": {"type": "string", "format": "date"},
        }
        domain = resolve_ledger_domain(schema, "inventory_domain")
        with pytest.raises(ValueError, match="date/time"):
            _ledger_stub_field_vars(domain, schema)


# ---------------------------------------------------------------------------
# Template-level proof: render the real templates with the 'code' deviation
# and confirm every one of the nine sites reads 'code', never 'name'.
# ---------------------------------------------------------------------------

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
    "pool_location_relation": "location",
    "pool_location_target_entity": "location",
    "pool_lot_field": "lot_number",
    "pool_expiration_field": "expiration_date",
}


def _ledger_label_ctx(location_label_field: str) -> dict:
    schema = _code_schema(location_label_field)
    domain = resolve_ledger_domain(schema, "inventory_domain")
    return _ledger_stub_field_vars(domain, schema)


class TestLedgerAdjustStubDeviation:
    def test_renders_declared_field_not_name(self):
        ctx = {
            **_COMMON_LEDGER_STUB_CTX,
            **_ledger_label_ctx("code"),
            "ledger_source": {"poolIdField": "inventory_id", "quantity_delta_field": "quantity_delta"},
        }
        rendered = _ENV.get_template("ledger_adjust_stub.ts.jinja2").render(**ctx)
        assert "location?.code" in rendered
        assert ".name" not in rendered


class TestLedgerMoveStubDeviation:
    def test_renders_declared_field_not_name_both_sides(self):
        ctx = {
            **_COMMON_LEDGER_STUB_CTX,
            **_ledger_label_ctx("code"),
            "ledger_source": {
                "fromPoolIdField": "from_inventory_id",
                "toPoolIdField": "to_inventory_id",
                "quantity_delta_field": "quantity_delta",
            },
        }
        rendered = _ENV.get_template("ledger_move_stub.ts.jinja2").render(**ctx)
        assert "fromInventory.location?.code" in rendered
        assert "toInventory.location?.code" in rendered
        assert ".name" not in rendered


class TestLedgerWriteStubDeviation:
    def test_forward_and_reverse_sites_render_declared_field_not_name(self):
        ctx = {
            **_COMMON_LEDGER_STUB_CTX,
            **_ledger_label_ctx("code"),
            "ledger_source": {
                "poolIdField": "inventory_id",
                "event_type": "receive",
                "quantity_delta_field": "quantity_delta",
                "reserved_delta_field": None,
                "reject_event_type": "receive_reject",
            },
        }
        rendered = _ENV.get_template("ledger_write_stub.ts.jinja2").render(**ctx)
        # Forward (O-6): the ledger row snapshot.
        assert "inventory.location?.code" in rendered
        # Reverse: findFirst keyed on the declared field, not 'name'.
        assert "where: { code: _sourceLocName }" in rendered
        assert "where: { name:" not in rendered
        assert ".name" not in rendered


class TestSplitActionRouteLocationLabelDeviation:
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
    }

    def _render(self):
        ctx = {**self._BASE_SPLIT_CTX, **_ledger_label_ctx("code")}
        return _ENV.get_template("split_action_route.ts.jinja2").render(**ctx)

    def test_all_split_route_location_sites_render_declared_field_not_name(self):
        rendered = self._render()
        # Site 6 (forward, auto-allocate candidate).
        assert "_cand.location?.code" in rendered
        # Site 5 (forward, specified-lot child).
        assert "_childInv.location?.code" in rendered
        # Site 9: the narrow `select: { name: true }` was widened to a full
        # `true` fetch rather than hardcoding the declared field into a
        # select projection (see generate.py docstring for the reasoning).
        assert "location: { select: { name: true } }" not in rendered
        assert "location: true" in rendered
        # Site 8 (reverse, parent reserved-row release).
        assert "where: { code: _rowLocName }" in rendered
        assert "where: { name:" not in rendered
        assert ".name" not in rendered
