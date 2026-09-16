"""
Regression test: a `populateXxxDependencies()` dep record targeting `user`
must resolve to the acting test user (the actor), not a fresh unrelated row,
when the corresponding FK field carries `x-server-value` (source: actor —
the only implemented source, enforced by validate.py).

`x-server-value` always overwrites that FK with the actor's id on create, no
matter what a client (or a populate helper acting like one) supplies — see
docs/knowledge/x-server-value-actor-delegation.md. Before this fix,
`_get_dep_populate_fields()`/`helper_context()` had no awareness of
`x-server-value` and built the dep the same way as any other user FK: a
fresh, unrelated `Test <Title> A` row. `deps.user.name` then never matched
what the server actually wrote (the real actor's name) — a `leave_request`
create test asserting `deps.user.name` post-save always failed
(leave_request.cy.ts 2.1/2.2/7.1/7.2; cmd_630, cmd_625b
new_findings_beyond_scope finding 3).

A second, distinct manifestation covered below: the generated 7.1/7.2
Approval tests log in as setup.requestorUser/setup.noRoleUser (NOT the
default actor) before creating the record. When the primary display FK is
x-server-value:actor, the server overwrites it with whichever actor is
logged in at create time — so the post-create list lookup in spec_context()
must reference that same switched-in actor's identity, not
deps.<var>.name (which only reflects the DEFAULT actor).
"""
from generators_test import helper_context, spec_context

_GEN_CFG = {
    'list': True, 'view': True, 'new': True, 'edit': True, 'delete': True,
    'api': True, 'test': True, 'fields': None,
}


def _schema(with_server_value: bool, with_approvable: bool = False) -> dict:
    user_id_field = {
        'type': 'string',
        'x-relationship': {'type': 'many-to-one', 'target': 'user', 'labelField': 'name'},
    }
    if with_server_value:
        user_id_field['x-server-value'] = {'source': 'actor', 'override_permission': 'delete'}
    leave_request_props = {
        'id': {'type': 'string'},
        'user_id': user_id_field,
        'start_date': {'type': 'string', 'format': 'date'},
        'end_date': {'type': 'string', 'format': 'date'},
    }
    required = ['id', 'user_id', 'start_date', 'end_date']
    leave_request_def = {
        'type': 'object',
        'required': required,
        'properties': leave_request_props,
        'x-display': {'table': [{'user': {'primary': True}}]},
    }
    if with_approvable:
        leave_request_props['approvable_id'] = {
            'type': 'string',
            'x-relationship': {'type': 'one-to-one_bridge', 'target': 'approvable'},
        }
        required.append('approvable_id')
        leave_request_def['x-approval'] = {'on_approved': {'set_fields': {}}}
    return {
        'definitions': {
            'user': {
                'type': 'object',
                'required': ['id', 'name', 'email'],
                'properties': {
                    'id': {'type': 'string'}, 'name': {'type': 'string'}, 'email': {'type': 'string'},
                },
            },
            'leave_request': leave_request_def,
            'leave_request_detail': {'allOf': [{'$ref': '#/definitions/leave_request'}]},
        },
    }


def _user_dep(schema: dict) -> dict:
    ctx = helper_context(
        'leave_request', [], schema, 'leave_request', 'leave_request_detail', _GEN_CFG,
    )
    return next(d for d in ctx['deps'] if d['var_name'] == 'user')


class TestActorDelegatedDependency:
    def test_x_server_value_actor_fk_marked_actor_delegated(self):
        dep = _user_dep(_schema(with_server_value=True))
        assert dep['is_actor_delegated'] is True

    def test_plain_user_fk_not_marked_actor_delegated(self):
        """A user FK with no x-server-value must keep building a fresh, unrelated
        dep row — this flag must not fire for ordinary FKs."""
        dep = _user_dep(_schema(with_server_value=False))
        assert dep.get('is_actor_delegated', False) is False

    def test_actor_delegated_dep_skips_decoy_row_in_rendered_helper(self):
        """The rendered populateLeaveRequestDependencies() must resolve `user`
        straight to `testUser` — never emit a `prisma.user.create()` call for
        it — so deps.user.name always matches what the server actually writes
        (the real actor's name), not a decoy 'Test User A' row."""
        from generate import _make_env, _render

        schema = _schema(with_server_value=True)
        ctx = helper_context(
            'leave_request', [], schema, 'leave_request', 'leave_request_detail', _GEN_CFG,
        )
        env = _make_env()
        rendered = _render(env, 'test_helper.ts.jinja2', ctx)
        import re
        m = re.search(r'export async function populateLeaveRequestDependencies\(\).*?\n}\n', rendered, re.S)
        assert m, 'populateLeaveRequestDependencies() not found in rendered output'
        body = m.group(0)
        assert 'const userRecord = testUser;' in body
        assert 'prisma.user.create' not in body
        assert 'prisma.user.findFirst' not in body


class TestApprovalTestSwitchedActorAssertion:
    """7.1/7.2 log in as setup.requestorUser/setup.noRoleUser before creating —
    when the primary display FK is x-server-value:actor, the post-create list
    lookup must match THAT actor, not deps.user (the default actor)."""

    def _spec_ctx(self, with_server_value):
        schema = _schema(with_server_value=with_server_value, with_approvable=True)
        return spec_context(
            'leave_request', [], schema, 'leave_request', 'leave_request_detail', _GEN_CFG, 0,
        )

    def test_prim_is_server_value_exposed_in_spec_context(self):
        assert self._spec_ctx(with_server_value=True)['prim_is_server_value'] is True
        assert self._spec_ctx(with_server_value=False)['prim_is_server_value'] is False

    def test_71_72_use_switched_actor_identity_when_primary_is_server_value(self):
        from generate import _make_env, _render
        import re

        ctx = self._spec_ctx(with_server_value=True)
        assert ctx['has_approvable'] is True
        env = _make_env()
        rendered = _render(env, 'test_spec.cy.ts.jinja2', ctx)
        m71 = re.search(r"it\('7\.1.*?\n    \}\);", rendered, re.S)
        m72 = re.search(r"it\('7\.2.*?\n    \}\);", rendered, re.S)
        assert m71 and m72, '7.1/7.2 not found in rendered spec'
        assert "exactRe(setup.requestorUser.name)" in m71.group(0)
        assert "exactRe(deps." not in m71.group(0)
        assert "exactRe(setup.noRoleUser.name)" in m72.group(0)
        assert "exactRe(deps." not in m72.group(0)

    def test_71_72_keep_deps_var_when_primary_is_not_server_value(self):
        """Sanity/no-regression check: an ordinary (non-x-server-value) primary
        display FK must keep asserting against deps.<var>.name as before."""
        from generate import _make_env, _render
        import re

        ctx = self._spec_ctx(with_server_value=False)
        env = _make_env()
        rendered = _render(env, 'test_spec.cy.ts.jinja2', ctx)
        m71 = re.search(r"it\('7\.1.*?\n    \}\);", rendered, re.S)
        assert m71
        assert "exactRe(deps.user.name)" in m71.group(0)
        assert "setup.requestorUser.name" not in m71.group(0)
