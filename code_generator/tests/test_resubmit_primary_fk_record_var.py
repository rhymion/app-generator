"""
Regression test for subtask_839b (cmd_839): api_spec_context()'s
_put_body_impl() primary-FK branch ignored the record_var argument it was
given and always emitted `deps.{X}2.id,` -- correct for the ordinary
update test (record_var defaults to 'records[0]', which never gets fetched
into a `deps` object either, but that branch happens to coexist with code
that DOES declare `deps` elsewhere in that test body), but wrong for the
resubmit test (put_body_resubmit passes record_var='data.record', and the
resubmit test body never fetches a `deps` object at all), causing
`ReferenceError: deps is not defined` in the generated Cypress spec.

Reproduced against proj_h (insurance-app)'s endorsement entity, whose
x-display.table primary field is `policy` -- itself the FK field
(policy_id) -- combined with x-approval.submit_on and x-generate.test:
true. No shipped consumer schema had exercised this combination before
(proj_c/proj_g's existing submit_on entities all have a non-FK primary
display field), so the bug went uncaught until subtask_839a.
"""
from generators_test import api_spec_context


def _entity_cfg(test: bool = True) -> dict:
    return {
        'list': True, 'view': True, 'new': True, 'edit': True,
        'delete': True, 'api': True, 'test': test, 'fields': None,
    }


def _schema(primary_is_fk_field: bool) -> dict:
    """endorsement-shaped entity: approvable bridge + submit_on + a
    policy_id FK that is ALSO the x-display.table primary field (when
    primary_is_fk_field) or, for the control case, a plain non-FK primary
    field (mirrors proj_c/proj_g's leave_request -- never hit the bug)."""
    primary_table_entry = (
        {'policy': {'primary': True}} if primary_is_fk_field
        else {'reference_no': {'primary': True}}
    )
    return {
        'definitions': {
            'policy': {
                'type': 'object',
                'required': ['id', 'name'],
                'properties': {
                    'id': {'type': 'string', 'pattern': '^c[a-z0-9]{24,}$'},
                    'name': {'type': 'string', 'minLength': 1},
                },
            },
            'approvable': {
                'type': 'object',
                'required': ['id'],
                'properties': {'id': {'type': 'string', 'pattern': '^c[a-z0-9]{24,}$'}},
            },
            'endorsement': {
                'type': 'object',
                'required': ['id', 'approvable_id', 'policy_id', 'reference_no', 'status'],
                'x-approval': {'submit_on': {'status': 'submitted'}},
                'x-display': {'table': [primary_table_entry]},
                'properties': {
                    'id': {'type': 'string', 'pattern': '^c[a-z0-9]{24,}$'},
                    'approvable_id': {
                        'type': 'string',
                        'x-relationship': {'type': 'one-to-one_bridge', 'target': 'approvable', 'labelField': 'id'},
                    },
                    'policy_id': {
                        'type': 'string',
                        'x-relationship': {'type': 'many-to-one', 'target': 'policy', 'labelField': 'name'},
                    },
                    'reference_no': {'type': 'string', 'minLength': 1},
                    'status': {
                        'type': 'string',
                        'enum': ['draft', 'submitted', 'approved', 'rejected'],
                        'default': 'draft',
                    },
                },
            },
            'endorsement_detail': {'allOf': [{'$ref': '#/definitions/endorsement'}]},
        },
    }


def _resubmit_put_body(primary_is_fk_field: bool) -> list[str]:
    ctx = api_spec_context(
        'endorsement', [], _schema(primary_is_fk_field), 'endorsement', 'endorsement_detail',
        _entity_cfg(),
    )
    assert ctx['resubmit_target_field'] == 'status'
    put_body = ctx['put_body_resubmit']
    assert put_body is not None
    return put_body


def test_resubmit_put_body_uses_record_var_when_primary_is_fk():
    """The bug case: x-display.table.primary is policy (the FK field
    policy_id itself). Before the fix, this emitted
    `policy_id: deps.policy2.id,` unconditionally -- referencing a `deps`
    object the resubmit test never fetches -- instead of
    `policy_id: data.record.policy_id,` (record_var, matching every other
    field in the same PUT body)."""
    put_body = _resubmit_put_body(primary_is_fk_field=True)
    joined = '\n'.join(put_body)
    assert 'policy_id: data.record.policy_id,' in joined
    assert 'deps.' not in joined


def test_resubmit_put_body_unaffected_when_primary_is_not_fk():
    """Control / no-regression case: proj_c/proj_g's existing submit_on
    entities (e.g. leave_request) have a non-FK primary display field, so
    the fixed branch (primary_is_fk) is never taken at all -- policy_id
    (a plain non-primary FK) already went through the untouched `else`
    branch and used record_var before this fix; reference_no (the non-FK
    primary field) goes through its own untouched literal-value branch.
    Neither line's shape is affected by this fix."""
    put_body_before_shape = _resubmit_put_body(primary_is_fk_field=False)
    joined = '\n'.join(put_body_before_shape)
    assert 'policy_id: data.record.policy_id,' in joined
    assert "reference_no: 'Updated Reference No'," in joined
    assert 'deps.' not in joined
