"""
GET/PUT/DELETE /api/{entity}/[id] (api_detail_route.ts.jinja2): the
permission check must run BEFORE this route ever queries the item table,
and must reuse the resulting RichPermissions object for the item-level
resolution rather than fetching it a second time.

Rationale: fetching the item before checking whether the caller has ANY
possible access path lets a caller with zero permission on this model
learn whether a given id exists at all, via a 404-vs-403 status-code
distinction. The fix is a two-phase check: a coarse, item-independent gate
first (rejects a caller with no possible access path before the item
table is ever queried), then, once the item is fetched, an item-level
(Creator/Assignee) resolution reusing the SAME RichPermissions object --
never a second getModelPermissions()-backed call for this model.
"""
from build_context import build_context
from generate import _make_env, _render


def _entity(parent: str, model: str) -> dict:
    return {
        'parent': parent,
        'model': model,
        'definition_key': parent,
        'children': [],
        'generate_config': {
            'list': True, 'view': True, 'new': True, 'edit': True,
            'delete': True, 'invalidate': False, 'api': True,
            'test': False, 'fields': None,
        },
    }


def _plain_schema(name: str = 'gizmo', self_only: bool = False) -> dict:
    d: dict = {
        'x-generate': {'list': True, 'view': True, 'new': True, 'edit': True,
                        'delete': True, 'invalidate': False, 'api': True, 'test': False},
        'type': 'object',
        'required': ['id'],
        'properties': {'id': {'type': 'string', 'pattern': '^c[a-z0-9]{24,}$'}},
    }
    if self_only:
        d['x-self-only'] = True
    return {'definitions': {name: d}}


def _rendered(entity: dict, schema: dict) -> str:
    ctx = build_context(entity, schema)
    env = _make_env()
    return _render(env, 'api_detail_route.ts.jinja2', ctx)


class TestDetailRoutePermissionOrder:
    def test_get_checks_permission_before_fetching_item(self):
        rendered = _rendered(_entity('gizmo', 'gizmo'), _plain_schema())
        coarse_check = "const basePerms = await requireApiPermission(actorId, 'gizmo', 'read');"
        item_fetch = 'const item = await getGizmoDetail(id);'
        resolve_call = 'const resolved = await resolvePermissions(basePerms, item, actorId);'
        assert coarse_check in rendered
        assert item_fetch in rendered
        assert resolve_call in rendered
        assert rendered.index(coarse_check) < rendered.index(item_fetch)
        assert rendered.index(item_fetch) < rendered.index(resolve_call)
        # No second getModelPermissions()-backed call for this model.
        assert "requireApiPermission(actorId, 'gizmo', 'read', item)" not in rendered

    def test_put_checks_permission_before_fetching_existing(self):
        rendered = _rendered(_entity('gizmo', 'gizmo'), _plain_schema())
        coarse_check = "const basePerms = await requireApiPermission(actorId, 'gizmo', 'update');"
        item_fetch = 'const existing = await prisma.gizmo.findUnique({ where: { id }, select:'
        resolve_call = 'const resolved = await resolvePermissions(basePerms, existing, actorId);'
        assert coarse_check in rendered
        assert item_fetch in rendered
        assert resolve_call in rendered
        assert rendered.index(coarse_check) < rendered.index(item_fetch)
        assert rendered.index(item_fetch) < rendered.index(resolve_call)
        assert "requireApiPermission(actorId, 'gizmo', 'update', existing)" not in rendered

    def test_delete_checks_permission_before_fetching_existing(self):
        rendered = _rendered(_entity('gizmo', 'gizmo'), _plain_schema())
        coarse_check = "const basePerms = await requireApiPermission(actorId, 'gizmo', 'delete');"
        resolve_call = 'const resolved = await resolvePermissions(basePerms, existing, actorId);'
        assert coarse_check in rendered
        assert resolve_call in rendered
        # Two DELETE-scoped occurrences of the fetch line exist in the file
        # (PUT's and DELETE's `existing` fetch render identically for a
        # plain, non-org-scoped entity) -- assert ordering against the
        # LAST occurrence of each marker pair, which is DELETE's own.
        assert rendered.rindex(coarse_check) < rendered.rindex(resolve_call)

    def test_is_self_only_update_delete_unaffected_no_richpermissions(self):
        # Self-only entities gate update/delete purely on ownership
        # (creator_id === actorId) -- no RichPermissions object involved
        # at all for those operations, so there is nothing to reorder or
        # reuse there. Only the (unconditional, non-self-only-gated) read
        # check goes through the two-phase basePerms/resolved pattern.
        rendered = _rendered(_entity('gizmo', 'gizmo'), _plain_schema(self_only=True))
        assert 'existing.creator_id !== actorId' in rendered
        assert "requireApiPermission(actorId, 'gizmo', 'update')" not in rendered
        assert "requireApiPermission(actorId, 'gizmo', 'delete')" not in rendered
        # The read path is unconditional regardless of is_self_only.
        assert "const basePerms = await requireApiPermission(actorId, 'gizmo', 'read');" in rendered
