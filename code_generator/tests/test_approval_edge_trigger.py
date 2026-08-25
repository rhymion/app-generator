"""
Regression tests for cmd_818's edge-trigger integration: approval_request
creation moves off the retired write-once `service_after_create_stub.ts.
jinja2` (afterCreate) and into inline blocks service_context() emits
directly into service.ts.jinja2's add{Parent}/update{Parent} -- firing on
the EDGE into x-approval.submit_on's target value (or, when submit_on is
undeclared, unconditionally at create time -- the pre-cmd_818 behaviour).

Covers cmd_818's acceptance criteria:
  - E1: the invariant "at most one open (pending) flow" is enforced by a
    _pendingGuard findFirst on BOTH the create and update trigger paths.
  - E2: submit_on declared/undeclared changes what create-time code is
    emitted (conditional vs. unconditional trigger).
  - E3: update-time firing is an EDGE, not a level check -- a status that
    is already submit_on and gets an unrelated field edited must NOT
    re-fire (the single point of this whole design most likely to be
    gotten wrong).
  - E4: approval_flow.entity_name lookups use `parent` (the view key), not
    `model` -- proven with a fixture where parent != model (a proxy view
    over a shared raw entity), the case cmd_816 exists to enable.
"""
from pathlib import Path

from build_context import build_context
from generators import service_context, resolve_approval_submit_on


def _entity(parent: str, model: str, edit: bool = True) -> dict:
    return {
        'parent': parent,
        'model': model,
        'definition_key': f'__{model}',
        'children': [],
        'generate_config': {
            'list': True, 'view': True, 'new': True, 'edit': edit,
            'delete': True, 'api': True, 'test': False, 'fields': None,
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
            'properties': {'id': {'type': 'string', 'pattern': '^c[a-z0-9]{24,}$'}},
        },
    }


def _no_approval_schema() -> dict:
    """Plain entity with no approvable bridge -- no edge-trigger code at all."""
    return {
        'definitions': {
            **_support_defs(),
            'organization': {
                'type': 'object',
                'required': ['id', 'name'],
                'properties': {
                    'id': {'type': 'string', 'pattern': '^c[a-z0-9]{24,}$'},
                    'name': {'type': 'string', 'minLength': 1},
                },
            },
        },
    }


def _no_submit_on_schema() -> dict:
    """Approvable bridge present, no x-approval.submit_on declared -- the
    legacy "always fire at create" default (default_behavior_no_submit_on)."""
    return {
        'definitions': {
            **_support_defs(),
            '__leave_request': {
                'type': 'object',
                'required': ['id', 'approvable_id'],
                'properties': _approvable_props(),
            },
            'leave_request': {
                'x-generate': {'list': True, 'view': True, 'new': True, 'edit': True,
                               'delete': True, 'api': True, 'test': False},
                'allOf': [{'$ref': '#/definitions/__leave_request'}],
            },
        },
    }


def _submit_on_schema(parent: str = 'purchase_request', model: str = 'purchase_request') -> dict:
    """Approvable bridge + x-approval.submit_on declared on the model's raw
    entity. parent may differ from model (proxy view) -- E4's fixture."""
    return {
        'definitions': {
            **_support_defs(),
            f'__{model}': {
                'type': 'object',
                'required': ['id', 'approvable_id', 'status'],
                'x-approval': {'submit_on': {'status': 'submitted'}},
                'properties': _approvable_props({
                    'status': {
                        'type': 'string',
                        'enum': ['draft', 'submitted', 'approved', 'rejected'],
                        'default': 'draft',
                    },
                }),
            },
            parent: {
                'x-generate': {'list': True, 'view': True, 'new': True, 'edit': True,
                               'delete': True, 'api': True, 'test': False},
                'allOf': [{'$ref': f'#/definitions/__{model}'}],
            },
        },
    }


def _svc_ctx(entity: dict, schema: dict) -> dict:
    ctx = build_context(entity, schema)
    return {**ctx, **service_context(ctx, schema)}


def _render_service(entity: dict, schema: dict) -> str:
    import sys
    sys.path.insert(0, str(Path(__file__).parent.parent))
    from generate import _make_env
    env = _make_env()
    svc_ctx = _svc_ctx(entity, schema)
    return env.get_template('service.ts.jinja2').render(**svc_ctx)


# ---------------------------------------------------------------------------
# resolve_approval_submit_on (helpers/generators.py pure resolution)
# ---------------------------------------------------------------------------

class TestResolveApprovalSubmitOn:
    def test_absent_returns_none(self):
        assert resolve_approval_submit_on({'properties': {}}) == (None, None)

    def test_single_field_resolves(self):
        raw_def = {
            'properties': {'status': {'type': 'string', 'enum': ['draft', 'submitted']}},
            'x-approval': {'submit_on': {'status': 'submitted'}},
        }
        assert resolve_approval_submit_on(raw_def) == ('status', 'submitted')

    def test_legacy_int_enum_label_resolves_to_ordinal(self):
        raw_def = {
            'properties': {'status': {'type': 'integer', 'enum': ['Draft', 'Submitted']}},
            'x-approval': {'submit_on': {'status': 'Submitted'}},
        }
        assert resolve_approval_submit_on(raw_def) == ('status', 1)

    def test_multiple_fields_rejected(self):
        raw_def = {
            'properties': {
                'status': {'type': 'string', 'enum': ['draft', 'submitted']},
                'stage': {'type': 'string', 'enum': ['a', 'b']},
            },
            'x-approval': {'submit_on': {'status': 'submitted', 'stage': 'a'}},
        }
        try:
            resolve_approval_submit_on(raw_def)
            assert False, 'expected ValueError'
        except ValueError as e:
            assert 'exactly one field' in str(e)


# ---------------------------------------------------------------------------
# No approvable bridge: no edge-trigger code emitted at all.
# ---------------------------------------------------------------------------

class TestNoApprovableBridge:
    def test_no_edge_trigger_code(self):
        svc = _svc_ctx(_entity('organization', 'organization'), _no_approval_schema())
        assert svc['approval_edge_trigger_create_code'] == ''
        assert svc['approval_edge_trigger_update_code'] == ''

    def test_rendered_service_has_no_approval_references(self):
        rendered = _render_service(_entity('organization', 'organization'), _no_approval_schema())
        assert 'approval_request' not in rendered
        assert 'approval_flow' not in rendered
        assert 'afterCreate' not in rendered


# ---------------------------------------------------------------------------
# E2: submit_on declared vs. undeclared changes the CREATE-time trigger.
# ---------------------------------------------------------------------------

class TestCreateTimeTrigger:
    def test_no_submit_on_fires_unconditionally(self):
        """default_behavior_no_submit_on: create always fires (edge from
        null -> any) -- matches the pre-cmd_818 afterCreate default."""
        code = _svc_ctx(_entity('leave_request', 'leave_request'), _no_submit_on_schema())[
            'approval_edge_trigger_create_code'
        ]
        assert code
        assert 'if (created.' not in code  # no field-value condition
        assert 'approval_request.create' in code or '_apprReq' in code

    def test_submit_on_declared_is_conditional(self):
        code = _svc_ctx(_entity('purchase_request', 'purchase_request'), _submit_on_schema())[
            'approval_edge_trigger_create_code'
        ]
        assert "if (created.status === 'submitted')" in code

    def test_pending_guard_present(self):
        """E1: guard against a second open flow, on the create path too."""
        code = _svc_ctx(_entity('purchase_request', 'purchase_request'), _submit_on_schema())[
            'approval_edge_trigger_create_code'
        ]
        assert "status: 'pending'" in code
        assert '_pendingGuard' in code
        assert 'if (!_pendingGuard)' in code


# ---------------------------------------------------------------------------
# E3: UPDATE-time trigger is an EDGE, not a level check.
# ---------------------------------------------------------------------------

class TestUpdateTimeTrigger:
    def test_no_submit_on_emits_no_update_trigger(self):
        """No target value declared -- nothing to detect a transition into
        on update (only create has a no-submit_on default)."""
        svc = _svc_ctx(_entity('leave_request', 'leave_request'), _no_submit_on_schema())
        assert svc['approval_edge_trigger_update_code'] == ''

    def test_edge_condition_compares_previous_and_new(self):
        code = _svc_ctx(_entity('purchase_request', 'purchase_request'), _submit_on_schema())[
            'approval_edge_trigger_update_code'
        ]
        assert "_prevForTrigger.status !== 'submitted'" in code
        assert "updated.status === 'submitted'" in code

    def test_pending_guard_present_on_update_path_too(self):
        code = _svc_ctx(_entity('purchase_request', 'purchase_request'), _submit_on_schema())[
            'approval_edge_trigger_update_code'
        ]
        assert "status: 'pending'" in code
        assert '_pendingGuard' in code

    def test_rendered_update_captures_result_and_prefetches_previous(self):
        rendered = _render_service(_entity('purchase_request', 'purchase_request'), _submit_on_schema())
        assert 'const _prevForTrigger = await tx.purchase_request.findUnique(' in rendered
        assert 'const updated = await tx.purchase_request.update(' in rendered

    def test_no_prefetch_or_capture_when_no_submit_on(self):
        """A no-submit_on entity must not pay for a prev-state lookup it
        never uses, and update() stays uncaptured (no unused var)."""
        rendered = _render_service(_entity('leave_request', 'leave_request'), _no_submit_on_schema())
        assert '_prevForTrigger' not in rendered
        assert 'const updated = await tx.leave_request.update(' not in rendered
        assert 'await tx.leave_request.update(' in rendered


# ---------------------------------------------------------------------------
# E4: entity_name lookups use parent (view key), not model -- the point of
# cmd_816's GROUP C. Proven with parent != model (a proxy view).
# ---------------------------------------------------------------------------

class TestEntityNameUsesParentNotModel:
    def test_create_block_uses_parent(self):
        schema = _submit_on_schema(parent='purchase_request_gate', model='purchase_request')
        code = _svc_ctx(_entity('purchase_request_gate', 'purchase_request'), schema)[
            'approval_edge_trigger_create_code'
        ]
        assert "entity_name: 'purchase_request_gate'" in code
        assert "entity_name: 'purchase_request'" not in code

    def test_update_block_uses_parent(self):
        schema = _submit_on_schema(parent='purchase_request_gate', model='purchase_request')
        code = _svc_ctx(_entity('purchase_request_gate', 'purchase_request'), schema)[
            'approval_edge_trigger_update_code'
        ]
        assert "entity_name: 'purchase_request_gate'" in code
        assert "entity_name: 'purchase_request'" not in code

    def test_prisma_calls_still_use_model(self):
        """The view key is only for approval_flow lookup -- the actual row
        lives under the Prisma model name."""
        schema = _submit_on_schema(parent='purchase_request_gate', model='purchase_request')
        rendered = _render_service(_entity('purchase_request_gate', 'purchase_request'), schema)
        assert 'tx.purchase_request.create(' in rendered
        assert 'tx.purchase_request.update(' in rendered
        assert 'tx.purchase_request_gate.' not in rendered

    def test_same_key_when_parent_equals_model(self):
        code = _svc_ctx(_entity('purchase_request', 'purchase_request'), _submit_on_schema())[
            'approval_edge_trigger_create_code'
        ]
        assert "entity_name: 'purchase_request'" in code
