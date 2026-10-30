"""
Generated attachment storage and delivery: the access module, the serve route, the reserved
orphan-cleanup task handler and the attachment provenance schema check.

The runtime behavior (a stranger gets 404, a member without read gets 403, only the uploader attaches an
upload) is covered end to end by the comment-rest-e2e-gate fixture specs and by cypress/e2e/api; these
tests pin the generated shape.
"""
from pathlib import Path

import pytest
from jinja2 import Environment, FileSystemLoader

from validate import SchemaValidationError, validate_attachment_provenance_columns

REPO_ROOT = Path(__file__).resolve().parents[2]
TEMPLATES_DIR = REPO_ROOT / 'code_generator' / 'templates'


def _render(template: str, **ctx) -> str:
    env = Environment(loader=FileSystemLoader(str(TEMPLATES_DIR)), trim_blocks=True, lstrip_blocks=True)
    return env.get_template(template).render(**ctx)


def _access(bridge=(), direct=()) -> str:
    getter_owners = sorted({o['name']: o for o in [*bridge, *direct]}.values(), key=lambda o: o['name'])
    return _render('attachment_access.ts.jinja2', bridge_owners=list(bridge), direct_owners=list(direct),
                   getter_owners=getter_owners)


def _bridge(name='resource', user_arg=True):
    return {'name': name, 'pascal': name.capitalize(), 'user_arg': user_arg}


def _direct(name='user', fk='image_id', back='user_image', user_arg=False):
    return {'name': name, 'model': name, 'pascal': name.capitalize(), 'fk_prop': fk, 'back_relation': back,
            'user_arg': user_arg}


# --- access module ----------------------------------------------------------------------------------

def test_unlinked_filter_names_the_bridge_and_every_direct_back_relation():
    out = _access(bridge=[_bridge()], direct=[_direct(), _direct('doc', 'file_id', 'doc_file'), _direct('doc', 'scan_id', 'doc_scan')])
    block = out.split('export const UNLINKED_ATTACHMENT_WHERE = {')[1].split('};')[0]
    assert 'attachable_id: null,' in block
    for back in ('user_image', 'doc_file', 'doc_scan'):
        assert f'{back}: null,' in block


def test_each_owner_detail_getter_is_imported_once():
    out = _access(direct=[_direct('doc', 'file_id', 'doc_file'), _direct('doc', 'scan_id', 'doc_scan')])
    assert out.count("import { getDocDetail } from '@/lib/doc/getters_internal';") == 1
    # ... and a lookup is generated per foreign key.
    assert "prisma.doc.findFirst({ where: { file_id: attachment.id }" in out
    assert "prisma.doc.findFirst({ where: { scan_id: attachment.id }" in out


def test_without_a_bridge_owner_no_empty_select_is_generated():
    out = _access(direct=[_direct()])
    # An empty `select: {}` is rejected by Prisma at run time.
    assert 'prisma.attachable.findUnique' not in out
    assert 'select: {\n      },' not in out
    assert "if (attachment.attachable_id) {\n    return 'not_found';\n  }" in out


def test_owner_read_goes_through_the_owners_own_permission_and_scope():
    out = _access(bridge=[_bridge('resource', True), _bridge('product', False)])
    assert "readOwner(actorId, 'resource', () => getResourceDetail(ownerId, actorId) as never)" in out
    assert "readOwner(actorId, 'product', () => getProductDetail(ownerId) as never)" in out
    # Read permission first (403), then the organization-scoped getter (404), then item-level resolution.
    body = out.split('async function readOwner(')[1].split('export async function')[0]
    assert body.index('if (!base.read) return') < body.index('await load()') < body.index('resolveRecordPermissions(')
    assert "return 'forbidden';" in body and "return 'not_found';" in body


def test_an_unreferenced_upload_is_readable_only_by_its_uploader():
    out = _access(bridge=[_bridge()])
    assert "attachment.uploader_id !== null && attachment.uploader_id === actorId ? 'allow' : 'not_found'" in out


# --- serve route ------------------------------------------------------------------------------------

def test_serve_route_authorizes_before_it_touches_storage():
    out = _render('attachment_serve_route.ts.jinja2')
    assert out.index('authorizeAttachmentRead(') < out.index('serveStoredObject(')
    assert out.index('isStorageKey(attachment.path)') < out.index('authorizeAttachmentRead(')
    assert "decision === 'forbidden'" in out and 'status: 403' in out
    assert 'status: 401' in out
    # The stored key is never part of a response body or header.
    assert 'NextResponse.json' not in out


def test_serve_route_delivers_the_decrypted_original_name():
    out = _render('attachment_serve_route.ts.jinja2')
    assert 'decryptFileName(attachment.encrypted_original_name)' in out
    assert "filename*=UTF-8''" in out


# --- upload route -----------------------------------------------------------------------------------

def test_upload_route_has_no_public_or_local_path_handling():
    out = _render('upload_route.ts.jinja2')
    for needle in ("'public'", 'uploads', 'access:', 'put(', 'writeFile'):
        assert needle not in out


# --- orphan cleanup handler -------------------------------------------------------------------------

def test_reserved_task_id_gets_the_cleanup_handler():
    out = _render('service_scheduled_bulk_handler_stub.ts.jinja2', task_id='attachment_orphan_cleanup',
                  handler='cleanUpOrphanAttachments')
    assert "from '@/lib/attachment/orphan_cleanup'" in out
    assert "from '@/lib/attachment/access'" in out
    assert 'deleteOrphanAttachments(UNLINKED_ATTACHMENT_WHERE)' in out
    assert 'export async function cleanUpOrphanAttachments(systemActorId: string)' in out
    assert 'TODO' not in out


def test_other_tasks_keep_the_empty_stub():
    out = _render('service_scheduled_bulk_handler_stub.ts.jinja2', task_id='demo_reset', handler='resetDemo')
    assert 'TODO: implement scheduled-task side effects here' in out
    assert 'orphan_cleanup' not in out


# --- provenance schema check ------------------------------------------------------------------------

_ATTACHMENT = """
model attachment {
  id String @id
  path String
%s}
"""


def _schema(tmp_path: Path, extra: str) -> Path:
    path = tmp_path / 'schema.prisma'
    path.write_text(_ATTACHMENT % extra)
    return path


def test_provenance_columns_present_passes(tmp_path):
    validate_attachment_provenance_columns(_schema(tmp_path, '  uploader_id String?\n  uploader_organization_id String?\n'))


@pytest.mark.parametrize('extra', ['', '  uploader_id String?\n', '  uploader_organization_id String?\n',
                                   '  uploader_id String\n  uploader_organization_id String?\n'])
def test_missing_provenance_columns_fail_with_the_lines_to_add(tmp_path, extra):
    with pytest.raises(SchemaValidationError) as err:
        validate_attachment_provenance_columns(_schema(tmp_path, extra))
    assert 'uploader_id              String?' in str(err.value)
    assert 'uploader_organization_id String?' in str(err.value)
    assert 'AttachmentUploader' in str(err.value)


def test_a_schema_without_an_attachment_model_is_not_asked_to_add_one(tmp_path):
    path = tmp_path / 'schema.prisma'
    path.write_text('model thing {\n  id String @id\n}\n')
    validate_attachment_provenance_columns(path)
