"""
Authorization of the invalidate action and path safety of the local-disk upload.

invalidate{Parent} (REST route and Server Action) must authorize against the
actual record, the same way DELETE does: a model-wide permission check alone
passes for any caller once a Creator/Assignee role holds delete on the model,
because the merged model-level flag is the broadest possible one. The record
must also be inside the caller's organizations when the entity is org-scoped.

The upload route's local-disk fallback must never use the client-supplied
filename as a path: the stored name is reduced to its last segment and the
final path is confined inside the upload directory.
"""
from pathlib import Path

from jinja2 import Environment, FileSystemLoader

REPO_ROOT = Path(__file__).resolve().parents[2]
TEMPLATES_DIR = REPO_ROOT / 'code_generator' / 'templates'

ITEM_SELECT = '{ id: true, creator_id: true }'


def _render(template: str, **context) -> str:
    env = Environment(
        loader=FileSystemLoader(str(TEMPLATES_DIR)),
        trim_blocks=True, lstrip_blocks=True,
    )
    base = {
        'parent': 'widget',
        'parent_pascal': 'Widget',
        'parent_camel': 'widget',
        'model': 'widget',
        'can_create': False,
        'can_update': False,
        'can_delete': False,
        'can_list': False,
        'can_invalidate': True,
        'invalidate_module': '',
        'invalidate_handler': '',
        'comment_actions_code': '',
        'has_commentable': False,
        'has_invalidate_guard': False,
        'should_filter_by_org': False,
        'org_relationship_optional': False,
        'is_self_only': False,
        'item_context_select': ITEM_SELECT,
        'service_imports': None,
    }
    base.update(context)
    return env.get_template(template).render(**base)


def _both(**context):
    return {
        'route': _render('invalidate_action_route.ts.jinja2', **context),
        'action': _render('actions.ts.jinja2', **context),
    }


def test_invalidate_resolves_permission_against_the_record():
    out = _both()
    assert "resolveRecordPermissions(basePerms, existing, userId)" in out['route']
    assert "findUnique({ where: { id }, select: " + ITEM_SELECT in out['route']
    assert "throw new ApiError(403, `Access denied: widget.delete`)" in out['route']
    assert "resolveRecordPermissions(_invalidateBasePerms, _invalidateItem, userId)" in out['action']
    assert "findUnique({ where: { id }, select: " + ITEM_SELECT in out['action']
    assert "AppError('PERMISSION_DENIED', 'Access denied: widget.delete')" in out['action']


def test_invalidate_never_calls_the_item_less_permission_check_alone():
    out = _both()
    # the coarse gate is kept, but its result must be used for the record-level check
    assert "const basePerms = await requireApiPermission(userId, 'widget', 'delete');" in out['route']
    assert "const _invalidateBasePerms = await requireEntityPermission('widget', 'delete', userId);" in out['action']


def test_invalidate_org_scoped_entity_is_filtered_by_associated_organizations():
    out = _both(should_filter_by_org=True)
    for src in out.values():
        assert 'getAssociatedOrganizations' in src
        assert 'organization_id: { in: _assocOrgIds }' in src
        assert 'findFirst' in src
    assert "import { getAssociatedOrganizations } from '@/lib/organization/associated_internal';" in out['route']
    assert "import { getAssociatedOrganizations } from '@/lib/organization/associated_internal';" in out['action']


def test_invalidate_org_optional_entity_also_allows_null_organization():
    out = _both(should_filter_by_org=True, org_relationship_optional=True)
    for src in out.values():
        assert 'organization_id: null' in src


def test_invalidate_not_org_scoped_has_no_org_lookup():
    out = _both()
    for src in out.values():
        assert 'getAssociatedOrganizations' not in src


def test_invalidate_self_only_entity_requires_ownership():
    out = _both(is_self_only=True)
    assert 'existing.creator_id !== userId' in out['route']
    assert '_invalidateItem.creator_id !== userId' in out['action']
    assert 'resolveRecordPermissions' not in out['route']
    assert 'resolveRecordPermissions' not in out['action']


def test_invalidate_record_lookup_precedes_the_handler_call():
    out = _both(invalidate_module='lib/x/handler', invalidate_handler='doIt')
    assert out['route'].index('resolveRecordPermissions(') < out['route'].index('await doIt(id)')
    assert out['action'].index('resolveRecordPermissions(') < out['action'].index('await doIt(id)')


def test_upload_route_never_uses_the_client_filename_as_a_storage_location():
    out = _render('upload_route.ts.jinja2')
    # The route hands the file to the shared upload core, which stores it under a random key.
    assert 'storeUploadedFile(file, uploadCheck.contentType, userId)' in out
    assert 'file.name' not in out
    assert 'writeFile' not in out and "'public'" not in out


def test_upload_route_answers_with_the_attachment_id_never_a_path_or_url():
    out = _render('upload_route.ts.jinja2')
    assert 'return NextResponse.json(stored, { status: 200 });' in out
    assert 'url' not in out.replace('request.url', '')


def test_upload_route_rate_limits_per_user_before_parsing_the_body():
    out = _render('upload_route.ts.jinja2')
    assert "getRateLimiter().check('upload:file', userId)" in out
    assert "status: 429" in out and "'Retry-After'" in out
    # Checked after authentication and before the multipart body is read.
    assert out.index('requireCaller(request)') < out.index("check('upload:file'") < out.index('readBodyWithLimit(request')
