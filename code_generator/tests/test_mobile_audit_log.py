"""
Built-in audit log screens in the generated Expo app (templates/mobile/audit_log/).

Runs the real build_user_schema.py -> generate.py pipeline on tests/fixtures/mobile_entity_gate and
checks that:

- the read-only list and detail screens are generated and registered for `audit_log`, which is not a
  schema entity
- they talk to the existing REST routes only (GET /api/audit_log and /api/audit_log/<id>), send no
  write request, and carry no permission logic of their own: the server answers 403
- the navigation tree carries the audit log link whose href the permission route already filters
- the strings they read are bundled for every locale

Run:
    cd code_generator && python3 -m pytest tests/test_mobile_audit_log.py -v
"""
import json
from pathlib import Path
import shutil

import pytest

from build_user_schema import build_user_schema
from generate import generate

FIXTURE = Path(__file__).resolve().parent / 'fixtures' / 'mobile_entity_gate'
REPO = Path(__file__).resolve().parents[2]


@pytest.fixture(scope='module')
def out(tmp_path_factory):
    tmp_path = tmp_path_factory.mktemp('mobile_audit_log')
    prisma_dir = tmp_path / 'prisma'
    prisma_dir.mkdir(parents=True)
    shutil.copy(FIXTURE / 'schema.prisma', prisma_dir / 'schema.prisma')
    # The mobile message bundle is read from <out>/messages.
    shutil.copytree(REPO / 'messages', tmp_path / 'messages')
    intermediate = tmp_path / 'generated_json_schema.yaml'
    build_user_schema(FIXTURE / 'json_schema.yaml', FIXTURE / 'schema.prisma', intermediate)
    generate(str(intermediate), str(tmp_path))
    return tmp_path


def _read(out: Path, rel: str) -> str:
    return (out / 'mobile' / rel).read_text()


def test_audit_log_screens_are_generated_and_registered(out):
    for rel in (
        'lib/audit_log/mobile_client.ts',
        'components/audit_log/format.ts',
        'components/audit_log/List.tsx',
        'components/audit_log/View.tsx',
    ):
        assert (out / 'mobile' / rel).exists(), rel
    registry = _read(out, 'lib/entity-registry.ts')
    assert "audit_log: {" in registry
    assert 'List: AuditLogList' in registry
    assert 'View: AuditLogView' in registry
    assert 'Form: null' in registry


def test_audit_log_client_is_read_only_rest(out):
    client = _read(out, 'lib/audit_log/mobile_client.ts')
    assert '/api/audit_log?page=' in client
    assert '/api/audit_log/${id}' in client
    for verb in ("'POST'", "'PUT'", "'PATCH'", "'DELETE'"):
        assert verb not in client
    assert 'server action' not in client.lower()


def test_audit_log_screens_have_no_write_or_permission_logic(out):
    for rel in ('components/audit_log/List.tsx', 'components/audit_log/View.tsx'):
        source = _read(out, rel)
        assert 'list-new' not in source and 'view-edit' not in source and 'view-delete' not in source
        assert 'getModelPermissions' not in source
    # A refused list request is shown as the shared permission message.
    assert "Errors.permissionDenied" in _read(out, 'components/audit_log/List.tsx')


def test_navigation_tree_carries_the_audit_log_link(out):
    nav = _read(out, 'lib/nav.ts')
    assert '"href": "/audit_log"' in nav
    assert '"entity": "audit_log"' in nav


def test_audit_log_strings_are_bundled_for_every_locale(out):
    messages = _read(out, 'lib/messages.ts')
    start = messages.index('const MESSAGES')
    body = messages[messages.index('=', start) + 1:messages.index(';\n', start)]
    bundle = json.loads(body)
    assert set(bundle) >= {'en', 'ja'}
    for locale in ('en', 'ja'):
        assert bundle[locale]['EntityLabel']['auditLog']
        for key in ('action', 'actorUser', 'created_at', 'metadata', 'targetId', 'targetTable'):
            assert bundle[locale]['Fields'][key], (locale, key)
        for key in ('permissionDenied', 'unknown', 'notFound'):
            assert bundle[locale]['Errors'][key], (locale, key)
        for key in ('goBack', 'nextPage', 'previousPage'):
            assert bundle[locale]['Common'][key], (locale, key)
    # Only the keys the screens read are carried from the larger namespaces.
    assert set(bundle['en']['EntityLabel']) == {'auditLog'}
    assert set(bundle['en']['Fields']) == {'comments', 'action', 'actorUser', 'created_at', 'metadata', 'targetId', 'targetTable'}
