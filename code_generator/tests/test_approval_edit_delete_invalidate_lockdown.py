"""
Regression tests for cmd_846(c): post-approval edit/delete/invalidate
lockdown. Covers:

  - L1: a view declaring the approvable one-to-one_bridge relationship AND
    x-approval.submit_on gets edit_guard.ts/delete_guard.ts/
    invalidate_guard.ts wired in, with the correct locked-status set
    (submit_on's value + on_approved.set_fields' value for the same
    field).
  - L2: keyed by VIEW, not Prisma model name (846b §一) -- a second view
    sharing the same model but NOT itself declaring the approvable
    relationship gets no guard, even though the shared model's raw entity
    has x-approval declared. This is the proxy-view-must-not-be-locked
    property cmd_534/846b both require.
  - L3: an entity with the approvable bridge but no x-approval.submit_on
    gets no guard (there is no "submitted" state to lock against).
  - L4: assertEditAllowed/assertDeleteAllowed calls land inside
    service.ts's update{Parent}/delete{Parent} (the one choke point both
    the REST route and the Server Action already funnel through), not
    only in a route template -- the deliberate 846a/846b deviation.
"""
from build_context import build_context
from generators import approval_lockdown_context, service_context


def _entity(parent: str, model: str, edit: bool = True, delete: bool = True,
             invalidate: bool = True, fields: list | None = None) -> dict:
    return {
        'parent': parent,
        'model': model,
        'definition_key': f'__{model}' if model == parent else parent,
        'children': [],
        'generate_config': {
            'list': True, 'view': True, 'new': True, 'edit': edit,
            'delete': delete, 'invalidate': invalidate, 'api': True,
            'test': False, 'fields': fields,
        },
    }


def _approvable_props(extra: dict | None = None) -> dict:
    props = {
        'id': {'type': 'string', 'pattern': '^c[a-z0-9]{24,}$'},
        'approvable_id': {
            'type': 'string',
            'x-relationship': {'type': 'one-to-one_bridge', 'target': 'approvable', 'labelField': 'id'},
        },
    }
    if extra:
        props.update(extra)
    return props


def _support_defs() -> dict:
    return {
        'approval_flow': {
            'type': 'object',
            'required': ['id', 'entity_name'],
            'properties': {
                'id': {'type': 'string', 'pattern': '^c[a-z0-9]{24,}$'},
                'entity_name': {'type': 'string'},
            },
        },
        'approval_request': {
            'type': 'object',
            'required': ['id', 'approvable_id', 'approval_flow_id'],
            'properties': {
                'id': {'type': 'string', 'pattern': '^c[a-z0-9]{24,}$'},
                'approvable_id': {
                    'type': 'string',
                    'x-relationship': {'type': 'many-to-one', 'target': 'approvable', 'labelField': 'id'},
                },
                'approval_flow_id': {
                    'type': 'string',
                    'x-relationship': {'type': 'many-to-one', 'target': 'approval_flow', 'labelField': 'entity_name'},
                },
                'status': {'type': 'string', 'enum': ['pending', 'approved', 'rejected']},
            },
        },
        'approvable': {
            'type': 'object',
            'required': ['id'],
            'properties': {
                'id': {'type': 'string', 'pattern': '^c[a-z0-9]{24,}$'},
                'approval_requests': {
                    'type': 'array', 'x-outputType': 'list',
                    'items': {'$ref': '#/definitions/approval_request'},
                },
            },
        },
    }


def _lockdown_schema(parent: str = 'widget', model: str = 'widget', with_proxy: bool = False) -> dict:
    """Approvable bridge + x-approval.submit_on/on_approved declared on the
    model's raw entity. Optionally adds a second, unrelated proxy view
    (widget_readonly) sharing the same model but NOT declaring the
    approvable relationship itself (no allOf over __widget) -- L2's
    fixture."""
    defs = {
        **_support_defs(),
        f'__{model}': {
            'type': 'object',
            'required': ['id', 'approvable_id', 'status'],
            'x-approval': {
                'submit_on': {'status': 'pending'},
                'on_approved': {'set_fields': {'status': 'approved'}},
                'on_rejected': {'set_fields': {'status': 'rejected'}, 'terminal': False},
                'on_withdrawn': {'set_fields': {'status': 'draft'}},
            },
            'properties': _approvable_props({
                'status': {
                    'type': 'string',
                    'enum': ['draft', 'pending', 'approved', 'rejected'],
                    'default': 'draft',
                },
            }),
        },
        parent: {
            'x-generate': {'list': True, 'view': True, 'new': True, 'edit': True,
                           'delete': True, 'invalidate': True, 'api': True, 'test': False},
            'allOf': [{'$ref': f'#/definitions/__{model}'}],
        },
    }
    if with_proxy:
        # A second view of the SAME model (mirrors how 'user'/'setting'
        # actually work in the real dogfood schema -- build_context()
        # resolves model_def by MODEL name unconditionally
        # (schema['definitions'][f'__{model}'] or [model]), so a proxy
        # view's own schema dict entry is irrelevant to that resolution;
        # what actually narrows a view's exposed properties is
        # x-generate.fields: (an allowlist -- filter_fields(), see
        # schema_helpers.py), same mechanism 'user' uses
        # (x-generate.fields: [name, image_id, roles] in the real
        # dogfood json_schema.yaml). widget_readonly's entity dict below
        # carries fields=['id', 'status'] -- excluding approvable_id --
        # which is what must make it unguarded, not a separate schema
        # definition (that would have no effect on this resolution at
        # all, which the FIRST version of this test wrongly assumed and
        # which is worth keeping visible in this comment as the trap).
        defs['widget_readonly'] = {
            'x-generate': {'list': True, 'view': True, 'new': False, 'edit': True,
                           'delete': True, 'invalidate': False, 'api': True, 'test': False},
        }
    return {'definitions': defs}


def _no_submit_on_schema() -> dict:
    """Approvable bridge present, no x-approval.submit_on declared."""
    return {
        'definitions': {
            **_support_defs(),
            '__gadget': {
                'type': 'object',
                'required': ['id', 'approvable_id'],
                'properties': _approvable_props(),
            },
            'gadget': {
                'x-generate': {'list': True, 'view': True, 'new': True, 'edit': True,
                               'delete': True, 'invalidate': True, 'api': True, 'test': False},
                'allOf': [{'$ref': '#/definitions/__gadget'}],
            },
        },
    }


def _lockdown_ctx(entity: dict, schema: dict) -> dict:
    ctx = build_context(entity, schema)
    return {**ctx, **approval_lockdown_context(ctx, schema)}


class TestApprovalLockdownContext:
    def test_edit_guard_wired_with_correct_locked_values(self):
        schema = _lockdown_schema()
        ctx = _lockdown_ctx(_entity('widget', 'widget'), schema)
        assert ctx['has_edit_guard'] is True
        assert ctx['has_delete_guard'] is True
        assert ctx['has_invalidate_guard'] is True
        assert ctx['lockdown_field'] == 'status'
        assert ctx['lockdown_locked_values_ts'] == "['pending', 'approved']"

    def test_rejected_and_withdrawn_values_not_locked(self):
        # on_rejected/on_withdrawn move status to 'rejected'/'draft' --
        # neither must appear in the locked set (846b amendment: a
        # non-terminal rejection/withdrawal unlocks, it does not re-lock).
        schema = _lockdown_schema()
        ctx = _lockdown_ctx(_entity('widget', 'widget'), schema)
        assert 'rejected' not in ctx['lockdown_locked_values_ts']
        assert 'draft' not in ctx['lockdown_locked_values_ts']

    def test_proxy_view_without_approvable_relationship_gets_no_guard(self):
        # L2: widget_readonly shares model='widget' (whose raw entity DOES
        # declare x-approval), but its own view definition has no
        # approvable_id relationship -- must get {} (no guard), proving
        # the decision is keyed by the view's own declared relationship,
        # not by Prisma model name / shared-model x-approval presence.
        schema = _lockdown_schema(with_proxy=True)
        entity = _entity('widget_readonly', 'widget', fields=['id', 'status'])
        ctx = _lockdown_ctx(entity, schema)
        assert ctx.get('has_edit_guard') in (None, False)
        assert ctx.get('has_delete_guard') in (None, False)
        assert ctx.get('has_invalidate_guard') in (None, False)
        assert 'lockdown_field' not in ctx
        # sanity: the allowlist really did drop the relationship (not a
        # vacuous pass because approval_lockdown_context short-circuited
        # for some unrelated reason)
        assert not any(r.get('target') == 'approvable' for r in ctx.get('one_to_one_rels', []))

    def test_base_view_still_guarded_when_proxy_view_coexists(self):
        schema = _lockdown_schema(with_proxy=True)
        ctx = _lockdown_ctx(_entity('widget', 'widget'), schema)
        assert ctx['has_edit_guard'] is True

    def test_no_submit_on_gets_no_guard(self):
        schema = _no_submit_on_schema()
        ctx = _lockdown_ctx(_entity('gadget', 'gadget'), schema)
        assert ctx.get('has_edit_guard') in (None, False)
        assert 'lockdown_field' not in ctx

    def test_no_approvable_bridge_gets_no_guard(self):
        schema = {
            'definitions': {
                **_support_defs(),
                'plain_thing': {
                    'x-generate': {'list': True, 'view': True, 'new': True, 'edit': True,
                                   'delete': True, 'invalidate': True, 'api': True, 'test': False},
                    'type': 'object',
                    'required': ['id'],
                    'properties': {'id': {'type': 'string', 'pattern': '^c[a-z0-9]{24,}$'}},
                },
            },
        }
        ctx = _lockdown_ctx(_entity('plain_thing', 'plain_thing'), schema)
        assert ctx.get('has_edit_guard') in (None, False)
        assert 'lockdown_field' not in ctx

    def test_guard_not_wired_when_can_update_false(self):
        # edit:false -> has_edit_guard must be False even though the
        # entity otherwise qualifies (delete/invalidate still guarded
        # independently).
        schema = _lockdown_schema()
        ctx = _lockdown_ctx(_entity('widget', 'widget', edit=False), schema)
        assert ctx['has_edit_guard'] is False
        assert ctx['has_delete_guard'] is True
        assert ctx['has_invalidate_guard'] is True


class TestServiceTsGuardCallSites:
    """L4: the guard call must land inside service.ts's update{Parent}/
    delete{Parent} -- not only a route template -- since that is the one
    choke point both the REST route AND the upsert{Parent}/remove{Parent}
    Server Action already funnel through."""

    def _svc_ctx(self, entity: dict, schema: dict) -> dict:
        ctx = build_context(entity, schema)
        ctx = {**ctx, **approval_lockdown_context(ctx, schema)}
        return {**ctx, **service_context(ctx, schema)}

    def test_update_imports_and_calls_assert_edit_allowed(self):
        svc_ctx = self._svc_ctx(_entity('widget', 'widget'), _lockdown_schema())
        assert svc_ctx['has_edit_guard'] is True
        assert "assertEditAllowed" in svc_ctx['utility_code']
        assert "from './edit_guard'" in svc_ctx['utility_code']

    def test_delete_imports_assert_delete_allowed(self):
        svc_ctx = self._svc_ctx(_entity('widget', 'widget'), _lockdown_schema())
        assert svc_ctx['has_delete_guard'] is True
        assert "assertDeleteAllowed" in svc_ctx['utility_code']
        assert "from './delete_guard'" in svc_ctx['utility_code']

    def test_no_guard_imports_when_no_submit_on(self):
        svc_ctx = self._svc_ctx(_entity('gadget', 'gadget'), _no_submit_on_schema())
        assert svc_ctx.get('has_edit_guard') is None or svc_ctx.get('has_edit_guard') is False
        assert "assertEditAllowed" not in svc_ctx['utility_code']
        assert "assertDeleteAllowed" not in svc_ctx['utility_code']
