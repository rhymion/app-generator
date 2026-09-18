"""
Issue #607 regression: the generated "old-form" resubmit-after-withdraw API
test (14.4, generated for any x-approval entity with a non-terminal
on_rejected but no on_withdrawn declared, and a reachable spare value for
the resubmit field) unconditionally called POST .../withdraw and asserted a
200. A later commit (13e5ab30, PR#450) added a server-side rule
that rejects withdrawal outright for any entity that does not declare
x-approval.on_withdrawn -- so this generated test always failed with 400
for every entity taking this code path (leave_request, maintenance_ticket
in app-template's real schema).

Fix: test_api_spec.cy.ts.jinja2's old-form 14.4 branch is now gated on
has_on_withdrawn too. When has_on_withdrawn is False, a different 14.4
variant is generated instead -- mirroring the existing 14.2M/14.3M
"withdrawal rejected because on_withdrawn is not declared" pattern for the
single-stage case: assert 400, and that the pending approval_request is
left untouched.
"""
from generate import _make_env
from test_submit_on_resubmit_fail_closed_gate import _build


_ENV = _make_env()


def _render(x_approval, enum=('pending', 'approved', 'rejected', 'draft')):
    ctx = _build(list(enum), x_approval)
    return ctx, _ENV.get_template('test_api_spec.cy.ts.jinja2').render(**ctx)


def _extract_14_4_block(rendered: str) -> str:
    start = rendered.find("it('14.4 ")
    assert start != -1, "no 14.4 test found in rendered output"
    end = rendered.find("\n    });\n", start)
    return rendered[start:end]


# leave_request/maintenance_ticket's real shape: non-terminal on_rejected,
# no on_withdrawn declared at all, spare enum value reachable.
_NO_ON_WITHDRAWN_X_APPROVAL = {
    'submit_on': {'status': 'pending'},
    'on_approved': {'set_fields': {'status': 'approved'}},
    'on_rejected': {'set_fields': {'status': 'rejected'}, 'terminal': False},
}

# on_withdrawn IS declared, but without set_fields for the resubmit target
# field -- withdrawal succeeds (200) and dispatchOnWithdrawn leaves the
# field untouched, so the pre-existing away-then-back form is still valid.
_ON_WITHDRAWN_NO_SET_FIELDS_X_APPROVAL = {
    'submit_on': {'status': 'pending'},
    'on_approved': {'set_fields': {'status': 'approved'}},
    'on_rejected': {'set_fields': {'status': 'rejected'}, 'terminal': False},
    'on_withdrawn': {'set_fields': {}},
}


def test_no_on_withdrawn_generates_the_lockout_rejection_variant():
    ctx, rendered = _render(_NO_ON_WITHDRAWN_X_APPROVAL)
    assert ctx['has_on_withdrawn'] is False
    assert ctx['resubmit_unsubmitted_value_literal'] == "'draft'"
    block = _extract_14_4_block(rendered)
    assert 'is rejected because on_withdrawn is not declared' in block
    assert 'expect(withdrawRes.status).to.eq(400)' in block
    assert "expect(requests[0].status).to.eq('pending')" in block
    # Must NOT assert the old (now-false) 200/withdrawn success shape.
    assert 'expect(withdrawRes.status).to.eq(200)' not in block
    assert "expect(withdrawRes.body.status).to.eq('withdrawn')" not in block


def test_has_on_withdrawn_without_set_fields_keeps_the_away_then_back_variant():
    """Regression guard the other direction: this fix must not over-narrow
    -- an entity that DOES declare on_withdrawn (even with no set_fields
    for this field) still succeeds at withdraw, so the away-then-back form
    must be preserved unchanged."""
    ctx, rendered = _render(_ON_WITHDRAWN_NO_SET_FIELDS_X_APPROVAL)
    assert ctx['has_on_withdrawn'] is True
    assert ctx['on_withdrawn_value_literal'] is None
    assert ctx['resubmit_unsubmitted_value_literal'] == "'draft'"
    block = _extract_14_4_block(rendered)
    assert 'away and back to its open value creates a new pending approval_request' in block
    assert 'expect(withdrawRes.status).to.eq(200)' in block
    assert "expect(withdrawRes.body.status).to.eq('withdrawn')" in block


def test_exactly_one_14_4_style_resubmit_test_is_generated_either_way():
    """Never both variants at once (the jinja elif chain must stay
    mutually exclusive)."""
    for x_approval in (_NO_ON_WITHDRAWN_X_APPROVAL, _ON_WITHDRAWN_NO_SET_FIELDS_X_APPROVAL):
        _, rendered = _render(x_approval)
        # '14.4N' (invalidate-after-withdraw) also matches a bare '14.4'
        # substring search, so count the two distinct forms explicitly.
        away_and_back = rendered.count(
            "it('14.4 withdrawing a pending request then editing status away and back "
            "to its open value creates a new pending approval_request'"
        )
        # Disambiguated from the pre-existing 14.2M/14.3M multistage titles
        # ("...an all-pending round is rejected.../...a partially-approved
        # round is rejected...") which share the same trailing phrase.
        lockout = rendered.count(
            "it('14.4 withdrawing a pending request is rejected because "
            "on_withdrawn is not declared'"
        )
        assert away_and_back + lockout == 1
