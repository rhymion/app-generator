"""
Tests for the `x-fk-constrained` field-level schema key (subtask_935d).

An optional many-to-one FK field can carry a cross-field consistency
invariant enforced only by hand-written custom validation (e.g. an
inventory FK that must reference a row for the same item as the line's own
item FK) -- json_schema.yaml has no declarative way to express that. The
generated "3.1 adds optional data and child items" test fills every
optional field independently, using whatever populate*Dependencies()
happened to seed -- it has no way to know about, let alone satisfy, a
cross-field invariant tied to another field. `x-fk-constrained: true`
excludes the field from that one fill step; "3.2 removes optional data"
(clearing to null never re-triggers a same-item check) and "2.2 creates
with full data" (filled via populate*Full(), not this per-field path) are
both unaffected.

Reproduces the real bug live in an inventory-tracking app's
shipment_line.cy.ts ("3.1 adds optional data and child items").
"""
from generators_test import spec_context

_GEN_CFG = {
    'list': True, 'view': True, 'new': True, 'edit': True, 'delete': True,
    'api': True, 'test': True, 'fields': None,
}


def _item_def() -> dict:
    return {
        'type': 'object',
        'required': ['id', 'name'],
        'properties': {
            'id': {'type': 'string', 'pattern': '^c[a-z0-9]{24,}$'},
            'name': {'type': 'string'},
        },
    }


def _bin_def() -> dict:
    return {
        'type': 'object',
        'required': ['id', 'name'],
        'properties': {
            'id': {'type': 'string', 'pattern': '^c[a-z0-9]{24,}$'},
            'name': {'type': 'string'},
        },
    }


def _line_def(fk_constrained: bool) -> dict:
    inventory_field: dict = {
        'type': ['string', 'null'],
        'x-relationship': {'type': 'many-to-one', 'target': 'item', 'labelField': 'name'},
    }
    if fk_constrained:
        inventory_field['x-fk-constrained'] = True
    return {
        'type': 'object',
        'required': ['id', 'item_id'],
        'properties': {
            'id': {'type': 'string', 'pattern': '^c[a-z0-9]{24,}$'},
            'item_id': {
                'type': 'string',
                'x-relationship': {'type': 'many-to-one', 'target': 'item', 'labelField': 'name'},
            },
            'inventory_id': inventory_field,
            'bin_id': {
                'type': ['string', 'null'],
                'x-relationship': {'type': 'many-to-one', 'target': 'bin', 'labelField': 'name'},
            },
        },
    }


def _schema(fk_constrained: bool) -> dict:
    return {
        'definitions': {
            'item': _item_def(),
            'bin': _bin_def(),
            'line': _line_def(fk_constrained),
            'line_detail': {'allOf': [{'$ref': '#/definitions/line'}]},
        },
    }


class TestFkConstrainedExcludedFromOptionalFill3_1:
    def test_marked_field_excluded_from_3_1_fill(self):
        schema = _schema(fk_constrained=True)
        ctx = spec_context('line', [], schema, 'line', 'line_detail', _GEN_CFG)
        assert not any('Inventory' in cmd for cmd in ctx['opt_fill_cmds_3_1'])

    def test_3_2_clear_untouched_either_way(self):
        # opt_clear_cmds_3_2 already excludes every autocomplete-category
        # field categorically (id/FK fields are never clear targets there),
        # independent of this key -- confirms the key changes nothing on
        # that side, marked or not.
        marked = spec_context('line', [], _schema(fk_constrained=True), 'line', 'line_detail', _GEN_CFG)
        unmarked = spec_context('line', [], _schema(fk_constrained=False), 'line', 'line_detail', _GEN_CFG)
        assert not any('Inventory' in cmd for cmd in marked['opt_clear_cmds_3_2'])
        assert not any('Inventory' in cmd for cmd in unmarked['opt_clear_cmds_3_2'])

    def test_unmarked_sibling_optional_fk_still_filled_in_3_1(self):
        schema = _schema(fk_constrained=True)
        ctx = spec_context('line', [], schema, 'line', 'line_detail', _GEN_CFG)
        assert any('Bin' in cmd for cmd in ctx['opt_fill_cmds_3_1'])

    def test_without_the_key_field_is_a_normal_optional_fill_target(self):
        schema = _schema(fk_constrained=False)
        ctx = spec_context('line', [], schema, 'line', 'line_detail', _GEN_CFG)
        assert any('Inventory' in cmd for cmd in ctx['opt_fill_cmds_3_1'])
