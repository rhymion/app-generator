"""
Regression tests: deleting an owner record removes its attachments.

The owner's delete service must delete the attachment rows linked to the owner's `attachable`
bridge row inside the delete transaction (before the bridge row goes, which would only unlink
them), and remove the stored files once the transaction has committed. Entities that own no
attachable bridge must not carry any of this.
"""

from pathlib import Path

from jinja2 import Environment, FileSystemLoader

from build_context import build_context
from generators import service_context

TEMPLATES_DIR = Path(__file__).resolve().parent.parent / 'templates'
GEN_ALL = {
    'list': True, 'view': True, 'new': True, 'edit': True,
    'delete': True, 'api': True, 'test': True,
}


def _schema(owns_attachable: bool) -> dict:
    props = {
        'id': {'type': 'string', 'pattern': '^c[a-z0-9]{24,}$'},
        'name': {'type': 'string', 'minLength': 1},
    }
    if owns_attachable:
        props['attachable_id'] = {
            'type': 'string',
            'x-relationship': {'type': 'one-to-one_bridge', 'target': 'attachable', 'labelField': 'id'},
        }
    return {
        'definitions': {
            '__attachable': {
                'type': 'object',
                'required': ['id'],
                'properties': {'id': {'type': 'string', 'pattern': '^c[a-z0-9]{24,}$'}},
            },
            'attachable': {
                'x-generate': {k: False for k in GEN_ALL},
                'allOf': [{'$ref': '#/definitions/__attachable'}],
            },
            '__resource': {'type': 'object', 'required': ['id', 'name'], 'properties': props},
            'resource': {'x-generate': GEN_ALL, 'allOf': [{'$ref': '#/definitions/__resource'}]},
        }
    }


def _render(owns_attachable: bool) -> tuple[dict, str]:
    schema = _schema(owns_attachable)
    entity = {
        'parent': 'resource', 'model': 'resource', 'definition_key': 'resource',
        'children': [], 'generate_config': {**GEN_ALL, 'fields': None},
    }
    ctx = build_context(entity, schema)
    svc_ctx = {**ctx, **service_context(ctx, schema)}
    env = Environment(loader=FileSystemLoader(TEMPLATES_DIR), trim_blocks=True, lstrip_blocks=True)
    return svc_ctx, env.get_template('service.ts.jinja2').render(**svc_ctx)


def test_owner_delete_removes_attachments_in_tx_and_files_after_commit():
    ctx, rendered = _render(True)
    assert ctx['bridge_attachment_cleanup'] is True
    assert "import { deleteBridgeAttachments, removeStoredObjects } from '@/lib/attachment/owner_cleanup';" in ctx['utility_code']
    delete_fn = rendered[rendered.index('export async function deleteResource'):]
    tx_start = delete_fn.index('$transaction')
    rows_at = delete_fn.index('deleteBridgeAttachments(tx')
    bridge_at = delete_fn.index('tx.attachable.deleteMany')
    tx_end = delete_fn.index('removeStoredObjects(_removedAttachmentKeys)')
    # rows go before the bridge row (which would only unlink them); files go after the transaction
    assert tx_start < rows_at < bridge_at < tx_end
    assert delete_fn.index('const _removedAttachmentKeys') < tx_start


def test_owner_without_attachable_bridge_has_no_attachment_cleanup():
    ctx, rendered = _render(False)
    assert not ctx['bridge_attachment_cleanup']
    assert 'owner_cleanup' not in ctx['utility_code']
    assert '_removedAttachmentKeys' not in rendered
