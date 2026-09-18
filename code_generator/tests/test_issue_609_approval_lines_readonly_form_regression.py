"""
Issue #609 regression: PR#606's fix for issue #604 (build_context.py's
is_independent computation) forced is_independent itself to False for an
approval-indexed child, which also silently un-hid the parent form's "Add"
control that issue #520/PR#528/PR#530 had deliberately removed for exactly
this shape (an approval-lines child with its own list/view page, e.g.
receiving_receipt.lines).

test_approval_lines_own_list_view_page.py already locks in the corrected
is_independent/nested_writable *values* on children_data. This file locks
in the actual downstream *consequence* those values must produce: the
generated FormUpsert JSX for the parent must render the child through the
read-only ListWrapper path (indep_list_readonly_jsx) and must NOT wire it
into the writable Add-button grid machinery (child_grid_components) --
the real thing issue #609's reproduction (`cy.get('button[aria-label="Add
Lines"]').should('not.exist')` failing) observed breaking.
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


def test_lines_child_flags_are_independent_and_nested_writable():
    ctx, _ = _ctx()
    children = {c['property_name']: c for c in ctx['children_data']}
    assert children['lines']['is_independent'] is True
    assert children['lines']['nested_writable'] is True
    assert children['lines']['approval_indexed'] is True


def test_nested_create_for_lines_is_still_emitted():
    """The #604 fix this must not regress: the parent's own service still
    nested-creates the approval-lines child."""
    ctx, _ = _ctx()
    assert 'lines:' in ctx['child_nested_create']
    assert 'create: linesItems.map' in ctx['child_nested_create']


def test_parent_form_renders_lines_read_only_not_as_writable_add_button_grid():
    """Issue #609's actual reproduction: the parent's generated FormUpsert
    must render `lines` through the read-only ListWrapper path, and must
    NOT wire it into the writable Add-button DataGrid machinery."""
    ctx, schema = _ctx()
    fu = form_upsert_context(ctx, schema)
    assert 'lines' in fu['indep_list_readonly_jsx'], (
        "receiving_receipt.lines must render through the read-only "
        "ListWrapper path (indep_list_readonly_jsx) on the parent form -- "
        "the issue #520/PR#528/PR#530 ruling this issue #609 restores"
    )
    assert 'lines' not in fu.get('child_grid_components', ''), (
        "receiving_receipt.lines must NOT be wired into the writable "
        "Add-button DataGrid grid machinery -- this is exactly the "
        "regression issue #609 filed (PR#606 silently un-hid the 'Add "
        "Lines' control on the parent edit page)"
    )
    assert fu['has_indep_list_children'] is True
