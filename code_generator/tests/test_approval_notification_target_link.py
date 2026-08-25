"""
Regression tests for cmd_479: approval_request notifications must link to
the approvable's own detail page (`/{entity}/view/{id}`), never to
`/approval_request/view/{id}` — that route has no page (approval_request
has no `x-generate: {view: true}`), so the old hard-coded link 404'd for
every consumer.

Three generated surfaces are covered, mirroring the three places a
notification can be created:

  1. `_build_approval_create_block_for_entity` / `_build_split_approval_inherit_block`
     (generators.py) — the shared inner blocks used by x-approval-lines and
     the split-action route.
  2. `service_after_create_stub.ts.jinja2` — the top-level single-entity
     afterCreate hook (Trigger #2).
  3. `split_action_route.ts.jinja2` — the split-action route must create the
     child row BEFORE the approval block runs, or no target id exists yet
     to link to.
  4. `resolve_approvable_target.ts.jinja2` — the runtime resolver used by
     Trigger #3 (approve/reject), which only has entity_name + approvable_id
     at hand, not the target row's id directly.
"""
from pathlib import Path

from jinja2 import Environment, FileSystemLoader

from generators import (
    _build_approval_create_block_for_entity,
    _build_split_approval_inherit_block,
    _build_approval_lines_post_create_code,
    _build_approval_edge_trigger_create_code,
)

REPO_ROOT = Path(__file__).resolve().parents[2]
TEMPLATES_DIR = REPO_ROOT / 'code_generator' / 'templates'


def _env() -> Environment:
    return Environment(
        loader=FileSystemLoader(str(TEMPLATES_DIR)),
        trim_blocks=True, lstrip_blocks=True,
    )


# ---------------------------------------------------------------------------
# generators.py block builders
# ---------------------------------------------------------------------------

def test_approval_create_block_passes_target_through_when_given():
    out = _build_approval_create_block_for_entity(
        approvable_id_expr='_apprId', actor_id_expr='actorId',
        flows_var='flows', role_ids_var='roleIds',
        target_entity_name='leave_request', target_id_expr='_targetId',
    )
    assert "targetEntityName: 'leave_request'" in out
    assert 'targetId: _targetId' in out


def test_approval_create_block_omits_target_when_not_given():
    out = _build_approval_create_block_for_entity(
        approvable_id_expr='_apprId', actor_id_expr='actorId',
        flows_var='flows', role_ids_var='roleIds',
    )
    assert 'targetEntityName' not in out
    assert out.count('notifyApprovalRequestCreated') == 1


def test_split_approval_inherit_block_passes_target_through_when_given():
    out = _build_split_approval_inherit_block(
        target_entity_name='purchase_order', target_id_expr='_splitChild.id',
    )
    assert "targetEntityName: 'purchase_order'" in out
    assert 'targetId: _splitChild.id' in out


def test_no_block_ever_hardcodes_approval_request_view_link():
    """Regression guard for the original bug: no generated approval-create
    block may reference `/approval_request/view/` — that route doesn't
    exist. (The href itself is built downstream in _notifyApprovalRequest.ts
    from targetEntityName/targetId; these blocks only ever pass IDs.)"""
    blocks = [
        _build_approval_create_block_for_entity(
            approvable_id_expr='_apprId', actor_id_expr='actorId',
            flows_var='flows', role_ids_var='roleIds',
            target_entity_name='leave_request', target_id_expr='_targetId',
        ),
        _build_split_approval_inherit_block(
            target_entity_name='purchase_order', target_id_expr='_splitChild.id',
        ),
    ]
    for b in blocks:
        assert '/approval_request/view/' not in b


# ---------------------------------------------------------------------------
# x-approval-lines: line row resolved by approvable_id before notifying
# ---------------------------------------------------------------------------

def _approval_lines_schema():
    return {
        'definitions': {
            'purchase_order_line': {
                'type': 'object',
                'properties': {'id': {'type': 'string'}},
            },
            'purchase_order': {
                'type': 'object',
                # get_approval_lines_props() reads this list off the raw
                # parent def — it names which properties are embedded
                # approval-lines children. get_detail_properties() (called
                # with detail_key=None) resolves the property's target via
                # this same def's own 'properties', not a separate
                # '{model}_detail' — the Stage-4 schema this runs against
                # has already merged detail views into the raw entity.
                'x-approval-lines': ['lines'],
                'properties': {
                    'id': {'type': 'string'},
                    'lines': {
                        'type': 'array',
                        'items': {'$ref': '#/definitions/purchase_order_line'},
                    },
                },
            },
        },
    }


def test_approval_lines_post_create_code_resolves_target_before_notify():
    schema = _approval_lines_schema()
    parent_def = schema['definitions']['purchase_order']
    out = _build_approval_lines_post_create_code(parent_def, 'purchase_order', schema)
    assert out, 'expected non-empty code for an x-approval-lines property'
    # The line row (created earlier, nested under the parent's own create)
    # is looked up by approvable_id so its own id can be linked to.
    assert 'tx.purchase_order_line.findFirst' in out
    assert 'approvable_id: _apprId' in out
    assert "targetEntityName: 'purchase_order_line'" in out
    assert 'targetId: _apprTargetId' in out
    # Resolution must happen before the notify call it feeds.
    assert out.index('_apprTargetRow') < out.index('notifyApprovalRequestCreated')


# ---------------------------------------------------------------------------
# _build_approval_edge_trigger_create_code (cmd_818: replaces the retired
# service_after_create_stub.ts.jinja2 -- Trigger #2, top-level single entity,
# now emitted inline into service.ts.jinja2's add{Parent}).
# ---------------------------------------------------------------------------

def test_edge_trigger_create_passes_own_entity_name_and_id():
    approvable_rel = {'relation_name': 'approvable', 'prop_name': 'approvable_id'}
    out = _build_approval_edge_trigger_create_code(
        approvable_rel, 'leave_request', None, None,
    )
    assert "targetEntityName: 'leave_request'" in out
    assert 'targetId: created.id' in out
    assert 'notifyApprovalRequestCreated' in out


# ---------------------------------------------------------------------------
# split_action_route.ts.jinja2 (child row must exist before the notify call)
# ---------------------------------------------------------------------------

def _split_ctx(**overrides):
    ctx = {
        'entity_name': 'purchase_per_item',
        'pascal_name': 'PurchasePerItem',
        'status_split_value': 'split',
        'status_rejected_value': 'rejected',
        'has_approvable': True,
        'approval_create_block': _build_split_approval_inherit_block(
            indent='        ',
            target_entity_name='purchase_per_item',
            target_id_expr='_splitChild.id',
        ),
        'has_quantity_check': False,
        'quantity_field': None,
        'per_part_required': [],
        'parent_field': None,
        'split_result_field': None,
        'inherited_fields': [],
        'has_inventory_bridge': False,
        'split_reserves_inventory': False,
        'product_id_field': None,
        'per_part_required_mandatory': [],
    }
    ctx.update(overrides)
    return ctx


def test_split_route_creates_child_before_approval_block():
    out = _env().get_template('split_action_route.ts.jinja2').render(**_split_ctx())
    create_idx = out.index('const _splitChild = await tx.purchase_per_item.create(')
    # Search for the call, not the bare identifier — the latter also
    # appears earlier in the file's top-of-file import statement.
    notify_idx = out.index('notifyApprovalRequestCreated(tx,')
    assert create_idx < notify_idx, (
        'the split child row must be created before notifyApprovalRequestCreated '
        'runs, or targetId (_splitChild.id) refers to a row that does not exist yet'
    )
    assert "targetEntityName: 'purchase_per_item'" in out
    assert 'targetId: _splitChild.id' in out
    assert '/approval_request/view/' not in out


def test_split_route_no_unused_var_when_not_approvable():
    """When has_approvable is False, the create-result must not be captured
    into an unused `_splitChild` local (would trip no-unused-vars lint)."""
    out = _env().get_template('split_action_route.ts.jinja2').render(
        **_split_ctx(has_approvable=False, approval_create_block='')
    )
    assert '_splitChild' not in out
    assert 'await tx.purchase_per_item.create(' in out


# ---------------------------------------------------------------------------
# resolve_approvable_target.ts.jinja2 (Trigger #3 runtime resolver)
# ---------------------------------------------------------------------------

def test_resolve_target_template_emits_one_branch_per_entity():
    out = _env().get_template('resolve_approvable_target.ts.jinja2').render(
        entities=[
            {'parent': 'leave_request', 'model': 'leave_request'},
            {'parent': 'receiving_receipt', 'model': 'receiving_receipt'},
        ],
    )
    assert "if (entityType === 'leave_request')" in out
    assert 'tx.leave_request.findFirst({ where: { approvable_id: approvableId }' in out
    assert "if (entityType === 'receiving_receipt')" in out
    assert 'return null;' in out


def test_resolve_target_template_uses_parent_key_model_query_when_they_differ():
    """cmd_818 GROUP C2: a proxy view's entity_name (parent) may differ from
    its Prisma model -- the match key and the queried table must not be
    conflated."""
    out = _env().get_template('resolve_approvable_target.ts.jinja2').render(
        entities=[{'parent': 'purchase_request_gate', 'model': 'purchase_request'}],
    )
    assert "if (entityType === 'purchase_request_gate')" in out
    assert 'tx.purchase_request.findFirst(' in out
    assert "if (entityType === 'purchase_request_gate') return 'purchase_request';" in out


def test_resolve_target_template_valid_with_zero_entities():
    """Must always render a valid module (actions.ts imports it
    unconditionally) even when no consumer entity has an approvable bridge
    yet — the function should just always return null."""
    out = _env().get_template('resolve_approvable_target.ts.jinja2').render(entities=[])
    assert 'export async function resolveApprovableTarget' in out
    assert 'return null;' in out
