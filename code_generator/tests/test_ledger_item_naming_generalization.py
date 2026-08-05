"""
Deviation-injection tests for item-master naming generalization.

Axis 1: generators_test.py's helper_context() compared primary_fk_dep_target
  (a reference name, e.g. 'product') against dep['target'] (an entity name,
  e.g. 'item') — a snake_case-vs-camelCase mismatch on top of a reference-name-
  vs-entity-name mismatch, so `needs_second` (and therefore `primary: true`
  support for FK primary display fields) silently broke whenever an entity's
  reference name differed from its target entity name, or was multi-word.

Axis 2: generate.py's item-field detector compared a relation's target
  entity literally against 'product' — silently returning None (no error, no
  warning) for any consumer naming the item-master entity something other
  than 'product' (e.g. 'item'). This disabled the split-route
  lot/product-mismatch check and the auto-allocate WHERE-clause item filter
  (which rendered a literal `.None` — an always-undefined property access,
  silently dropping the item filter from the Prisma query).

Axis 3: the ledger domain's own pool-entity column names (item/location/lot/
  expiration FK and scalar field names) were hardcoded as literal
  'product_id'/'location'/'lot_number'/'expiration_date' throughout
  generators.py and the ledger_*_stub / split_action_route templates,
  breaking for any consumer naming these columns differently.

All three fixes replace literal-name comparisons/hardcodes with schema-
derived, explicitly-declared (no-default) resolution. These tests exercise
a real-world-shaped mismatch directly: an item-master entity named 'item',
referenced via a property named 'product' with FK column 'product_id' — the
exact combination that motivated this generalization.
"""
import pytest

from generate import pool_relation_target, detect_product_id_field
from generators_test import helper_context
from helpers.schema_helpers import resolve_ledger_domain
from jinja2 import Environment, FileSystemLoader
from pathlib import Path
from helpers.naming import to_pascal_case, to_camel_case


# ---------------------------------------------------------------------------
# Axis 1: reference name != entity name, multi-word reference name
# ---------------------------------------------------------------------------

def _mismatched_name_schema() -> dict:
    """Item-master reference name 'product' -> entity name 'item', FK column
    'product_id'. x-display.table primary is the reference name 'product',
    not the entity name 'item'."""
    return {
        "definitions": {
            "item": {
                "type": "object",
                "required": ["id", "sku"],
                "properties": {
                    "id": {"type": "string"},
                    "sku": {"type": "string"},
                },
            },
            "inventory": {
                "type": "object",
                "required": ["id", "product_id", "quantity"],
                "properties": {
                    "id": {"type": "string"},
                    "product_id": {
                        "type": "string",
                        "x-relationship": {"type": "many-to-one", "target": "item", "labelField": "sku"},
                    },
                    "quantity": {"type": "integer"},
                },
                "x-display": {"table": [{"product": {"primary": True}}]},
            },
            "inventory_detail": {"allOf": [{"$ref": "#/definitions/inventory"}]},
        },
    }


def _entity_config():
    return {
        "list": True, "view": True, "new": True, "edit": True,
        "delete": True, "api": False, "test": False, "fields": None,
    }


class TestPrimaryFkReferenceNameNotEntityName:
    """helper_context()'s primary_fk_dep / needs_second must key off the
    reference name (x-display.table key), not the entity name — proven
    against a schema where reference name ('product') differs from the
    target entity name ('item')."""

    def test_primary_fk_dep_resolved_despite_name_mismatch(self):
        schema = _mismatched_name_schema()
        ctx = helper_context("inventory", [], schema, "inventory", "inventory_detail", _entity_config())
        assert ctx["primary_fk_dep"] is not None, (
            "primary_fk_dep must resolve even though the reference name "
            "('product') differs from the target entity name ('item')."
        )
        assert ctx["primary_fk_dep"]["target"] == "item"
        assert ctx["primary_fk_dep"]["needs_second"] is True

    def test_multiword_reference_name_still_matches_after_camelcase_fix(self):
        """Regression guard for the fix's own pitfall: comparing
        dep['var_name'] (camelCase) against the raw snake_case
        primary_fk_dep_target breaks for any multi-word reference name (e.g.
        'patient_rel' -> 'patientRel') even when reference name == entity
        name."""
        schema = {
            "definitions": {
                "patient": {
                    "type": "object", "required": ["id", "name"],
                    "properties": {"id": {"type": "string"}, "name": {"type": "string"}},
                },
                "patient_rel": {
                    "type": "object",
                    "required": ["id", "patient_no", "patient_id"],
                    "properties": {
                        "id": {"type": "string"},
                        "patient_no": {"type": "string"},
                        "patient_id": {
                            "type": "string",
                            "x-relationship": {"type": "many-to-one", "target": "patient", "labelField": "name"},
                        },
                    },
                },
                "checkup": {
                    "type": "object",
                    "required": ["id", "patient_rel_id", "checkup_date"],
                    "properties": {
                        "id": {"type": "string"},
                        "patient_rel_id": {
                            "type": "string",
                            "x-relationship": {"type": "many-to-one", "target": "patient_rel", "labelField": "patient_no"},
                        },
                        "checkup_date": {"type": "string", "format": "date"},
                    },
                    "x-display": {"table": [{"patient_rel": {"primary": True}}]},
                },
                "checkup_detail": {"allOf": [{"$ref": "#/definitions/checkup"}]},
            },
        }
        ctx = helper_context("checkup", [], schema, "checkup", "checkup_detail", _entity_config())
        assert ctx["primary_fk_dep"] is not None
        assert ctx["primary_fk_dep"]["target"] == "patient_rel"
        assert ctx["primary_fk_dep"]["needs_second"] is True


# ---------------------------------------------------------------------------
# Axis 2: detect_product_id_field / pool_relation_target
# ---------------------------------------------------------------------------

def _pool_and_split_entity_with_mismatched_names() -> dict:
    """Pool entity 'inventory' has FK 'product_id' targeting entity 'item'.
    Split entity 'goods_receipt_line' has its own FK 'item_id' targeting the
    same 'item' entity — a differently-named field than the pool's."""
    return {
        "item": {
            "type": "object",
            "required": ["id", "sku"],
            "properties": {"id": {"type": "string"}, "sku": {"type": "string"}},
        },
        "inventory": {
            "type": "object",
            "required": ["id", "product_id"],
            "properties": {
                "id": {"type": "string"},
                "product_id": {
                    "type": "string",
                    "x-relationship": {"type": "many-to-one", "target": "item", "labelField": "sku"},
                },
            },
        },
        "goods_receipt_line": {
            "type": "object",
            "required": ["id", "item_id"],
            "properties": {
                "id": {"type": "string"},
                "item_id": {
                    "type": "string",
                    "x-relationship": {"type": "many-to-one", "target": "item", "labelField": "sku"},
                },
            },
        },
    }


class TestPoolRelationTargetAndDetectProductIdField:
    """Schema-derived resolution replacing a literal target == 'product'
    comparison."""

    def test_pool_relation_target_resolves_configured_field(self):
        schema = {"definitions": _pool_and_split_entity_with_mismatched_names()}
        target = pool_relation_target("inventory", "product_id", schema)
        assert target == "item", (
            "pool_relation_target must resolve the *target entity* of the "
            "domain-configured item field, not assume it's named 'product'."
        )

    def test_detect_product_id_field_finds_differently_named_split_field(self):
        defs = _pool_and_split_entity_with_mismatched_names()
        pool_item_target = pool_relation_target("inventory", "product_id", {"definitions": defs})
        split_field = detect_product_id_field(defs["goods_receipt_line"]["properties"], pool_item_target)
        assert split_field == "item_id", (
            "detect_product_id_field must find goods_receipt_line's own item "
            "FK ('item_id') by resolving through the shared target entity "
            "('item'), not by looking for a field named literally 'product_id' "
            "or an entity named literally 'product'."
        )

    def test_no_matching_relation_returns_none(self):
        """An entity with no FK to the pool's item-master entity correctly
        yields None (used by generate.py's fail-loud guard for reserve-type
        splittable entities, and the {% if split_item_field %} guard for
        receive-type ones)."""
        assert detect_product_id_field({"unrelated": {"type": "string"}}, "item") is None
        assert detect_product_id_field(
            {"item_id": {"x-relationship": {"type": "many-to-one", "target": "item"}}}, None,
        ) is None


class TestResolveLedgerDomainRequiredKeys:
    """itemField/locationField/lotField/expirationField are required with no
    defaults — a domain missing any of them must fail loud, naming the
    domain and the missing key, not silently fall back to
    'product'/'location'/etc."""

    def _domain(self, **overrides):
        base = {
            "pool": "inventory", "ledger": "inventory_transaction",
            "transactionable": "inventory_transactionable",
            "itemField": "product_id", "locationField": "location_id",
            "lotField": "lot_number", "expirationField": "expiration_date",
        }
        base.update(overrides)
        return base

    def _schema(self, location_target_entity="location", label_field="name", **domain_overrides):
        """Full schema: x-ledger-entities domain plus the pool entity's own
        definition declaring x-relationship.target/labelField on its
        locationField — cmd_550's resolve_ledger_domain reads this the same
        way build_label_expression's other call sites do, instead of
        hardcoding `.name`."""
        domain = self._domain(**domain_overrides)
        location_field = domain["locationField"]
        return {
            "x-ledger-entities": {"inventory_domain": domain},
            "definitions": {
                domain["pool"]: {
                    "type": "object",
                    "properties": {
                        location_field: {
                            "type": "string",
                            "x-relationship": {
                                "type": "many-to-one",
                                "target": location_target_entity,
                                "labelField": label_field,
                            },
                        },
                    },
                },
                location_target_entity: {
                    "type": "object",
                    "properties": {"id": {"type": "string"}, label_field: {"type": "string"}},
                },
            },
        }

    def test_fully_declared_domain_resolves(self):
        schema = self._schema()
        resolved = resolve_ledger_domain(schema, "inventory_domain")
        assert resolved["item_field"] == "product_id"
        assert resolved["location_field"] == "location_id"
        assert resolved["location_relation"] == "location"
        assert resolved["location_label_field"] == "name"
        assert resolved["location_label_target"] == "location"
        assert resolved["lot_field"] == "lot_number"
        assert resolved["expiration_field"] == "expiration_date"

    @pytest.mark.parametrize("missing_key", ["itemField", "locationField", "lotField", "expirationField"])
    def test_missing_required_key_fails_loud_and_names_it(self, missing_key):
        domain = self._domain()
        del domain[missing_key]
        schema = {"x-ledger-entities": {"inventory_domain": domain}}
        with pytest.raises(ValueError) as exc_info:
            resolve_ledger_domain(schema, "inventory_domain")
        assert "inventory_domain" in str(exc_info.value)
        assert missing_key in str(exc_info.value)

    def test_location_relation_strips_id_suffix_not_literal_location(self):
        """Regression guard: location_relation must be *derived* from
        locationField (strip '_id'), not hardcoded to 'location' — proven by
        a domain that names its location FK column something else."""
        schema = self._schema(locationField="warehouse_slot_id")
        resolved = resolve_ledger_domain(schema, "inventory_domain")
        assert resolved["location_relation"] == "warehouse_slot"

    def test_location_label_field_defaults_to_name_when_undeclared(self):
        """A location FK relation with no explicit labelField falls back to
        'name' — the same fallback build_label_expression itself applies,
        not a second independent default."""
        domain = self._domain()
        schema = {
            "x-ledger-entities": {"inventory_domain": domain},
            "definitions": {
                domain["pool"]: {
                    "type": "object",
                    "properties": {
                        domain["locationField"]: {
                            "type": "string",
                            "x-relationship": {"type": "many-to-one", "target": "location"},
                        },
                    },
                },
                "location": {"type": "object", "properties": {"id": {"type": "string"}, "name": {"type": "string"}}},
            },
        }
        resolved = resolve_ledger_domain(schema, "inventory_domain")
        assert resolved["location_label_field"] == "name"
        assert resolved["location_label_target"] == "location"

    def test_non_relation_location_field_fails_loud(self):
        """cmd_550: a locationField declared without x-relationship.target
        (e.g. a bare string column, not a FK/relation) must fail loud rather
        than silently falling back to a broken `.name` access on a string."""
        domain = self._domain()
        schema = {
            "x-ledger-entities": {"inventory_domain": domain},
            "definitions": {
                domain["pool"]: {
                    "type": "object",
                    "properties": {domain["locationField"]: {"type": "string"}},
                },
            },
        }
        with pytest.raises(ValueError) as exc_info:
            resolve_ledger_domain(schema, "inventory_domain")
        assert "location_id" in str(exc_info.value)
        assert "x-relationship.target" in str(exc_info.value)

    def test_location_label_field_reads_declared_non_name_display_field(self):
        """Deviation injection: a location entity whose display field is
        'label', not 'name' — resolve_ledger_domain must surface the
        declared labelField ('label'), not silently assume 'name'."""
        schema = self._schema(location_target_entity="warehouse_slot", label_field="label")
        resolved = resolve_ledger_domain(schema, "inventory_domain")
        assert resolved["location_label_field"] == "label"
        assert resolved["location_label_target"] == "warehouse_slot"


# ---------------------------------------------------------------------------
# Template-level proof: split_action_route.ts.jinja2 auto-allocate WHERE
# clause and lot-mismatch check, before/after split_item_field resolution.
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
    "pool_item_field": "product_id",
    "pool_location_field": "location_id",
    "pool_location_relation": "location",
    "pool_location_target_entity": "location",
    "pool_lot_field": "lot_number",
    "pool_expiration_field": "expiration_date",
    # cmd_550 follow-up: split_action_route.ts.jinja2 now reads the pool
    # entity's declared location labelField through these two context vars
    # (see generate.py's _ledger_stub_field_vars) instead of hardcoding
    # `.name` / `where: { name: ... }`. This fixture's location entity
    # displays 'name' (the common case) — see
    # test_ledger_stub_location_label_field.py for the 'code' deviation.
    "pool_location_label_exprs": {
        "inventory": "(inventory.location?.name ?? '')",
        "fromInventory": "(fromInventory.location?.name ?? '')",
        "toInventory": "(toInventory.location?.name ?? '')",
        "_childInv": "(_childInv.location?.name ?? '')",
        "_cand": "(_cand.location?.name ?? '')",
    },
    "pool_location_label_field": "name",
}


def _render_split_route(split_item_field):
    ctx = {**_BASE_SPLIT_CTX, "split_item_field": split_item_field}
    return _ENV.get_template("split_action_route.ts.jinja2").render(**ctx)


class TestSplitActionRouteItemFieldRendering:
    """Deviation injection: render the real template with
    split_item_field=None (the historical return value of the item-field
    detector for any consumer not named 'product') to reproduce the exact
    silent bug, then with a resolved value to show the fix."""

    def test_split_item_field_none_reproduces_dot_none_bug(self):
        rendered = _render_split_route(None)
        assert "_parentForProduct.None as string" in rendered, (
            "With split_item_field=None (the historical detector return "
            "value whenever the item-master entity isn't literally named "
            "'product'), the auto-allocate WHERE clause renders "
            "`_parentForProduct.None` — Jinja2 stringifies Python None as the "
            "literal text 'None', producing an always-undefined property "
            "access that Prisma silently treats as 'no item filter'."
        )
        assert "_childEffectiveProductId" not in rendered, (
            "The lot/product-mismatch check must be absent when split_item_field "
            "is None — it's gated by {% if split_item_field %}."
        )

    def test_split_item_field_resolved_renders_correctly(self):
        rendered = _render_split_route("item_id")
        assert "_parentForProduct.None as string" not in rendered
        assert "_parentForProduct.item_id as string" in rendered, (
            "With split_item_field resolved to the split entity's real FK "
            "name ('item_id'), the auto-allocate WHERE clause must filter "
            "on that real field."
        )
        assert "_childEffectiveProductId = (part.item_id ?? parent.item_id)" in rendered, (
            "The lot/product-mismatch check must render using the resolved field."
        )
        assert "product_id: _cand.product_id" in rendered, (
            "The pool entity's own item column (pool_item_field='product_id' "
            "in this fixture) is a separate axis from split_item_field — it's "
            "ledger-domain-level config, unaffected by which field name the "
            "split entity itself happens to use."
        )
