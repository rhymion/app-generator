"""
cmd_856 (subtask_856a design, subtask_856b impl): a reservation lines entity
(x-reservation, transaction.strategy: ledger_transaction, lines resolved via
build_context.py's children/x-reservation.lines) that ALSO declares its own
x-approval.submit_on -- e.g. purchase_per_item under purchase_order. Covers
the five generator changes from subtask_856a's design:

  変更1: _build_approval_lines_post_create_code() skips approval_request
         creation for a lines entity with its own submit_on (the pre-created
         approvable stays; only the request-creation loop is skipped).
  変更2: _build_reservation_guard_and_resubmit_approval_lines() no longer
         blocks new-line addition at all (removed regardless of submit_on).
  変更3: service_context()'s has_submit_on also looks at the lines entity's
         own submit_on -- the parent's create-time reservation_allocation_code
         must defer when the lines entity (not the parent itself) has
         submit_on.
  変更4: service_context()'s has_approvable_bridge-and-not-can_create branch
         builds a per-line submit_for_approval_action_code for a new:false/
         edit:false lines entity, claiming inventory against the PARENT's
         reservation config.
  変更5: the resubmit-claim/new-approval_request machinery inside
         _build_reservation_guard_and_resubmit_approval_lines() is skipped
         entirely when the lines entity has its own submit_on (resubmission
         goes exclusively through that line's own submit_for_approval action).

Fixture shape mirrors the real purchase_order/purchase_per_item schema
(app-template, post subtask_856a task_I) but lives entirely in this test
file's own in-memory dicts -- no test entity is added to app-generator's own
default json_schema.yaml (cmd_855's warning).
"""
from build_context import build_context
from generators import (
    service_context,
    _build_approval_lines_post_create_code,
    _build_reservation_mutation_guard_update,
)


# ---------------------------------------------------------------------------
# Shared fixture: purchase_order (x-reservation, ledger_transaction, lines)
# + purchase_per_item (the lines entity, x-approval, approvable bridge)
# ---------------------------------------------------------------------------

def _x_approval(has_submit_on: bool) -> dict:
    x_approval = {
        'on_approved': {'emit_hook': True},
        'on_rejected': {'terminal': True, 'emit_hook': True},
    }
    if has_submit_on:
        x_approval['submit_on'] = {'status': 'pending'}
    return x_approval


def _schema(has_submit_on: bool = True) -> dict:
    return {
        'definitions': {
            'approvable': {
                'type': 'object',
                'properties': {'id': {'type': 'string', 'pattern': '^c[a-z0-9]{24,}$'}},
            },
            'product': {
                'type': 'object',
                'properties': {
                    'id': {'type': 'string', 'pattern': '^c[a-z0-9]{24,}$'},
                    'name': {'type': 'string'},
                },
            },
            'location': {
                'type': 'object',
                'properties': {
                    'id': {'type': 'string', 'pattern': '^c[a-z0-9]{24,}$'},
                    'name': {'type': 'string'},
                },
            },
            'inventory': {
                'type': 'object',
                'properties': {
                    'id': {'type': 'string', 'pattern': '^c[a-z0-9]{24,}$'},
                    'product_id': {
                        'type': 'string',
                        'x-relationship': {'type': 'many-to-one', 'target': 'product', 'labelField': 'name'},
                    },
                    'location_id': {
                        'type': 'string',
                        'x-relationship': {'type': 'many-to-one', 'target': 'location', 'labelField': 'name'},
                    },
                    'quantity': {'type': 'integer', 'minimum': 0},
                    'reserved_quantity': {'type': 'integer', 'minimum': 0},
                    'lot_number': {'type': ['string', 'null']},
                    'expiration_date': {'type': ['string', 'null'], 'format': 'date'},
                },
            },
            'purchase_per_item': {
                'type': 'object',
                'required': ['id', 'approvable_id', 'status'],
                'x-approval': _x_approval(has_submit_on),
                'properties': {
                    'id': {'type': 'string', 'pattern': '^c[a-z0-9]{24,}$'},
                    'purchase_order_id': {'type': 'string', 'pattern': '^c[a-z0-9]{24,}$'},
                    'product_id': {
                        'type': 'string',
                        'x-relationship': {'type': 'many-to-one', 'target': 'product', 'labelField': 'name'},
                    },
                    'quantity': {'type': 'integer', 'minimum': 1},
                    'approvable_id': {
                        'type': 'string',
                        'x-relationship': {'type': 'one-to-one_bridge', 'target': 'approvable', 'labelField': 'id'},
                    },
                    'inventory_transactionable_id': {
                        'type': ['string', 'null'], 'pattern': '^c[a-z0-9]{24,}$',
                    },
                    'status': {
                        'type': 'string',
                        'enum': ['draft', 'pending', 'split', 'rejected'],
                        'default': 'draft',
                    },
                },
            },
            'purchase_order': {
                'type': 'object',
                'required': ['id', 'items'],
                'x-approval-lines': ['items'],
                'x-reservation': {
                    'mode': 'count',
                    'transaction': {'strategy': 'ledger_transaction', 'ledgerDomain': 'inventory_domain'},
                    'lines': 'items',
                    'pool': {'quantityField': 'quantity', 'reservedField': 'reserved_quantity'},
                    'request': {'quantityField': 'quantity', 'criteria': {'product_id': 'product_id'}},
                    'policy': {'orderBy': [
                        {'expiration_date': 'asc_nulls_last'},
                        {'lot_number': 'asc'},
                        {'id': 'asc'},
                    ]},
                    'result': {
                        'parentField': 'purchase_order_id',
                        'lineTransactionableField': 'inventory_transactionable_id',
                        'quantityField': 'quantity',
                    },
                },
                'properties': {
                    'id': {'type': 'string', 'pattern': '^c[a-z0-9]{24,}$'},
                    'items': {'type': 'array', 'items': {'$ref': '#/definitions/purchase_per_item'}},
                },
            },
        },
        'x-ledger-entities': {
            'inventory_domain': {
                'pool': 'inventory',
                'ledger': 'inventory_transaction',
                'transactionable': 'inventory_transactionable',
                'itemField': 'product_id',
                'locationField': 'location_id',
                'lotField': 'lot_number',
                'expirationField': 'expiration_date',
            },
        },
    }


def _entity_spec(model: str, schema: dict, children: list = None, gen_cfg: dict = None) -> dict:
    return {
        'parent': model,
        'model': model,
        'definition_key': f'{model}_detail',
        'children': children or [],
        'generate_config': gen_cfg or {
            'list': True, 'view': True, 'new': True, 'edit': True,
            'delete': True, 'api': False, 'test': False, 'fields': None,
        },
    }


def _lines_child() -> dict:
    return {
        'name': 'purchase_per_item',
        'property_name': 'items',
        'output_type': 'list',
        'file_type': None,
        'relationship': None,
    }


def _parent_svc(has_submit_on: bool = True):
    schema = _schema(has_submit_on)
    entity = _entity_spec('purchase_order', schema, children=[_lines_child()])
    ctx = build_context(entity, schema)
    return service_context(ctx, schema), schema, ctx


def _child_svc(has_submit_on: bool = True):
    schema = _schema(has_submit_on)
    entity = _entity_spec('purchase_per_item', schema, gen_cfg={
        'list': True, 'view': True, 'new': False, 'edit': False,
        'delete': False, 'api': False, 'test': True, 'fields': None,
    })
    ctx = build_context(entity, schema)
    return service_context(ctx, schema), schema, ctx


# ---------------------------------------------------------------------------
# 変更1: post-create approval_request loop value-checks submit_on lines
# (cmd_871 [乙]: a bare call -- no reservation_config, matching the update
# call site -- generates the value-checked block instead of skipping
# outright; only a line actually created in its submit_on state fires
# approval_request creation.)
# ---------------------------------------------------------------------------

class TestChange1PostCreateSkipsSubmitOnLines:
    def test_pending_line_creates_approval_request_when_lines_entity_has_submit_on(self):
        schema = _schema(has_submit_on=True)
        parent_def = schema['definitions']['purchase_order']
        out = _build_approval_lines_post_create_code(parent_def, 'purchase_order', schema)
        assert out != '', (
            'submit_on lines entity must still generate the value-checked '
            'approval_request creation block (cmd_871) -- only the runtime '
            'check gates it now, not the declaration'
        )
        assert "if (_apprTargetRow?.status !== 'pending') continue;" in out
        assert 'tx.approval_request.create' in out

    def test_draft_line_skipped_by_value_check_when_lines_entity_has_submit_on(self):
        """The generated code still skips a draft-state line at runtime --
        it is the VALUE check, not the declaration, doing the skipping now."""
        schema = _schema(has_submit_on=True)
        parent_def = schema['definitions']['purchase_order']
        out = _build_approval_lines_post_create_code(parent_def, 'purchase_order', schema)
        assert "if (_apprTargetRow?.status !== 'pending') continue;" in out

    def test_approval_request_create_unchanged_when_lines_entity_has_no_submit_on(self):
        schema = _schema(has_submit_on=False)
        parent_def = schema['definitions']['purchase_order']
        out = _build_approval_lines_post_create_code(parent_def, 'purchase_order', schema)
        assert out, 'a lines entity without submit_on must keep the original behaviour'
        assert 'tx.approval_request.create' in out


# ---------------------------------------------------------------------------
# 変更2: new-line addition guard removed (regardless of submit_on)
# ---------------------------------------------------------------------------

class TestChange2AdditionGuardRemoved:
    def _guard(self, has_submit_on: bool) -> str:
        schema = _schema(has_submit_on)
        entity = _entity_spec('purchase_order', schema, children=[_lines_child()])
        ctx = build_context(entity, schema)
        rc = ctx['reservation_config']
        return _build_reservation_mutation_guard_update(rc, 'purchase_order', schema)

    def test_no_any_line_locked_variable_with_submit_on(self):
        guard = self._guard(has_submit_on=True)
        assert '_anyLineLocked' not in guard

    def test_no_any_line_locked_variable_without_submit_on(self):
        guard = self._guard(has_submit_on=False)
        assert '_anyLineLocked' not in guard

    def test_no_addition_guard_throw_pattern(self):
        for has_submit_on in (True, False):
            guard = self._guard(has_submit_on)
            assert 'Items.some((i) => !i.id)' not in guard

    def test_per_line_value_change_guard_preserved(self):
        """変更2 removes only the addition guard -- the per-line
        value-change/deletion guard (locked lines only) must still throw."""
        for has_submit_on in (True, False):
            guard = self._guard(has_submit_on)
            assert 'if (_lineNet > 0) {' in guard
            assert "throw new ReservationMutationError('Cannot modify reservation criteria after allocation.');" in guard


# ---------------------------------------------------------------------------
# 変更3: parent's has_submit_on also looks at the lines entity
# ---------------------------------------------------------------------------

class TestChange3ParentDefersToLinesSubmitOn:
    def test_parent_reservation_allocation_deferred_when_lines_has_submit_on(self):
        svc, _, _ = _parent_svc(has_submit_on=True)
        assert svc['reservation_allocation_code'] == '', (
            'a batch of still-draft lines must not be allocated in bulk at '
            'parent create time when the lines entity itself gates '
            'allocation behind its own submit_on'
        )

    def test_parent_reservation_allocation_fires_when_lines_has_no_submit_on(self):
        svc, _, _ = _parent_svc(has_submit_on=False)
        assert svc['reservation_allocation_code'] != '', (
            'backward compatibility: a lines entity with x-approval but no '
            'submit_on keeps the original create-time bulk allocation'
        )
        assert 'inventory_transactionable.create' in svc['reservation_allocation_code']

    def test_parent_itself_has_no_approvable_bridge(self):
        """purchase_order has no x-approval of its own -- has_approvable_bridge
        is False for it either way; the parent-side edge-trigger/submit-action
        block never applies to it."""
        svc, _, _ = _parent_svc(has_submit_on=True)
        assert svc['submit_for_approval_action_code'] == ''
        assert svc['approval_edge_trigger_create_code'] == ''


# ---------------------------------------------------------------------------
# 変更4: child (lines entity) gets a per-line submit_for_approval action
# ---------------------------------------------------------------------------

class TestChange4ChildSubmitAction:
    def test_submit_action_generated_for_new_false_edit_false_lines_entity(self):
        svc, _, ctx = _child_svc(has_submit_on=True)
        assert ctx['can_create'] is False
        assert ctx['can_update'] is False
        assert svc['submit_for_approval_action_code'], (
            'a new:false/edit:false lines entity with its own submit_on + '
            'approvable bridge must still get a standalone submit action'
        )

    def test_submit_action_claims_inventory_and_creates_bridge(self):
        svc, _, _ = _child_svc(has_submit_on=True)
        code = svc['submit_for_approval_action_code']
        assert 'inventory_transactionable.create' in code
        assert 'InsufficientPoolCapacityError' in code
        assert 'inventory_transactionable_id: bridge.id' in code

    def test_submit_action_reads_own_row_fields_for_criteria(self):
        """Self-case criteria reads off the row itself (row.product_id), not
        a `_line` loop variable -- there is exactly one line being submitted."""
        svc, _, _ = _child_svc(has_submit_on=True)
        code = svc['submit_for_approval_action_code']
        assert 'row as Record<string, unknown>).product_id' in code

    def test_reservation_error_import_model_points_at_parent(self):
        svc, _, _ = _child_svc(has_submit_on=True)
        assert svc['reservation_error_import_model'] == 'purchase_order'

    def test_no_submit_action_when_lines_entity_has_no_submit_on(self):
        svc, _, _ = _child_svc(has_submit_on=False)
        assert svc['submit_for_approval_action_code'] == ''
        assert svc['reservation_error_import_model'] == ''


# ---------------------------------------------------------------------------
# 変更5: resubmit-claim/new-approval_request machinery skipped for submit_on lines
# ---------------------------------------------------------------------------

class TestChange5ResubmitSkippedForSubmitOnLines:
    def _guard(self, has_submit_on: bool) -> str:
        schema = _schema(has_submit_on)
        entity = _entity_spec('purchase_order', schema, children=[_lines_child()])
        ctx = build_context(entity, schema)
        rc = ctx['reservation_config']
        return _build_reservation_mutation_guard_update(rc, 'purchase_order', schema)

    def test_no_resubmit_identifiers_when_lines_entity_has_submit_on(self):
        guard = self._guard(has_submit_on=True)
        for token in (
            '_lineIsWithdrawn', '_lineLatestRoundRow', '_lineLatestRoundRequests',
            '_lineCreatorRoleIds', '_lineApprovalFlows', 'tx.approval_request.create',
        ):
            assert token not in guard, f'{token!r} must not appear once the lines entity owns submit_on'

    def test_locked_line_guard_still_present_when_lines_entity_has_submit_on(self):
        """change 5 removes only the resubmit tail -- the net>0 lock guard
        (change 2's docstring, unaffected) must remain."""
        guard = self._guard(has_submit_on=True)
        assert 'if (_lineNet > 0) {' in guard
        assert "throw new ReservationMutationError('Cannot modify reservation criteria after allocation.');" in guard

    def test_resubmit_machinery_preserved_when_lines_entity_has_no_submit_on(self):
        """Backward compatibility: an x-approval lines entity without its
        own submit_on keeps the original withdrawn-line resubmission path."""
        guard = self._guard(has_submit_on=False)
        for token in ('_lineIsWithdrawn', '_lineLatestRoundRow', '_lineLatestRoundRequests'):
            assert token in guard
        assert 'inventory_transactionable_id: _existing.inventory_transactionable_id' in guard


# ---------------------------------------------------------------------------
# subtask_869b design: submit_on branch of reservation_spec_context
# ---------------------------------------------------------------------------
from generators_test import reservation_spec_context


class TestReservationSpecContextSubmitOn:
    def test_has_submit_on_true_when_lines_has_submit_on(self):
        schema = _schema(has_submit_on=True)
        children = [_lines_child()]
        ctx = reservation_spec_context('purchase_order', schema, children)
        assert ctx is not None
        assert ctx.get('reservation_lines_has_submit_on') is True, (
            'purchase_per_item has submit_on, template must see True '
            'to switch IT-(2) to the 201/no-reservation assertion'
        )

    def test_has_submit_on_false_when_lines_has_no_submit_on(self):
        schema = _schema(has_submit_on=False)
        children = [_lines_child()]
        ctx = reservation_spec_context('purchase_order', schema, children)
        assert ctx is not None
        assert ctx.get('reservation_lines_has_submit_on') is False, (
            'without submit_on, keep the original 409 assertion path'
        )


# ---------------------------------------------------------------------------
# cmd_871 [乙]: a line created directly in its submit_on state must fire
# both approval_request creation AND the reservation claim in the same
# edge -- previously the whole block was skipped by declaration alone,
# leaving a "pending" line with neither an approval_request nor a
# reservation (the データ整合性 bug this task fixes).
# ---------------------------------------------------------------------------

class TestApprovalLinesPostCreateCodeSubmitOn:
    def _reservation_config(self):
        schema = _schema(has_submit_on=True)
        entity = _entity_spec('purchase_order', schema, children=[_lines_child()])
        ctx = build_context(entity, schema)
        return ctx['reservation_config'], schema

    def test_pending_line_generates_approval_and_reservation_code(self):
        rc, schema = self._reservation_config()
        parent_def = schema['definitions']['purchase_order']
        out = _build_approval_lines_post_create_code(
            parent_def, 'purchase_order', schema, reservation_config=rc,
        )
        assert "if (_apprTargetRow?.status !== 'pending') continue;" in out, (
            'a draft-state line must still be skipped by the runtime value '
            'check, not by the submit_on declaration'
        )
        assert 'tx.approval_request.create' in out, (
            'a line created directly in its submit_on state must still get '
            'an approval_request'
        )
        assert 'InsufficientPoolCapacityError' in out, (
            'a line created directly in its submit_on state must also claim '
            'inventory in the same edge -- the reservation half of the fix'
        )
        assert 'inventory_transactionable_id: _resBridge_items.id' in out, (
            'the reservation claim must link the line to the new bridge row'
        )

    def test_draft_line_skipped_not_blocked_by_declaration(self):
        """Without a reservation_config (e.g. the update call site, or a
        lines entity with submit_on but no x-reservation at all), the code
        block must still be generated -- the old all-or-nothing skip keyed
        off the mere presence of the submit_on declaration is gone."""
        schema = _schema(has_submit_on=True)
        parent_def = schema['definitions']['purchase_order']
        out = _build_approval_lines_post_create_code(
            parent_def, 'purchase_order', schema, reservation_config=None,
        )
        assert out != '', (
            'submit_on declaration alone must not blank out the whole block '
            'anymore -- only the runtime value check does the skipping'
        )
        assert "if (_apprTargetRow?.status !== 'pending') continue;" in out
        assert 'tx.approval_request.create' in out
        assert 'InsufficientPoolCapacityError' not in out, (
            'no reservation_config means no reservation claim code -- only '
            'the approval_request half fires'
        )
