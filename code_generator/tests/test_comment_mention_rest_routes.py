"""REST wrappers for comment writes and the @-mention user search.

  app/api/<entity>/[id]/comments/route.ts                  POST   add a comment
  app/api/<entity>/[id]/comments/[commentId]/route.ts      PATCH  edit, DELETE  delete
  app/api/mention/users/route.ts                           GET    candidate search

The comment routes are written for an entity with a comment thread and run the
Server Actions the edit form calls (add/update/delete<Entity>Comment) as the
authenticated caller; the search route runs searchMentionUserOptions the same
way. Uses the mention_gate fixture (a commentable entity with api: true) and the
decimal_gate fixture (no comments, no x-mention)."""
from pathlib import Path

import pytest

from build_context import _build_comment_actions, _build_comment_actions_bridge
from build_user_schema import build_user_schema
from generate import generate, _make_env, _render
from generators_openapi import assemble_openapi_document, build_entity_openapi

REPO_ROOT = Path(__file__).resolve().parents[2]
FIXTURES = REPO_ROOT / 'code_generator' / 'tests' / 'fixtures'


def _generate(tmp_path_factory, fixture: str) -> Path:
    fixture_dir = FIXTURES / fixture
    out = tmp_path_factory.mktemp(fixture)
    (out / 'prisma').mkdir()
    (out / 'prisma' / 'schema.prisma').write_text((fixture_dir / 'schema.prisma').read_text())
    intermediate = out / 'generated_json_schema.yaml'
    build_user_schema(fixture_dir / 'json_schema.yaml', fixture_dir / 'schema.prisma', intermediate)
    generate(str(intermediate), str(out))
    return out


@pytest.fixture(scope='module')
def mention(tmp_path_factory) -> Path:
    return _generate(tmp_path_factory, 'mention_gate')


@pytest.fixture(scope='module')
def plain(tmp_path_factory) -> Path:
    return _generate(tmp_path_factory, 'decimal_gate')


def _add_route(root: Path) -> str:
    return (root / 'app/api/mention_gate_item/[id]/comments/route.ts').read_text()


def _item_route(root: Path) -> str:
    return (root / 'app/api/mention_gate_item/[id]/comments/[commentId]/route.ts').read_text()


def test_comment_routes_written_for_an_entity_with_comments(mention):
    assert (mention / 'app/api/mention_gate_item/[id]/comments/route.ts').is_file()
    assert (mention / 'app/api/mention_gate_item/[id]/comments/[commentId]/route.ts').is_file()


def test_no_comment_or_mention_routes_without_comments_or_mentions(plain):
    assert not list((plain / 'app/api').glob('*/[[]id[]]/comments'))
    assert not (plain / 'app/api/mention').exists()


def test_add_route_runs_the_server_action_as_the_authenticated_caller(mention):
    route = _add_route(mention)
    assert "import { addMentionGateItemComment } from '@/lib/mention_gate_item/actions';" in route
    assert 'const { userId: actorId } = await authenticate(request);' in route
    assert 'resolveActorId' not in route
    assert 'withActor(actorId, () =>' in route
    assert 'addMentionGateItemComment(item.commentable_id, message)' in route
    assert 'status: 201' in route


def test_add_route_checks_access_to_the_parent_before_writing(mention):
    route = _add_route(mention)
    coarse = route.index("requireApiPermission(actorId, 'mention_gate_item', 'update')")
    read = route.index('getMentionGateItemDetail(id')
    resolved = route.index('resolvePermissions(basePerms, item, actorId)')
    write = route.index('withActor(')
    assert coarse < read < resolved < write
    assert "Access denied: mention_gate_item.update" in route
    assert "'Not found'" in route


def test_routes_hold_no_write_of_their_own(mention):
    for route in (_add_route(mention), _item_route(mention)):
        for write in ('.create(', '.update(', '.delete(', 'createComment', 'updateComment', 'deleteComment', 'notify('):
            assert write not in route


def test_routes_validate_the_message(mention):
    for route in (_add_route(mention), _item_route(mention)):
        assert 'message is required' in route
        assert 'message exceeds maximum length of' in route
        assert 'Request body must be JSON' in route
        assert "getRateLimiter().check('api:write', actorId)" in route


def test_item_route_scopes_the_comment_to_the_parent_and_keeps_the_author_rule(mention):
    route = _item_route(mention)
    assert 'comment.commentable_id !== item.commentable_id' in route
    assert "comment.creator_id !== actorId" in route
    assert "'Not authorized to edit this comment'" in route
    assert 'withActor(actorId, () => updateMentionGateItemComment(commentId, message))' in route
    # Delete leaves the author-or-delete-permission rule to the action.
    assert 'withActor(actorId, () => deleteMentionGateItemComment(commentId))' in route
    assert 'status: 204' in route


def test_mention_search_route_runs_the_picker_search_as_the_authenticated_caller(mention):
    route = (mention / 'app/api/mention/users/route.ts').read_text()
    assert "import { searchMentionUserOptions } from '@/lib/mention/search';" in route
    assert 'const { userId: actorId } = await authenticate(request);' in route
    assert 'resolveActorId' not in route
    assert 'withActor(actorId, () => searchMentionUserOptions(query))' in route
    assert 'prisma' not in route
    assert "getRateLimiter().check('api:read', actorId)" in route


def test_add_action_returns_the_new_comment_id(mention):
    actions = (mention / 'lib/mention_gate_item/actions.ts').read_text()
    assert 'Promise<{ id: string }>' in actions
    assert 'const created = await createComment(' in actions
    assert 'return { id: created.id };' in actions


def test_per_entity_comment_actions_return_the_new_comment_id():
    code = _build_comment_actions(
        [{'name': 'ticket_comment', 'property_name': 'comments'}], 'ticket', 'ticket', False,
    )
    assert 'Promise<{ id: string }>' in code
    assert 'const created = await prisma.ticket_comment.create(' in code
    assert 'return { id: created.id };' in code
    bridge = _build_comment_actions_bridge('ticket', 'ticket', False)
    assert 'return { id: created.id };' in bridge


def test_per_entity_comment_routes_use_the_child_table_and_parent_foreign_key():
    env = _make_env()
    ctx = {
        'parent': 'ticket', 'parent_pascal': 'Ticket', 'model': 'ticket',
        'has_commentable': False, 'comment_model': 'ticket_comment', 'comment_parent_fk': 'ticket_id',
        'should_filter_by_org': True, 'is_self_only': False,
    }
    add = _render(env, 'api_comments_route.ts.jinja2', ctx)
    assert 'addTicketComment(id, message)' in add
    assert 'getTicketDetail(id, actorId)' in add
    item = _render(env, 'api_comment_item_route.ts.jinja2', ctx)
    assert 'prisma.ticket_comment.findUnique' in item
    assert 'comment.ticket_id !== id' in item


def _openapi_ctx(**overrides) -> dict:
    ctx = {
        'parent': 'widget', 'parent_pascal': 'Widget',
        'model_def': {'properties': {'id': {'type': 'string'}}, 'required': ['id']},
        'filtered_props': {},
        'can_api': True, 'can_list': False, 'can_create': False, 'can_view': True, 'can_new': False,
        'can_edit': True, 'can_update': True, 'can_delete': False, 'can_export': False, 'import_eligible': False,
        'parent_rels': [], 'children_raw': [], 'is_approvable': False, 'approval_config': None,
        'write_locked_values': None, 'readonly_fields': [], 'readonly_fields_create_reject': [],
        'readonly_fields_api': [], 'reservation_config': None,
        'sort_filter_fields': [], 'sort_filter_field_kinds': {}, 'sort_filter_relation_fields': [],
        'comment_actions_code': 'export async function addWidgetComment() {}',
    }
    ctx.update(overrides)
    return ctx


def test_openapi_describes_the_comment_routes():
    paths = build_entity_openapi(_openapi_ctx())['paths']
    post = paths['/api/widget/{id}/comments']['post']
    assert post['requestBody']['content']['application/json']['schema']['required'] == ['message']
    assert set(post['responses']) >= {'201', '400', '401', '403', '404', '429'}
    item = paths['/api/widget/{id}/comments/{commentId}']
    assert set(item) == {'patch', 'delete'}
    assert '204' in item['delete']['responses']


def test_openapi_has_no_comment_routes_without_a_comment_thread():
    paths = build_entity_openapi(_openapi_ctx(comment_actions_code=''))['paths']
    assert not [p for p in paths if '/comments' in p]
    paths = build_entity_openapi(_openapi_ctx(can_view=False))['paths']
    assert not [p for p in paths if '/comments' in p]


def test_openapi_document_describes_the_mention_search_only_when_mentions_exist():
    assert '/api/mention/users' not in assemble_openapi_document([])['paths']
    document = assemble_openapi_document([], mention_search=True)
    get = document['paths']['/api/mention/users']['get']
    assert {p['name'] for p in get['parameters']} == {'q'}
    assert set(get['responses']) >= {'200', '400', '401', '429'}
    assert 'MentionUserOption' in document['components']['schemas']
    assert {'name': 'mention'} in document['tags']
