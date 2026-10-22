"""Comment write Server Actions run the parent entity's own access gates.

add / update / delete<Entity>Comment are callable endpoints independent of the UI, so each one
reads the parent record through the caller's organization scope (plus x-self-only and
x-filter-values when declared) and resolves the caller's permission on that row with
requirePermission(), the way upsert<Entity> does. Covers both comment shapes: the shared
commentable bridge and a per-entity comment child table."""
from pathlib import Path

import pytest

from build_context import _build_comment_actions, _build_comment_actions_bridge
from build_user_schema import build_user_schema
from generate import generate

REPO_ROOT = Path(__file__).resolve().parents[2]
FIXTURES = REPO_ROOT / 'code_generator' / 'tests' / 'fixtures'
SELECT = '{ id: true, creator_id: true, assignee_id: true }'
ORG = {'should_filter_by_org': True, 'org_relationship_optional': False}


def _fn(code: str, name: str) -> str:
    start = code.index(f'export async function {name}')
    nxt = code.find('export async function', start + 1)
    return code[start:] if nxt == -1 else code[start:nxt]


def _bridge(scope=None, mention=False) -> str:
    return _build_comment_actions_bridge('ticket', 'ticket', True, mention, SELECT, scope)


def _child(scope=None, mention=False) -> str:
    return _build_comment_actions([{'name': 'ticket_comment'}], 'ticket', 'ticket', True, mention, SELECT, scope)


SHAPES = {'bridge': _bridge, 'child': _child}


@pytest.mark.parametrize('shape', SHAPES)
def test_every_write_reads_the_parent_through_the_org_scope_and_checks_permission(shape):
    code = SHAPES[shape](ORG)
    for name in ('addTicketComment', 'updateTicketComment', 'deleteTicketComment'):
        body = _fn(code, name)
        assert 'getAssociatedOrganizations(userId)' in body, name
        assert 'organization_id: { in: _assocOrgIds }' in body, name
        assert "if (!parentRow) throw new AppError('NOT_FOUND', 'Not found');" in body, name
        assert "requirePermission('ticket', 'update', parentRow, userId)" in body, name


@pytest.mark.parametrize('shape', SHAPES)
def test_add_checks_before_it_writes_and_notifies_from_the_scoped_row(shape):
    body = _fn(SHAPES[shape](ORG), 'addTicketComment')
    check = body.index("requirePermission('ticket', 'update', parentRow, userId)")
    write = body.index('create')
    assert check < write
    assert 'parentRow.creator_id' in body and 'parentRow.assignee_id' in body


@pytest.mark.parametrize('shape', SHAPES)
def test_edit_keeps_the_author_rule_and_checks_the_parent_before_writing(shape):
    body = _fn(SHAPES[shape](ORG), 'updateTicketComment')
    assert "throw new Error('Not authorized to edit this comment')" in body
    assert body.index("requirePermission('ticket', 'update'") < body.index('update(' if shape == 'child' else 'updateComment(')


@pytest.mark.parametrize('shape', SHAPES)
def test_delete_by_a_non_author_still_needs_delete_permission_on_the_row(shape):
    body = _fn(SHAPES[shape](ORG), 'deleteTicketComment')
    assert "requirePermission('ticket', 'update', parentRow, userId)" in body
    assert "requirePermission('ticket', 'delete', parentRow, userId)" in body
    assert body.index("'update', parentRow") < body.index("'delete', parentRow")


@pytest.mark.parametrize('shape', SHAPES)
def test_an_entity_without_organization_scope_gets_the_permission_check_only(shape):
    code = SHAPES[shape]({})
    assert 'getAssociatedOrganizations' not in code
    assert 'organization_id' not in code
    assert "requirePermission('ticket', 'update', parentRow, userId)" in _fn(code, 'addTicketComment')


@pytest.mark.parametrize('shape', SHAPES)
def test_optional_organization_admits_organizationless_rows(shape):
    code = SHAPES[shape]({'should_filter_by_org': True, 'org_relationship_optional': True})
    assert 'OR: [{ organization_id: { in: _assocOrgIds } }, { organization_id: null }]' in code


@pytest.mark.parametrize('shape', SHAPES)
def test_self_only_and_filter_values_narrow_the_parent_read(shape):
    code = SHAPES[shape]({'is_self_only': True, 'filter_values': {'status': ['open', 'new']}})
    body = _fn(code, 'addTicketComment')
    assert 'creator_id: userId' in body
    assert 'status: { in: ["open", "new"] }' in body


@pytest.mark.parametrize('shape', SHAPES)
def test_mention_notifications_still_use_the_scoped_parent_row(shape):
    body = _fn(SHAPES[shape](ORG, mention=True), 'addTicketComment')
    assert 'extractMentionedUserIds(message)' in body
    assert '/ticket/view/${parentRow.id}' in body


@pytest.fixture(scope='module')
def mention(tmp_path_factory) -> Path:
    fixture_dir = FIXTURES / 'mention_gate'
    out = tmp_path_factory.mktemp('mention_gate_actions')
    (out / 'prisma').mkdir()
    (out / 'prisma' / 'schema.prisma').write_text((fixture_dir / 'schema.prisma').read_text())
    intermediate = out / 'generated_json_schema.yaml'
    build_user_schema(fixture_dir / 'json_schema.yaml', fixture_dir / 'schema.prisma', intermediate)
    generate(str(intermediate), str(out))
    return out


def test_generated_actions_file_imports_the_helpers_the_comment_checks_call(mention):
    actions = (mention / 'lib/mention_gate_item/actions.ts').read_text()
    assert "requirePermission('mention_gate_item', 'update', parentRow, userId)" in actions
    assert "import { getSessionUserIdOrThrow, requirePermission" in actions
    assert "from '@/lib/_errors'" in actions
    assert 'AppError' in actions.split("from '@/lib/_errors'")[0].splitlines()[-1]
