"""
Regression test for subtask_867a (cmd_867): api_spec_context()'s
put_body_resubmit unconditionally used record_var='data.record' -- correct
for 14.1/14.2/14.3/14.3D/14.3N/14.4/14.4N/14.4M (every one of them is built
from a `cy.task('db:populate<Entity>...')` helper that yields a `data`
variable), but wrong for 14.5, the one resubmit scenario the template
renders only for an approval entity with no required FK dependency
(`resubmit_unsubmitted_value_literal and not has_deps`). 14.5 POSTs a fresh
record itself and never fetches a `data` variable at all -- its PUT body is
built inside `.then((getRes1) => {...})`, so the generated spec referenced
an undefined `data`, throwing `ReferenceError: data is not defined` at
runtime (confirmed against proj_h's real generated `commission_scheme.cy.ts`
-- read-only, not touched by this fix).

`createRes.body` (the POST response) is not a usable alternative either:
`add{Parent}()` (service.ts.jinja2) returns only `{ id }`, so
`createRes.body.<field>` resolves to `undefined` for every field but `id` --
a silent-data-loss bug worse than the original ReferenceError. `getRes1.body`
(the detail GET response, already in scope one `.then()` level in) is the
only variable with every field populated, which is why the fix introduces a
second, 14.5-only context key -- `put_body_resubmit_created` -- rather than
changing `put_body_resubmit` itself (which must keep emitting
`data.record.<field>` unchanged for every other resubmit scenario).
"""
from generators_test import api_spec_context


def _entity_cfg() -> dict:
    return {
        'list': True, 'view': True, 'new': True, 'edit': True,
        'delete': True, 'api': True, 'test': True, 'fields': None,
    }


def _schema(primary_is_fk_field: bool = False) -> dict:
    """commission_scheme-shaped entity (proj_h's real repro shape): approvable
    bridge + submit_on + non-terminal on_rejected + no on_withdrawn (so
    resubmit_unsubmitted_value_literal is a spare enum value, 'draft') +
    no required FK dependency other than the approvable bridge itself (so
    has_deps is False and the 14.5 guard fires). `primary_is_fk_field`
    additionally exercises the primary-FK branch inside _put_body_impl
    (subtask_839b's branch) with the new record_var, mirroring
    test_resubmit_primary_fk_record_var.py's control/bug-case split."""
    primary_table_entry = (
        {'policy': {'primary': True}} if primary_is_fk_field
        else {'reason': {'primary': True}}
    )
    properties = {
        'id': {'type': 'string', 'pattern': '^c[a-z0-9]{24,}$'},
        'approvable_id': {
            'type': 'string',
            'x-relationship': {'type': 'one-to-one_bridge', 'target': 'approvable', 'labelField': 'id'},
        },
        'reason': {'type': 'string', 'minLength': 1},
        # A plain, non-primary, non-resubmit-target field -- 'reason' (the
        # x-display.table primary field) goes through _put_body_impl's own
        # dedicated primary-field branch (a literal 'Updated <Label>' value,
        # unrelated to record_var), and 'status' (resubmit_target_field) is
        # skipped from the loop entirely. 'note' is what actually exercises
        # the default else branch (f"{record_var}.{prop}") this fix touches.
        'note': {'type': 'string', 'minLength': 1},
        'status': {
            'type': 'string',
            'enum': ['draft', 'submitted', 'approved', 'rejected'],
            'default': 'draft',
        },
    }
    required = ['id', 'approvable_id', 'reason', 'note', 'status']
    definitions = {
        'approvable': {
            'type': 'object',
            'required': ['id'],
            'properties': {'id': {'type': 'string', 'pattern': '^c[a-z0-9]{24,}$'}},
        },
    }
    if primary_is_fk_field:
        # policy is a NON-required (optional) FK -- required would make
        # has_deps True and suppress 14.5 entirely, which is not what this
        # branch is testing (it only cares about the primary-FK output
        # shape inside _put_body_impl, same as test_resubmit_primary_fk_
        # record_var.py's own bug-case schema).
        properties['policy_id'] = {
            'type': 'string',
            'x-relationship': {'type': 'many-to-one', 'target': 'policy', 'labelField': 'name'},
        }
        definitions['policy'] = {
            'type': 'object',
            'required': ['id', 'name'],
            'properties': {
                'id': {'type': 'string', 'pattern': '^c[a-z0-9]{24,}$'},
                'name': {'type': 'string', 'minLength': 1},
            },
        }
    definitions['commission_scheme_like'] = {
        'type': 'object',
        'required': required,
        'x-approval': {
            'submit_on': {'status': 'submitted'},
            'on_approved': {'set_fields': {'status': 'approved'}},
            'on_rejected': {'set_fields': {'status': 'rejected'}, 'terminal': False},
        },
        'x-display': {'table': [primary_table_entry]},
        'properties': properties,
    }
    definitions['commission_scheme_like_detail'] = {'allOf': [{'$ref': '#/definitions/commission_scheme_like'}]}
    return {'definitions': definitions}


def _ctx(primary_is_fk_field: bool = False) -> dict:
    return api_spec_context(
        'commission_scheme_like', [], _schema(primary_is_fk_field),
        'commission_scheme_like', 'commission_scheme_like_detail', _entity_cfg(),
    )


def test_put_body_resubmit_created_exists_and_has_no_deps():
    """Preconditions the fix depends on: resubmit_unsubmitted_value_literal
    is the 'draft' spare value (no on_withdrawn declared) and has_deps is
    False (no required FK) -- exactly the combination that renders 14.5."""
    ctx = _ctx()
    assert ctx['resubmit_target_field'] == 'status'
    assert ctx['resubmit_unsubmitted_value_literal'] == "'draft'"
    assert ctx['has_deps'] is False
    assert ctx['put_body_resubmit_created'] is not None


def test_put_body_resubmit_created_uses_getRes1_body_not_data():
    """The actual fix: put_body_resubmit_created must source every field
    from getRes1.body, never from data (the undefined variable that caused
    the original ReferenceError) or createRes.body (which would silently
    resolve to undefined for every field but id -- see module docstring)."""
    ctx = _ctx()
    joined = '\n'.join(ctx['put_body_resubmit_created'])
    assert 'data.' not in joined
    assert 'createRes.body' not in joined
    assert 'note: getRes1.body.note,' in joined


def test_put_body_resubmit_created_indent_is_18_spaces():
    """14.5 nests its PUT body one level deeper (inside two .then() blocks)
    than every other resubmit test (inside one) -- put_body_resubmit uses a
    14-space indent, put_body_resubmit_created must use 18."""
    ctx = _ctx()
    for line in ctx['put_body_resubmit_created']:
        assert line.startswith(' ' * 18) and not line.startswith(' ' * 19), (
            f'expected exactly 18-space indent, got: {line!r}'
        )


def test_put_body_resubmit_unaffected_control():
    """No-regression control: the pre-existing put_body_resubmit key (used
    by every resubmit test except 14.5) must still emit the original
    data.record.<field> / 14-space-indent shape, completely unaffected by
    the new put_body_resubmit_created key added alongside it."""
    ctx = _ctx()
    joined = '\n'.join(ctx['put_body_resubmit'])
    assert 'note: data.record.note,' in joined
    assert 'getRes1' not in joined
    for line in ctx['put_body_resubmit']:
        assert line.startswith(' ' * 14) and not line.startswith(' ' * 15), (
            f'expected exactly 14-space indent, got: {line!r}'
        )


def test_put_body_resubmit_created_primary_fk_branch_uses_getRes1_body():
    """Same primary-FK branch subtask_839b fixed for put_body_resubmit
    (policy_id, the primary x-display field, is itself the FK) must also
    respect record_var for put_body_resubmit_created -- getRes1.body.policy_id,
    never deps.policy2.id (there is no `deps` object in scope for 14.5,
    exactly the ReferenceError class subtask_839b fixed for the other
    resubmit tests)."""
    ctx = _ctx(primary_is_fk_field=True)
    joined = '\n'.join(ctx['put_body_resubmit_created'])
    assert 'policy_id: getRes1.body.policy_id,' in joined
    assert 'deps.' not in joined
    assert 'data.' not in joined
