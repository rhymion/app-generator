"""Tests for _validate_x_approval_combinations() and
_entity_is_write_reachable() (cmd_865).

_validate_x_approval_combinations() enforces the combination truth table
from subtask_865b's task YAML (2026-08-29 14:37 amendment -- this table
replaced three earlier separate checks, none of which survive on their own):

  Axes: S=submit_on declared, W=on_withdrawn declared, T=on_rejected
  terminal, E=is_editable (editable via any generated write path).

  Rule: S=True is valid unconditionally (all 8 W/T/E combinations). S=False
  is valid ONLY for exactly W=False, T=True, E=False -- every other S=False
  combination raises ValueError.

It also runs an independent duplicate-value check: the same (field, resolved
value) pair used by 2+ distinct declarations among submit_on/
on_approved.set_fields/on_rejected.set_fields/on_withdrawn.set_fields.

_entity_is_write_reachable() determines the E axis for a candidate entity
that declares x-generate.edit: false -- true only if some OTHER entity
embeds it as a non-independent, non-use_connect one-to-many list child
(full nested field writes), mirroring build_context.py's `embedded_ch`
filter without needing the full ctx-building pipeline.

Also verified directly against the real x-approval entities in two consumer
repos' current schemas (origin/develop, fetched 2026-08-29 -- proj_c seven
entities, proj_g three entities; see subtask_865b's report for the exact
commits) to confirm none of them are newly rejected by this validation.
"""
import pytest

from generate import _validate_x_approval_combinations, _entity_is_write_reachable


def _call(entity_name, x_approval, entity_props=None, is_editable=False):
    _validate_x_approval_combinations(
        entity_name, x_approval, entity_props or {'status': {'type': 'string'}}, is_editable,
    )


# ---------------------------------------------------------------------------
# S=True: always valid, regardless of W/T/E
# ---------------------------------------------------------------------------

class TestSubmitOnPresentAlwaysPasses:
    @pytest.mark.parametrize('on_withdrawn,terminal,is_editable', [
        ({'set_fields': {'status': 'draft'}}, True, True),
        ({'set_fields': {'status': 'draft'}}, True, False),
        ({'set_fields': {'status': 'draft'}}, False, True),
        ({'set_fields': {'status': 'draft'}}, False, False),
        (None, True, True),
        (None, True, False),
        (None, False, True),
        (None, False, False),
    ])
    def test_all_eight_combinations_pass(self, on_withdrawn, terminal, is_editable):
        x_approval = {
            'submit_on': {'status': 'submitted'},
            'on_approved': {'set_fields': {'status': 'approved'}},
            'on_rejected': {'terminal': terminal, 'set_fields': {'status': 'rejected'}},
        }
        if on_withdrawn:
            x_approval['on_withdrawn'] = on_withdrawn
        _call('widget', x_approval, is_editable=is_editable)


# ---------------------------------------------------------------------------
# S=False: valid ONLY for W=False, T=True, E=False
# ---------------------------------------------------------------------------

class TestSubmitOnAbsent:
    def test_the_one_allowed_combination_passes(self):
        _call('widget', {'on_rejected': {'terminal': True, 'set_fields': {'status': 'rejected'}}},
              is_editable=False)

    def test_on_rejected_absent_entirely_is_treated_as_non_terminal_and_fails(self):
        # No on_rejected at all -> T defaults to False (matches
        # isTerminalReject()'s runtime behavior for a model never added to
        # TERMINAL_REJECT_ENTITIES).
        with pytest.raises(ValueError, match='on_rejected.terminal'):
            _call('widget', {}, is_editable=False)

    def test_on_withdrawn_present_fails(self):
        with pytest.raises(ValueError) as exc_info:
            _call('widget', {
                'on_rejected': {'terminal': True},
                'on_withdrawn': {'set_fields': {'status': 'draft'}},
            }, is_editable=False)
        msg = str(exc_info.value)
        assert 'widget' in msg
        assert 'on_withdrawn' in msg

    def test_non_terminal_rejection_fails(self):
        with pytest.raises(ValueError, match='on_rejected.terminal'):
            _call('widget', {'on_rejected': {'terminal': False, 'set_fields': {'status': 'rejected'}}},
                  is_editable=False)

    def test_editable_fails(self):
        with pytest.raises(ValueError, match='editable'):
            _call('widget', {'on_rejected': {'terminal': True}}, is_editable=True)

    def test_all_three_violations_at_once_lists_all_reasons(self):
        with pytest.raises(ValueError) as exc_info:
            _call('widget', {
                'on_rejected': {'terminal': False},
                'on_withdrawn': {'set_fields': {'status': 'draft'}},
            }, is_editable=True)
        msg = str(exc_info.value)
        assert 'on_withdrawn' in msg
        assert 'on_rejected.terminal' in msg
        assert 'editable' in msg


# ---------------------------------------------------------------------------
# Approved constructions (a) and (b) -- must never be rejected
# ---------------------------------------------------------------------------

class TestApprovedConstructions:
    def test_construction_a_submit_on_absent_terminal_reject_not_editable(self):
        # (a) S=F, W=F, T=T, E=F -- e.g. proj_c's inventory_adjustment.
        _call('inventory_adjustment', {
            'on_approved': {'set_fields': {'status': 'approved'}, 'emit_hook': True},
            'on_rejected': {'terminal': True, 'set_fields': {'status': 'rejected'}},
        }, is_editable=False)

    def test_construction_b_submit_on_present_no_withdrawn(self):
        # (b) S=T, W=F -- approve/reject only, no withdrawal.
        _call('widget', {
            'submit_on': {'status': 'submitted'},
            'on_approved': {'set_fields': {'status': 'approved'}},
            'on_rejected': {'terminal': False, 'set_fields': {'status': 'draft'}},
        }, is_editable=True)


# ---------------------------------------------------------------------------
# Duplicate-value check (independent of the table above)
# ---------------------------------------------------------------------------

class TestDuplicateValueCheck:
    def test_on_rejected_reusing_submit_on_value_raises(self):
        with pytest.raises(ValueError) as exc_info:
            _call('widget', {
                'submit_on': {'status': 'submitted'},
                'on_rejected': {'terminal': False, 'set_fields': {'status': 'submitted'}},
            }, is_editable=True)
        msg = str(exc_info.value)
        assert "'status'" in msg
        assert "'submitted'" in msg

    def test_on_approved_and_on_rejected_sharing_a_value_raises(self):
        with pytest.raises(ValueError):
            _call('widget', {
                'submit_on': {'status': 'submitted'},
                'on_approved': {'set_fields': {'status': 'closed'}},
                'on_rejected': {'terminal': True, 'set_fields': {'status': 'closed'}},
            }, is_editable=True)

    def test_on_withdrawn_reusing_submit_on_value_raises(self):
        with pytest.raises(ValueError):
            _call('widget', {
                'submit_on': {'status': 'submitted'},
                'on_rejected': {'terminal': True, 'set_fields': {'status': 'rejected'}},
                'on_withdrawn': {'set_fields': {'status': 'submitted'}},
            }, is_editable=True)

    def test_all_distinct_values_passes(self):
        _call('widget', {
            'submit_on': {'status': 'submitted'},
            'on_approved': {'set_fields': {'status': 'approved'}},
            'on_rejected': {'terminal': False, 'set_fields': {'status': 'draft'}},
            'on_withdrawn': {'set_fields': {'status': 'draft2'}},
        }, is_editable=True)


# ---------------------------------------------------------------------------
# Real consumer-schema reproductions (proj_c seven, proj_g three) -- none
# may be newly rejected.
# ---------------------------------------------------------------------------

class TestRealConsumerSchemas:
    def test_proj_c_leave_request(self):
        _call('leave_request', {
            'submit_on': {'status': 'submitted'},
            'on_approved': {'set_fields': {'status': 'approved'}},
            'on_rejected': {'terminal': False, 'set_fields': {'status': 'rejected'}},
            'on_withdrawn': {'set_fields': {'status': 'draft'}},
        }, is_editable=True)

    def test_proj_c_maintenance_ticket(self):
        _call('maintenance_ticket', {
            'submit_on': {'status': 'open'},
            'on_approved': {'set_fields': {'status': 'approved'}, 'emit_hook': True},
            'on_rejected': {'terminal': False, 'set_fields': {'status': 'rejected'}, 'emit_hook': False},
        }, is_editable=True)

    def test_proj_c_approval_edit_terminal_test(self):
        _call('approval_edit_terminal_test', {
            'submit_on': {'status': 'pending'},
            'on_approved': {'set_fields': {'status': 'approved'}, 'emit_hook': False},
            'on_rejected': {'terminal': True, 'set_fields': {'status': 'rejected'}, 'emit_hook': False},
        }, is_editable=True)

    def test_proj_c_inventory_movement(self):
        _call('inventory_movement', {
            'on_approved': {'emit_hook': True},
            'on_rejected': {'terminal': True, 'emit_hook': False, 'set_fields': {'status': 'rejected'}},
        }, is_editable=False)

    def test_proj_c_inventory_adjustment(self):
        _call('inventory_adjustment', {
            'on_approved': {'emit_hook': True},
            'on_rejected': {'terminal': True, 'emit_hook': False, 'set_fields': {'status': 'rejected'}},
        }, is_editable=False)

    def test_proj_c_receiving_receipt_line(self):
        _call('receiving_receipt_line', {
            'on_approved': {'emit_hook': True},
            'on_rejected': {'terminal': True, 'emit_hook': False, 'set_fields': {'status': 'rejected'}},
        }, is_editable=False)

    def test_proj_c_purchase_per_item(self):
        _call('purchase_per_item', {
            'on_approved': {'emit_hook': True},
            'on_rejected': {'terminal': True, 'emit_hook': True},
        }, is_editable=False)

    def test_proj_g_goods_receipt_line(self):
        _call('goods_receipt_line', {
            'on_approved': {'emit_hook': True, 'set_fields': {'status': 'accepted'}},
            'on_rejected': {'terminal': True, 'set_fields': {'status': 'rejected'}},
        }, is_editable=False)

    def test_proj_g_inventory_reservation(self):
        _call('inventory_reservation', {
            'on_approved': {'emit_hook': True, 'set_fields': {'status': 'active'}},
            'on_rejected': {'terminal': True, 'emit_hook': True, 'set_fields': {'status': 'released'}},
        }, is_editable=False)

    def test_proj_g_shipment_line(self):
        _call('shipment_line', {
            'on_approved': {'emit_hook': True, 'set_fields': {'status': 'shipped'}},
            'on_rejected': {'terminal': True, 'set_fields': {'status': 'rejected'}},
        }, is_editable=False)


# ---------------------------------------------------------------------------
# _entity_is_write_reachable(): the E axis for a can_update=False entity
# ---------------------------------------------------------------------------

class TestEntityIsWriteReachable:
    def test_own_x_generate_declared_is_independent_never_reachable(self):
        # receiving_receipt_line-shaped: has its own x-generate (list/view
        # pages), embedded as a required-FK list child of a parent -- still
        # excluded, because build_context.py's embedded_ch never embeds an
        # independent child regardless of the FK's nullability.
        defs = {
            '__parent': {
                'properties': {
                    'lines': {'type': 'array', 'items': {'$ref': '#/definitions/child'}},
                },
            },
            '__child': {
                'x-generate': {'list': True, 'view': True, 'edit': False},
                'properties': {
                    'parent_id': {'type': 'string'},
                    'status': {'type': 'string'},
                },
            },
        }
        assert _entity_is_write_reachable('child', defs) is False

    def test_non_independent_required_fk_list_child_is_reachable(self):
        defs = {
            '__parent': {
                'properties': {
                    'lines': {'type': 'array', 'items': {'$ref': '#/definitions/child'}},
                },
            },
            '__child': {
                # No x-generate at all -- a plain embedded line item with no
                # page of its own.
                'properties': {
                    'parent_id': {'type': 'string'},
                    'status': {'type': 'string'},
                },
            },
        }
        assert _entity_is_write_reachable('child', defs) is True

    def test_nullable_fk_list_child_is_use_connect_not_reachable(self):
        defs = {
            '__parent': {
                'properties': {
                    'children': {'type': 'array', 'items': {'$ref': '#/definitions/child'}},
                },
            },
            '__child': {
                'properties': {
                    'parent_id': {'type': ['string', 'null']},
                    'status': {'type': 'string'},
                },
            },
        }
        assert _entity_is_write_reachable('child', defs) is False

    def test_no_ancestor_embeds_it_not_reachable(self):
        defs = {
            '__standalone': {
                'properties': {'status': {'type': 'string'}},
            },
        }
        assert _entity_is_write_reachable('standalone', defs) is False
