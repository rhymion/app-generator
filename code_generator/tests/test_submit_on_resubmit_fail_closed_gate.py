"""
cmd_843 PD-1: fail-closed resubmission-reachability gate in
api_spec_context() (code_generator/generators_test.py). Deviation-injection
proof in both directions per cmd_498 ("a condition the machine cannot see is
a hole") -- a schema with a genuine reachable away-state must generate
cleanly, and a schema with none (or a declared on_withdrawn/on_rejected that
collides with submit_on/on_approved's own value) must fail generate-code
with a clear message, not silently skip 14.4/14.5 as the old cmd_825 comment
described.
"""
import pytest
from generators_test import api_spec_context


def _entity_cfg() -> dict:
    return {
        'list': True, 'view': True, 'new': True, 'edit': True,
        'delete': True, 'api': True, 'test': True, 'fields': None,
    }


def _schema(status_enum, x_approval) -> dict:
    """leave_request-shaped entity: approvable bridge + submit_on -- the
    exact shape cmd_843e's gate targets."""
    return {
        'definitions': {
            'approvable': {
                'type': 'object',
                'required': ['id'],
                'properties': {'id': {'type': 'string', 'pattern': '^c[a-z0-9]{24,}$'}},
            },
            'leave_request_like': {
                'type': 'object',
                'required': ['id', 'approvable_id', 'reason', 'status'],
                'x-approval': x_approval,
                'x-display': {'table': [{'reason': {'primary': True}}]},
                'properties': {
                    'id': {'type': 'string', 'pattern': '^c[a-z0-9]{24,}$'},
                    'approvable_id': {
                        'type': 'string',
                        'x-relationship': {'type': 'one-to-one_bridge', 'target': 'approvable', 'labelField': 'id'},
                    },
                    'reason': {'type': 'string', 'minLength': 1},
                    'status': {
                        'type': 'string',
                        'enum': status_enum,
                        'default': status_enum[0],
                    },
                },
            },
            'leave_request_like_detail': {'allOf': [{'$ref': '#/definitions/leave_request_like'}]},
        },
    }


def _build(status_enum, x_approval):
    return api_spec_context(
        'leave_request_like', [], _schema(status_enum, x_approval),
        'leave_request_like', 'leave_request_like_detail', _entity_cfg(),
    )


# ---------------------------------------------------------------------------
# Direction 1: schemas that SHOULD pass.
# ---------------------------------------------------------------------------
def test_reachable_schema_generates_cleanly_via_on_withdrawn():
    """leave_request/maintenance_ticket's actual shape (cmd_841 ruling_2):
    pending/approved/rejected/draft, on_withdrawn sets status back to
    'draft' -- distinct from submit_on (pending) and on_approved (approved)."""
    x_approval = {
        'submit_on': {'status': 'pending'},
        'on_approved': {'set_fields': {'status': 'approved'}},
        'on_rejected': {'set_fields': {'status': 'rejected'}, 'terminal': False},
        'on_withdrawn': {'set_fields': {'status': 'draft'}},
    }
    ctx = _build(['pending', 'approved', 'rejected', 'draft'], x_approval)
    assert ctx['resubmit_target_field'] == 'status'
    assert ctx['on_withdrawn_value_literal'] == "'draft'"


def test_reachable_schema_generates_cleanly_via_generic_spare_value_without_on_withdrawn():
    """No on_withdrawn declared at all -- reachability instead comes from the
    pre-existing 'created but not yet submitted' spare-value scan (cmd_825),
    which the new gate must not break."""
    x_approval = {
        'submit_on': {'status': 'pending'},
        'on_approved': {'set_fields': {'status': 'approved'}},
        'on_rejected': {'set_fields': {'status': 'rejected'}, 'terminal': False},
    }
    ctx = _build(['pending', 'approved', 'rejected', 'draft'], x_approval)
    assert ctx['on_withdrawn_value_literal'] is None
    assert ctx['resubmit_unsubmitted_value_literal'] == "'draft'"


def test_terminal_on_rejected_is_exempt_from_the_gate():
    """terminal: true means resubmission is never expected -- the gate must
    not fire even with no spare value anywhere (matches the design report's
    activation_condition)."""
    x_approval = {
        'submit_on': {'status': 'pending'},
        'on_approved': {'set_fields': {'status': 'approved'}},
        'on_rejected': {'set_fields': {'status': 'rejected'}, 'terminal': True},
    }
    ctx = _build(['pending', 'approved', 'rejected'], x_approval)
    assert ctx['resubmit_target_field'] == 'status'


# ---------------------------------------------------------------------------
# Direction 2: schemas that must NOT pass -- generate-code itself must fail.
# ---------------------------------------------------------------------------
def test_unreachable_schema_with_no_spare_value_anywhere_fails_closed():
    """cmd_840's actual repro shape: pending/approved/rejected only, no
    on_withdrawn, no spare enum value -- resubmission after non-terminal
    rejection is a dead letter. Must raise, not silently skip 14.4/14.5."""
    x_approval = {
        'submit_on': {'status': 'pending'},
        'on_approved': {'set_fields': {'status': 'approved'}},
        'on_rejected': {'set_fields': {'status': 'rejected'}, 'terminal': False},
    }
    with pytest.raises(ValueError, match=r'no value is reachable'):
        _build(['pending', 'approved', 'rejected'], x_approval)


def test_on_withdrawn_value_colliding_with_submit_on_fails_closed():
    """on_withdrawn.set_fields writes submit_on's own value -- a config bug:
    the withdrawn record would look identically 'pending' even though no
    live approval_request exists, and the resubmit edge trigger's
    previous!=target check could never fire."""
    x_approval = {
        'submit_on': {'status': 'pending'},
        'on_approved': {'set_fields': {'status': 'approved'}},
        'on_rejected': {'set_fields': {'status': 'rejected'}, 'terminal': False},
        'on_withdrawn': {'set_fields': {'status': 'pending'}},
    }
    with pytest.raises(ValueError, match=r"on_withdrawn\.set_fields\.status = 'pending' is unreachable"):
        _build(['pending', 'approved', 'rejected', 'draft'], x_approval)


def test_on_withdrawn_value_colliding_with_on_approved_fails_closed():
    """on_withdrawn.set_fields writes on_approved's own value -- the
    withdrawn record would look identically 'approved'."""
    x_approval = {
        'submit_on': {'status': 'pending'},
        'on_approved': {'set_fields': {'status': 'approved'}},
        'on_rejected': {'set_fields': {'status': 'rejected'}, 'terminal': False},
        'on_withdrawn': {'set_fields': {'status': 'approved'}},
    }
    with pytest.raises(ValueError, match=r"on_withdrawn\.set_fields\.status = 'approved' is unreachable"):
        _build(['pending', 'approved', 'rejected', 'draft'], x_approval)


def test_on_rejected_value_colliding_with_submit_on_fails_closed():
    """on_rejected (non-terminal).set_fields writes submit_on's own value."""
    x_approval = {
        'submit_on': {'status': 'pending'},
        'on_approved': {'set_fields': {'status': 'approved'}},
        'on_rejected': {'set_fields': {'status': 'pending'}, 'terminal': False},
    }
    with pytest.raises(
        ValueError,
        match=r"on_rejected\.set_fields\.status = 'pending' \(non-terminal\) is unreachable",
    ):
        _build(['pending', 'approved', 'rejected', 'draft'], x_approval)
