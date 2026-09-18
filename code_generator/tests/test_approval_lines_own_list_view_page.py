"""
Issue #604 regression: an approval-lines / ledger_transaction-reservation-
lines child that ALSO declares its own `x-generate` (list: true, view: true
-- so each line gets its own approve/reject page -- but new/edit/api left
false, since it has no write path of its own) was silently excluded from
the parent's write_ch / child_nested_create by build_context.py's
is_independent computation, while _build_approval_lines_pre_create_code
kept unconditionally emitting a reference to the now-undeclared
`{child_var}Items` parameter -- an undefined-variable TypeScript build
break (TS2304) for the real purchase_order.items / receiving_receipt.lines
shapes (app-template's json_schema.yaml) once their lines entities gained
their own list/view pages.

The pre-existing 17-test test_reservation_lines_submit_on.py fixture never
caught this because its own `purchase_per_item` schema definition never
declares `x-generate` at all -- these tests add exactly that one missing
signal (matching the real schema) on top of both an
x-reservation(ledger_transaction).lines shape and a plain x-approval-lines
shape (no reservation at all, mirroring receiving_receipt/
receiving_receipt_line), so a reintroduction of the naming/declaration
mismatch fails here before it ever reaches a real consumer's `tsc` run.
"""
from build_context import build_context
from generators import service_context
from test_reservation_lines_submit_on import _schema, _entity_spec, _lines_child


_OWN_LIST_VIEW_ONLY_X_GENERATE = {
    'list': True, 'view': True, 'new': False, 'edit': False,
    'delete': False, 'invalidate': False, 'api': False, 'test': True,
}


class TestReservationLinesEntityWithOwnListViewPage:
    """purchase_order.items (x-reservation, ledger_transaction, lines) whose
    lines entity (purchase_per_item) also carries its own list/view pages --
    the real app-template shape from Issue #604."""

    def _ctx(self):
        schema = _schema(has_submit_on=True)
        schema['definitions']['purchase_per_item']['x-generate'] = dict(_OWN_LIST_VIEW_ONLY_X_GENERATE)
        entity = _entity_spec('purchase_order', schema, children=[_lines_child()])
        return build_context(entity, schema), schema

    def test_lines_entity_is_nested_writable_but_stays_independent(self):
        """Issue #609 correction: is_independent itself must NOT be forced
        to False for an approval-indexed child -- it also drives the
        parent form's read-only-vs-writable rendering decision (issue
        #520/PR#528/PR#530), which must stay keyed off "does this child
        have its own dedicated CRUD page" alone. nested_writable is the
        separate flag that keeps the parent's own service nested-creating
        this child regardless."""
        ctx, _ = self._ctx()
        children = {c['property_name']: c for c in ctx['children_data']}
        assert children['items']['approval_indexed'] is True
        assert children['items']['is_independent'] is True, (
            "an approval-lines child with its own list/view page IS "
            "independent (own dedicated CRUD page) -- forcing this to "
            "False (the pre-#609-fix behavior) silently un-hides the "
            "parent form's 'Add' control issue #520/PR#528/PR#530 "
            "deliberately removed for it"
        )
        assert children['items']['nested_writable'] is True, (
            "an approval-lines child with no write path of its own (new: "
            "false, api: false) must stay writable via the parent's own "
            "nested-create regardless of its own x-generate.list/view pages"
        )

    def test_add_function_declares_the_items_array_parameter(self):
        ctx, _ = self._ctx()
        assert 'itemsItems' in ctx['child_params_for_add']

    def test_nested_create_is_emitted_for_items(self):
        ctx, _ = self._ctx()
        assert 'items:' in ctx['child_nested_create']
        assert 'create: itemsItems.map' in ctx['child_nested_create']

    def test_approval_lines_pre_create_code_references_a_declared_variable(self):
        """The variable _build_approval_lines_pre_create_code emits a
        reference to must actually be in scope -- either a declared
        function parameter (child_params_for_add) or a locally-derived
        variable, never neither."""
        ctx, schema = self._ctx()
        svc = service_context(ctx, schema)
        pre_create = svc['approval_lines_pre_create_code']
        assert 'itemsItems' in pre_create
        assert 'itemsItems' in ctx['child_params_for_add'], (
            "approval_lines_pre_create_code references itemsItems, but no "
            "such parameter is declared on add{Parent} -- this is exactly "
            "Issue #604's TS2304 'Cannot find name' shape"
        )


class TestPlainApprovalLinesEntityWithOwnListViewPage:
    """receiving_receipt.lines (plain x-approval-lines, no x-reservation at
    all) whose lines entity also carries its own list/view pages -- the
    second real shape named in Issue #604."""

    @staticmethod
    def _schema() -> dict:
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
                'receiving_receipt_line': {
                    'type': 'object',
                    'required': ['id', 'approvable_id', 'status'],
                    'x-generate': dict(_OWN_LIST_VIEW_ONLY_X_GENERATE),
                    'x-approval': {
                        'on_approved': {'emit_hook': True},
                        'on_rejected': {'terminal': True, 'emit_hook': True},
                    },
                    'properties': {
                        'id': {'type': 'string', 'pattern': '^c[a-z0-9]{24,}$'},
                        'receiving_receipt_id': {'type': 'string', 'pattern': '^c[a-z0-9]{24,}$'},
                        'product_id': {
                            'type': 'string',
                            'x-relationship': {'type': 'many-to-one', 'target': 'product', 'labelField': 'name'},
                        },
                        'receipt_quantity': {'type': 'integer', 'minimum': 0},
                        'approvable_id': {
                            'type': 'string',
                            'x-relationship': {'type': 'one-to-one_bridge', 'target': 'approvable', 'labelField': 'id'},
                        },
                        'status': {
                            'type': 'string',
                            'enum': ['pending', 'split', 'rejected'],
                            'default': 'pending',
                        },
                    },
                },
                'receiving_receipt': {
                    'type': 'object',
                    'required': ['id', 'lines'],
                    'x-approval-lines': ['lines'],
                    'properties': {
                        'id': {'type': 'string', 'pattern': '^c[a-z0-9]{24,}$'},
                        'lines': {'type': 'array', 'items': {'$ref': '#/definitions/receiving_receipt_line'}},
                    },
                },
            },
        }

    def _ctx(self):
        schema = self._schema()
        children = [{
            'name': 'receiving_receipt_line',
            'property_name': 'lines',
            'output_type': 'list',
            'file_type': None,
            'relationship': None,
        }]
        entity = _entity_spec('receiving_receipt', schema, children=children)
        return build_context(entity, schema), schema

    def test_lines_entity_is_nested_writable_but_stays_independent(self):
        """Issue #609 correction -- see the sibling test's docstring above
        (TestReservationLinesEntityWithOwnListViewPage) for the full
        reasoning; this is the plain x-approval-lines shape (no
        x-reservation) named as receiving_receipt.lines in issue #609
        itself."""
        ctx, _ = self._ctx()
        children = {c['property_name']: c for c in ctx['children_data']}
        assert children['lines']['approval_indexed'] is True
        assert children['lines']['is_independent'] is True
        assert children['lines']['nested_writable'] is True

    def test_add_function_declares_the_lines_array_parameter(self):
        ctx, _ = self._ctx()
        assert 'linesItems' in ctx['child_params_for_add']

    def test_nested_create_is_emitted_for_lines(self):
        ctx, _ = self._ctx()
        assert 'lines:' in ctx['child_nested_create']
        assert 'create: linesItems.map' in ctx['child_nested_create']

    def test_approval_lines_pre_create_code_references_a_declared_variable(self):
        ctx, schema = self._ctx()
        svc = service_context(ctx, schema)
        pre_create = svc['approval_lines_pre_create_code']
        assert 'linesItems' in pre_create
        assert 'linesItems' in ctx['child_params_for_add'], (
            "approval_lines_pre_create_code references linesItems, but no "
            "such parameter is declared on add{Parent} -- this is exactly "
            "Issue #604's TS2304 'Cannot find name' shape"
        )
