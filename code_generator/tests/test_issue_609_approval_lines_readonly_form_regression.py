"""
Issue #609, corrected (cmd_1098): issue #609 itself was filed on a wrong
premise. PR#606's fix for issue #604 forced `is_independent` to False for
an approval-indexed child, which un-hid the parent form's "Add" control for
receiving_receipt.lines -- but that Add control reappearing was CORRECT,
not a regression. `is_independent`'s root computation
(`not is_many_to_many and bool(x-generate)`) was itself wrong: it treated
ANY x-generate block (even list/view-only) as independent, when the actual
line for "can the parent still add/edit/delete this child" is whether the
CHILD can write itself (new/edit/delete), not whether it merely has a page.
receiving_receipt_line's real x-generate sets new/edit/delete all False --
it has no write path of its own, so the parent legitimately needs to offer
add/edit/delete for it. The original UI test expectation issue #609 quoted
(`cy.get('button[aria-label="Add Lines"]').should('not.exist')`) was itself
the bug, per its own outdated note ("own list/view/new/edit pages" --
receiving_receipt_line's real new/edit are both False).

Corrected (cmd_1098) build_context.py's `is_independent` now reads
new/edit/delete via child_has_own_write_capability(), not bare x-generate
presence: receiving_receipt.lines is no longer independent, and renders
through the WRITABLE Add-button grid machinery (child_grid_components), not
the read-only ListWrapper path (indep_list_readonly_jsx) -- the exact
opposite of what this file asserted before this correction.
`nested_writable` stays True either way (the #604 fix this must not
regress -- see test_nested_create_for_lines_is_still_emitted below).
"""
from build_context import build_context
from generators import form_upsert_context
from test_reservation_lines_submit_on import _entity_spec


def _schema() -> dict:
    """receiving_receipt.lines: plain x-approval-lines (no x-reservation),
    lines entity also carries its own list/view pages -- the exact shape
    named in issue #609."""
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
                # Own list/view pages (per-line approve/reject), no write
                # path of its own -- the exact shape issue #604/#609 named.
                'x-generate': {
                    'list': True, 'view': True, 'new': False, 'edit': False,
                    'delete': False, 'invalidate': False, 'api': False, 'test': True,
                },
                'x-approval': {
                    'on_approved': {'emit_hook': True},
                    'on_rejected': {'terminal': True, 'emit_hook': True},
                },
                'properties': {
                    'id': {'type': 'string', 'pattern': '^c[a-z0-9]{24,}$'},
                    'name': {'type': 'string'},
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


def _ctx():
    schema = _schema()
    children = [{
        'name': 'receiving_receipt_line',
        'property_name': 'lines',
        'output_type': 'list',
        'file_type': None,
        'relationship': None,
    }]
    entity = _entity_spec('receiving_receipt', schema, children=children)
    ctx = build_context(entity, schema)
    return ctx, schema


def test_lines_child_is_not_independent_but_stays_nested_writable():
    """Corrected (cmd_1098): receiving_receipt_line's new/edit/delete are
    all explicitly False -- it has no write path of its own, so
    is_independent is False (the parent may add/edit/delete it).
    nested_writable stays True regardless (the #604 fix -- the parent's
    service must still nested-create it either way)."""
    ctx, _ = _ctx()
    children = {c['property_name']: c for c in ctx['children_data']}
    assert children['lines']['is_independent'] is False
    assert children['lines']['nested_writable'] is True
    assert children['lines']['approval_indexed'] is True


def test_nested_create_for_lines_is_still_emitted():
    """The #604 fix this must not regress: the parent's own service still
    nested-creates the approval-lines child."""
    ctx, _ = _ctx()
    assert 'lines:' in ctx['child_nested_create']
    assert 'create: linesItems.map' in ctx['child_nested_create']


def test_parent_form_renders_lines_as_writable_add_button_grid_not_read_only():
    """Corrected (cmd_1098): receiving_receipt_line has no write path of
    its own, so the parent's generated FormUpsert must render `lines`
    through the WRITABLE Add-button DataGrid machinery
    (child_grid_components), NOT the read-only ListWrapper path
    (indep_list_readonly_jsx) -- the opposite of issue #609's original
    (wrong) expectation."""
    ctx, schema = _ctx()
    fu = form_upsert_context(ctx, schema)
    assert 'lines' in fu.get('child_grid_components', ''), (
        "receiving_receipt.lines has no new/edit/delete of its own, so the "
        "parent must offer add/edit/delete for it -- the corrected line "
        "cmd_1098 establishes"
    )
    assert 'lines' not in fu['indep_list_readonly_jsx'], (
        "receiving_receipt.lines must NOT render through the read-only "
        "ListWrapper path -- that path is for children that already have "
        "their own new/edit/delete pages"
    )
