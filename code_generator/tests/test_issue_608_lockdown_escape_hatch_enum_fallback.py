"""
Issue #608 regression: generators_test.py's post-approval lockdown fixture
escape hatch (helper_context(), the `_lockdown_override_literal` block) only
tried three candidates -- on_rejected.set_fields' value (non-terminal only),
on_withdrawn.set_fields' value, and the field's own schema default -- to find
a safe, unfrozen value the generic populate{Pascal}Data() fixture could seed
the lockdown field with. When an entity has a *terminal* on_rejected, no
on_withdrawn, and its schema default for the lockdown field equals the
locked submit_on value (app-template's real approval_edit_terminal_test
shape), all three candidates are frozen/unavailable, the escape hatch gave
up, and the fixture left the field at its raw DB default -- the locked
value. Every generic CRUD test built on that fixture (4.1/4.2/9.1/9.2/10.1/
10.2) then 403'd with approval_locked, despite having nothing to do with
approval flow.

Fix: a 4th fallback tier scans the field's own enum for any value not in
the frozen-values set (the same kind of scan resubmit_unsubmitted_value_
literal elsewhere in this file already performs for a different purpose).
"""
from generators_test import helper_context


def _schema() -> dict:
    """app-template's real approval_edit_terminal_test shape (mirrored from
    code_generator/tests/test_x_approval_combination_validation.py's
    test_proj_c_approval_edit_terminal_test): submit_on.status=pending,
    on_approved.set_fields.status=approved, on_rejected terminal with
    set_fields.status=rejected, NO on_withdrawn, and a schema default
    (pending) equal to submit_on's own locked value -- with a spare enum
    value ('draft') the old 3-tier fallback never considered."""
    return {
        'definitions': {
            'approvable': {
                'type': 'object',
                'required': ['id'],
                'properties': {'id': {'type': 'string', 'pattern': '^c[a-z0-9]{24,}$'}},
            },
            'approval_edit_terminal_test': {
                'type': 'object',
                'required': ['id', 'approvable_id', 'status'],
                'x-approval': {
                    'submit_on': {'status': 'pending'},
                    'on_approved': {'set_fields': {'status': 'approved'}, 'emit_hook': False},
                    'on_rejected': {'terminal': True, 'set_fields': {'status': 'rejected'}, 'emit_hook': False},
                },
                'x-display': {'table': [{'status': {'primary': True}}]},
                'properties': {
                    'id': {'type': 'string', 'pattern': '^c[a-z0-9]{24,}$'},
                    'approvable_id': {
                        'type': 'string',
                        'x-relationship': {'type': 'one-to-one_bridge', 'target': 'approvable', 'labelField': 'id'},
                    },
                    'status': {
                        'type': 'string',
                        'enum': ['draft', 'pending', 'approved', 'rejected'],
                        'default': 'pending',
                    },
                },
            },
            'approval_edit_terminal_test_detail': {
                'allOf': [{'$ref': '#/definitions/approval_edit_terminal_test'}],
            },
        },
    }


def _gen_cfg() -> dict:
    return {
        'list': True, 'view': True, 'new': True, 'edit': True,
        'delete': True, 'api': True, 'test': True, 'fields': None,
    }


def _ctx():
    schema = _schema()
    return helper_context(
        'approval_edit_terminal_test', [], schema,
        'approval_edit_terminal_test', 'approval_edit_terminal_test_detail', _gen_cfg(),
    )


def test_lockdown_field_gets_a_spare_enum_override_not_left_at_frozen_default():
    """Before this fix: all 3 tiers fail (no non-terminal on_rejected, no
    on_withdrawn, default == frozen submit_on value) -> status is omitted
    from the fixture entirely -> raw DB default (the locked value) is used.
    After: tier 4 finds 'draft' (in the enum, not in the frozen set) and
    the fixture writes it explicitly."""
    ctx = _ctx()
    fields = {f['prop_name']: f for f in ctx['required_fields_prisma_for_populate_data']}
    assert 'status' in fields, (
        "the lockdown field must be explicitly present in the generic "
        "populate fixture's required fields, not silently omitted (which "
        "leaves the raw DB default -- the locked submit_on value -- in "
        "place and 403s every generic CRUD test built on this fixture)"
    )
    assert fields['status']['prisma_val'] == "'draft'"
    assert fields['status']['prisma_val_fixed'] == "'draft'"


def test_spare_value_is_never_a_frozen_value():
    """Direction 2 (fail-closed spirit): the chosen override must
    actually be outside submit_on/on_approved/terminal-on_rejected's frozen
    set -- prove the fix picked a real escape, not a coincidence."""
    ctx = _ctx()
    fields = {f['prop_name']: f for f in ctx['required_fields_prisma_for_populate_data']}
    frozen = {"'pending'", "'approved'", "'rejected'"}
    assert fields['status']['prisma_val'] not in frozen
