"""
The generated permission-checked write entry points, lib/<entity>/checked.ts (Issue #1257).

The checks themselves live in lib/_checked_write.ts and are unit-tested in lib/_checked_write.test.ts (permission
denied, another organization, x-filter-values, x-self-only). These tests pin the generated wiring: each checked
function runs its check before it calls the service function, the record is read within the actor's
organizations, the module is never a Server Action module, and generate.py writes it next to service.ts.
"""
import re
from pathlib import Path

import pytest
from jinja2 import Environment, FileSystemLoader

REPO_ROOT = Path(__file__).resolve().parents[2]
TEMPLATES_DIR = REPO_ROOT / 'code_generator' / 'templates'


def _render(**over) -> str:
    env = Environment(loader=FileSystemLoader(str(TEMPLATES_DIR)), trim_blocks=True, lstrip_blocks=True)
    ctx = {
        'parent': 'thing', 'parent_pascal': 'Thing', 'parent_camel': 'thing', 'model': 'thing',
        'can_create': True, 'can_update': True, 'can_delete': True,
        'should_filter_by_org': True, 'org_relationship_optional': False, 'is_self_only': False,
        'filter_values': {}, 'item_context_select': '{ id: true, creator_id: true }',
        'delete_reference_check': False, 'is_audited': False,
    }
    ctx.update(over)
    return env.get_template('checked_service.ts.jinja2').render(**ctx)


def _fn(out: str, name: str) -> str:
    return re.search(rf'export async function {name}\(.*?\n}}\n', out, re.S).group(0)


def test_not_a_server_action_module():
    out = _render()
    assert 'use server' not in out
    assert 'use server' not in (TEMPLATES_DIR / 'checked_service.ts.jinja2').read_text(encoding='utf-8')


def test_each_function_checks_before_it_writes():
    out = _render(is_audited=True, delete_reference_check=True)
    add = _fn(out, 'checkedAddThing')
    assert add.index("await assertCanCreate('thing', actorId);") < add.index('return addThing(actorId, ...args);')
    upd = _fn(out, 'checkedUpdateThing')
    assert upd.index("await assertCanWriteRecord(thingCheckedSpec, 'update', actorId, id);") < upd.index(
        'return updateThing(actorId, id, ...args);')
    dele = _fn(out, 'checkedDeleteThing')
    order = [dele.index(s) for s in (
        'await assertCanDeleteRecords(thingCheckedSpec, actorId, ids);',
        'await assertDeleteReferencesReachableThing(actorId, _ids);',
        'await deleteThing(actorId, _ids);',
    )]
    assert order == sorted(order)


def test_unaudited_delete_passes_only_the_ids():
    assert 'await deleteThing(_ids);' in _render(is_audited=False)


@pytest.mark.parametrize('optional, scope, where', [
    (False, 'required', 'where: { id, organization_id: { in: orgIds ?? [] } }'),
    (True, 'optional', 'where: { id, OR: [{ organization_id: { in: orgIds ?? [] } }, { organization_id: null }] }'),
])
def test_record_is_read_within_the_actors_organizations(optional, scope, where):
    out = _render(org_relationship_optional=optional)
    assert where in out
    assert f"orgScope: '{scope}'" in out


def test_entity_without_organization_scope():
    out = _render(should_filter_by_org=False)
    assert "orgScope: 'none'" in out
    assert 'findUnique({ where: { id }' in out


def test_self_only_and_filter_values_reach_the_spec():
    out = _render(is_self_only=True, filter_values={'status': ['open', 'draft']})
    assert 'selfOnly: true,' in out
    assert 'status: ["open", "draft"],' in out


def test_only_the_operations_the_entity_has_are_emitted():
    out = _render(can_create=False, can_delete=False)
    assert 'checkedAddThing' not in out and 'checkedDeleteThing' not in out
    assert 'checkedUpdateThing' in out
    assert 'assertCanCreate' not in out and 'assertCanDeleteRecords' not in out
    create_only = _render(can_update=False, can_delete=False)
    assert "import prisma from" not in create_only and 'CheckedRecordSpec' not in create_only


def test_generate_writes_checked_ts_next_to_service_ts():
    src = (REPO_ROOT / 'code_generator' / 'generate.py').read_text(encoding='utf-8')
    service = src.index("_write(lib_dir / 'service.ts', _render(env, 'service.ts.jinja2', svc_ctx))")
    checked = src.index("_write(lib_dir / 'checked.ts', _render(env, 'checked_service.ts.jinja2', svc_ctx))")
    assert 0 < checked - service < 300
