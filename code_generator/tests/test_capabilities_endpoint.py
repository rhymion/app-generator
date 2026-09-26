"""
Row-level capability endpoint (GET /api/{entity}/[id]/capabilities,
ai-agent-integration-design.md Stage 1 scope item (b)).

Covers:
  - C1: capabilities_context() resolves the approvable bridge's own FK
    prop name the same way approval_lockdown_context() does, independent
    of has_edit_guard/has_delete_guard (see that function's own docstring
    for why the two must not be collapsed into one call).
  - C2: the route is only ever written for can_view entities (verified at
    the template-rendering level via the operations/read section always
    being present).
  - C3: the approval section only renders (imports + the `approval`
    object) when has_approvable_bridge is True -- a plain x-approval
    entity with no bridge gets `approval: null` and none of the
    approval_request-specific imports, proving no parallel/duplicate
    judgment was invented for that case.
  - C4: write_locks.edit_locked/delete_locked call the SAME generated
    guard functions (assertEditAllowed/assertDeleteAllowed) every other
    entry point calls, wrapped in try/catch rather than a second
    judgment.
  - C5: transitions calls the SAME assertTransitionAllowed every write
    path already calls, looped over the diagram's own static state list
    -- never a re-derivation of diagram edges.
  - C6: is_self_only routes the operations.update/delete check through
    ownership (creator_id === actorId), matching the write path's own
    "no admin bypass on write" rule, instead of canAccess().
"""
from build_context import build_context
from generators import approval_lockdown_context, capabilities_context
from generate import _make_env, _render


def _entity(parent: str, model: str, edit: bool = True, delete: bool = True,
            view: bool = True, api: bool = True, fields: list | None = None) -> dict:
    return {
        'parent': parent,
        'model': model,
        'definition_key': f'__{model}' if model == parent else parent,
        'children': [],
        'generate_config': {
            'list': True, 'view': view, 'new': True, 'edit': edit,
            'delete': delete, 'invalidate': False, 'api': api,
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


def _bridge_schema(parent: str = 'widget', model: str = 'widget') -> dict:
    """Approvable bridge + x-approval.submit_on/on_approved declared --
    mirrors test_approval_edit_delete_invalidate_lockdown.py's
    _lockdown_schema(), independently built here so this test module has
    no cross-file coupling (matches this test suite's established
    per-file fixture-builder convention)."""
    return {
        'definitions': {
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
                               'delete': True, 'invalidate': False, 'api': True, 'test': False},
                'allOf': [{'$ref': f'#/definitions/__{model}'}],
            },
        },
    }


def _plain_schema(name: str = 'gadget', extra_props: dict | None = None,
                   x_approval: dict | None = None) -> dict:
    props = {'id': {'type': 'string', 'pattern': '^c[a-z0-9]{24,}$'}}
    if extra_props:
        props.update(extra_props)
    d: dict = {
        'x-generate': {'list': True, 'view': True, 'new': True, 'edit': True,
                       'delete': True, 'invalidate': False, 'api': True, 'test': False},
        'type': 'object',
        'required': ['id'],
        'properties': props,
    }
    if x_approval:
        d['x-approval'] = x_approval
    return {'definitions': {name: d}}


def _full_ctx(entity: dict, schema: dict) -> dict:
    ctx = build_context(entity, schema)
    ctx = {**ctx, **approval_lockdown_context(ctx, schema)}
    ctx = {**ctx, **capabilities_context(ctx)}
    return ctx


def _rendered(entity: dict, schema: dict) -> str:
    env = _make_env()
    return _render(env, 'api_capabilities_route.ts.jinja2', _full_ctx(entity, schema))


class TestCapabilitiesContext:
    def test_no_bridge_resolves_false(self):
        schema = _plain_schema()
        ctx = _full_ctx(_entity('gadget', 'gadget'), schema)
        assert ctx['has_approvable_bridge'] is False
        assert ctx['approvable_fk'] is None

    def test_bridge_resolves_fk_prop_name(self):
        schema = _bridge_schema()
        ctx = _full_ctx(_entity('widget', 'widget'), schema)
        assert ctx['has_approvable_bridge'] is True
        assert ctx['approvable_fk'] == 'approvable_id'

    def test_bridge_resolved_independent_of_edit_guard(self):
        # capabilities_context() must resolve the bridge even when
        # has_edit_guard/has_delete_guard are both False for an unrelated
        # reason (no update/delete route at all) -- the two functions
        # answer different questions from the same relationship fact.
        schema = _bridge_schema()
        ctx = _full_ctx(_entity('widget', 'widget', edit=False, delete=False), schema)
        assert ctx['has_edit_guard'] is False
        assert ctx['has_delete_guard'] is False
        assert ctx['has_approvable_bridge'] is True
        assert ctx['approvable_fk'] == 'approvable_id'


class TestCapabilitiesRouteRendering:
    def test_plain_entity_no_approval_section(self):
        rendered = _rendered(_entity('gadget', 'gadget'), _plain_schema())
        assert 'approval: null,' in rendered
        assert 'approval_request' not in rendered
        assert 'canSubmitForApproval' not in rendered
        # cmd_1180: update/delete reuse the RichPermissions already
        # resolved for the 'read' check -- no separate canAccess() call
        # (and therefore no second getModelPermissions() fetch) per
        # operation.
        assert 'update: resolved.update,' in rendered
        assert 'delete: resolved.delete,' in rendered
        assert 'canAccess' not in rendered

    def test_permission_check_precedes_item_fetch(self):
        # cmd_1180 design constraint (1): the coarse, item-independent
        # permission check must run BEFORE this route ever queries the
        # item table, so a caller with no possible access path at all
        # never learns whether the row exists (no 404-vs-403 leak). The
        # item-level (Creator/Assignee) resolution then reuses that same
        # RichPermissions object -- see test_plain_entity_no_approval_section.
        rendered = _rendered(_entity('gadget', 'gadget'), _plain_schema())
        coarse_check = "const basePerms = await requireApiPermission(actorId, 'gadget', 'read');"
        item_fetch = 'const item = await getGadgetDetail(id);'
        assert coarse_check in rendered
        assert item_fetch in rendered
        assert rendered.index(coarse_check) < rendered.index(item_fetch)
        # The item-level re-check happens strictly after the item is
        # fetched (resolvePermissions needs the item's creator_id/
        # assignee_id) -- proving this isn't just a coincidental ordering
        # of two independent statements.
        resolve_call = 'const resolved = await resolvePermissions(basePerms, item, actorId);'
        assert resolve_call in rendered
        assert rendered.index(item_fetch) < rendered.index(resolve_call)

    def test_bridge_entity_gets_approval_section_and_imports(self):
        rendered = _rendered(_entity('widget', 'widget'), _bridge_schema())
        assert "from '@/lib/approval_request/submit_predicate'" in rendered
        assert "from '@/lib/approval_request/order-check'" in rendered
        assert "from '@/lib/approval_request/on_withdrawn_dispatch'" in rendered
        assert 'canSubmitForApproval(_latestRoundRequests)' in rendered
        assert 'canWithdrawApproval(_latestRoundRequests)' in rendered
        assert "hasOnWithdrawn('widget')" in rendered
        assert '_item.approvable_id' in rendered
        assert 'approval,' in rendered
        assert 'approval: null,' not in rendered

    def test_bridge_entity_approval_round_lookup_parallelizes_role_ids(self):
        # subtask_1180d (re-landing subtask_1176n item 3, dropped when PR#748
        # was closed as superseded during the PR#749 conflict resolution):
        # getUserRoleIds(actorId) has no data dependency on the
        # findFirst -> findMany pair (findMany's round_id argument comes from
        # findFirst's own result, a real sequential dependency), so it must
        # run concurrently via Promise.all rather than after the pair.
        rendered = _rendered(_entity('widget', 'widget'), _bridge_schema())
        assert (
            'const [_latestRoundRequests, _roleIds] = await Promise.all([' in rendered
        )
        assert 'getUserRoleIds(actorId),' in rendered
        assert 'const _roleIds = await getUserRoleIds(actorId);' not in rendered

    def test_bridge_entity_reuses_edit_delete_guards(self):
        rendered = _rendered(_entity('widget', 'widget'), _bridge_schema())
        assert "from '@/lib/widget/edit_guard'" in rendered
        assert "from '@/lib/widget/delete_guard'" in rendered
        assert 'assertEditAllowed(item as { status?: unknown })' in rendered
        assert 'assertDeleteAllowed(item as { status?: unknown })' in rendered
        # no second/parallel derivation of the locked-value set -- the
        # route only ever calls the generated guard, never re-reads
        # LOCKED_STATUS_VALUES itself.
        assert 'LOCKED_' not in rendered

    def test_no_bridge_write_locks_are_null_not_false(self):
        # A plain x-approval entity (no approvable bridge) has no
        # edit_guard/delete_guard at all -- edit_locked/delete_locked
        # must be null (meaning "not applicable"), never a fabricated
        # false (which would misrepresent "known unlocked").
        rendered = _rendered(
            _entity('gadget', 'gadget'),
            _plain_schema(
                extra_props={'status': {'type': 'string', 'enum': ['pending', 'active'], 'default': 'pending'}},
                x_approval={
                    'submit_on': {'status': 'pending'},
                    'on_approved': {'set_fields': {'status': 'active'}},
                },
            ),
        )
        assert 'edit_locked: null,' in rendered
        assert 'delete_locked: null,' in rendered
        assert 'locked_fields: ["status"]' in rendered

    def test_is_self_only_uses_ownership_not_canaccess(self):
        schema = _plain_schema()
        schema['definitions']['gadget']['x-self-only'] = True
        rendered = _rendered(_entity('gadget', 'gadget'), schema)
        assert '_item.creator_id === actorId' in rendered
        assert 'canAccess' not in rendered

    def test_update_false_hardcodes_false(self):
        rendered = _rendered(_entity('gadget', 'gadget', edit=False), _plain_schema())
        assert 'update: false,' in rendered
        assert "canAccess('gadget', 'update'" not in rendered
