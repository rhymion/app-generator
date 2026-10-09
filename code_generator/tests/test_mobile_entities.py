"""
Native entity screens in the generated Expo app (mobile_entities.py + templates/mobile/).

Runs the real build_user_schema.py -> generate.py pipeline on tests/fixtures/mobile_entity_gate
and checks that:

- an entity gets the screens its own x-generate flags allow; a many-to-one foreign key, a one-to-one
  selector and a many-to-many declared with `x-outputType: list` are drawn as relation pickers, while an entity with a child grid,
  a bridge, a custom component or similar gets none
- the pickers read their candidates from the target's REST options route and filter nothing themselves
- the screens call the generated hooks the Web screens call, and carry no validation, submit or
  permission logic of their own
- the mobile hook copies are byte-identical to the Web ones (rendered from the same template)
- the mobile client mirrors the Web names and talks REST only
- the app's React version satisfies what the shared hooks need

Run:
    cd code_generator && python3 -m pytest tests/test_mobile_entities.py -v
"""
import json
from pathlib import Path
import re
import shutil

import pytest

from build_user_schema import build_user_schema
from generate import generate
from mobile_entities import build_mobile_entity_spec, mobile_ineligible_reason

FIXTURE = Path(__file__).resolve().parent / 'fixtures' / 'mobile_entity_gate'
REPO = Path(__file__).resolve().parents[2]


@pytest.fixture(scope='module')
def out(tmp_path_factory):
    tmp_path = tmp_path_factory.mktemp('mobile_entities')
    prisma_dir = tmp_path / 'prisma'
    prisma_dir.mkdir(parents=True)
    shutil.copy(FIXTURE / 'schema.prisma', prisma_dir / 'schema.prisma')
    intermediate = tmp_path / 'generated_json_schema.yaml'
    build_user_schema(FIXTURE / 'json_schema.yaml', FIXTURE / 'schema.prisma', intermediate)
    generate(str(intermediate), str(tmp_path))
    return tmp_path


def _read(out: Path, rel: str) -> str:
    return (out / 'mobile' / rel).read_text()


# --- which entities get screens -------------------------------------------------------------

def test_full_crud_entity_gets_every_screen(out):
    for rel in (
        'lib/mobile_note/mobile_client.ts',
        'lib/mobile_note/use_entity_form.ts',
        'lib/mobile_note/use_entity_capabilities.ts',
        'components/mobile_note/form_validation.ts',
        'components/mobile_note/List.tsx',
        'components/mobile_note/FormView.tsx',
        'components/mobile_note/FormUpsert.tsx',
    ):
        assert (out / 'mobile' / rel).exists(), rel


def test_list_and_view_entity_gets_no_form_and_no_form_hook(out):
    assert (out / 'mobile/components/mobile_log/List.tsx').exists()
    assert (out / 'mobile/components/mobile_log/FormView.tsx').exists()
    assert not (out / 'mobile/components/mobile_log/FormUpsert.tsx').exists()
    assert not (out / 'mobile/lib/mobile_log/use_entity_form.ts').exists()
    client = _read(out, 'lib/mobile_log/mobile_client.ts')
    assert 'upsertMobileLog' not in client
    assert 'removeMobileLog' not in client
    view = _read(out, 'components/mobile_log/FormView.tsx')
    assert 'view-edit' not in view
    assert 'view-delete' not in view


def test_registry_lists_exactly_the_eligible_entities(out):
    registry = _read(out, 'lib/entity-registry.ts')
    assert 'mobile_note: {' in registry
    assert 'mobile_log: {' in registry
    assert 'user: {' not in registry
    assert re.search(r'mobile_log: \{.*?Form: null', registry, re.S)


def _ctx(**overrides):
    base = {
        'can_api': True, 'can_list': True, 'field_categories': {'text': ['name']},
    }
    base.update(overrides)
    return base


def test_plain_context_is_eligible():
    assert mobile_ineligible_reason(_ctx()) is None


@pytest.mark.parametrize('key,value', [
    ('direct_attachment_rels', [{'prop_name': 'x'}]),
    ('children_raw', [{'name': 'child'}]),
    ('non_comment_ch', [{'name': 'child', 'property_name': 'kids', 'is_many_to_many': False}]),
    ('entity_view_components', [{'name': 'ApprovalSection'}]),
    ('has_attachable', True),
    ('is_payment', True),
    ('reservation_config', {'mode': 'count'}),
    ('state_machine_transitions', [{'field': 'status'}]),
    ('is_self_only', True),
])
def test_feature_beyond_plain_crud_is_ineligible(key, value):
    assert mobile_ineligible_reason(_ctx(**{key: value})) is not None


@pytest.mark.parametrize('category', ['custom_upsert', 'image', 'file_uri', 'entity_select'])
def test_field_without_a_native_widget_is_ineligible(category):
    ctx = _ctx(field_categories={'text': ['name'], category: ['x']})
    assert 'has a' in mobile_ineligible_reason(ctx)


def _m2m_child(**overrides):
    child = {
        'name': 'tag', 'property_name': 'tags', 'child_var': 'tags', 'output_type': 'list',
        'is_many_to_many': True, 'relationship': {'type': 'many-to-many', 'target': 'tag', 'label_field': 'name'},
    }
    child.update(overrides)
    return child


def test_foreign_key_selector_and_many_to_many_list_are_eligible():
    rel = {'prop_name': 'group_id', 'target': 'group'}
    child = _m2m_child()
    ctx = _ctx(parent_rels_raw=[rel], selector_oto_rels=[{'prop_name': 'profile_id', 'target': 'profile'}],
               children_raw=[child], non_comment_ch=[child])
    assert mobile_ineligible_reason(ctx) is None
    assert mobile_ineligible_reason(ctx, {'group', 'profile', 'tag'}) is None


@pytest.mark.parametrize('overrides', [{'output_type': None}, {'output_type': 'comments'}, {'is_many_to_many': False}])
def test_child_grid_is_ineligible_even_beside_a_picker(overrides):
    child = _m2m_child(**overrides)
    ctx = _ctx(children_raw=[child], non_comment_ch=[child])
    assert mobile_ineligible_reason(ctx) is not None


def test_relation_to_an_entity_without_rest_routes_is_ineligible():
    ctx = _ctx(parent_rels_raw=[{'prop_name': 'group_id', 'target': 'group'}])
    assert 'no REST routes' in mobile_ineligible_reason(ctx, {'other'})
    child = _m2m_child()
    ctx = _ctx(children_raw=[child], non_comment_ch=[child])
    assert 'no REST routes' in mobile_ineligible_reason(ctx, {'group'})


def test_entity_without_api_or_list_is_ineligible():
    assert mobile_ineligible_reason(_ctx(can_api=False)) is not None
    assert mobile_ineligible_reason(_ctx(can_list=False)) is not None


def test_spec_describes_every_kind_and_marks_required(out):
    client = _read(out, 'lib/mobile_note/mobile_client.ts')
    spec = json.loads(re.search(r'MOBILE_NOTE_FIELDS: FieldSpec\[\] = (\[.*?\n\]);', client, re.S).group(1))
    kinds = {f['key']: f['kind'] for f in spec}
    assert kinds == {
        'title': 'text', 'details': 'text', 'status': 'enum', 'priority': 'number',
        'amount': 'decimal', 'is_done': 'boolean', 'due_on': 'date',
    }
    required = {f['key'] for f in spec if f['required']}
    assert {'title', 'status', 'is_done'} <= required
    assert [f for f in spec if f['key'] == 'status'][0]['options'] == ['open', 'closed']
    assert 'MOBILE_NOTE_LIST_KEYS: string[] = ["title", "status", "priority"]' in client


# --- shared logic, not re-implemented -------------------------------------------------------

def test_mobile_hooks_are_the_web_hooks_byte_for_byte(out):
    for name in ('use_entity_form.ts', 'use_entity_capabilities.ts'):
        assert _read(out, f'lib/mobile_note/{name}') == (out / 'lib/mobile_note' / name).read_text()
    assert _read(out, 'components/mobile_note/form_validation.ts') == (out / 'components/mobile_note/form_validation.ts').read_text()


def test_form_screen_calls_the_shared_hooks(out):
    form = _read(out, 'components/mobile_note/FormUpsert.tsx')
    assert "from '@/lib/mobile_note/use_entity_form'" in form
    assert "from '@/lib/mobile_note/use_entity_capabilities'" in form
    assert "from '@/components/mobile_note/form_validation'" in form
    assert 'useEntityForm(' in form
    assert 'useEntityCapabilities(' in form
    assert 'validate(() => validateForm(' in form
    assert 'submit(formData' in form


def test_view_screen_takes_show_hide_from_the_shared_capabilities(out):
    view = _read(out, 'components/mobile_note/FormView.tsx')
    assert 'useEntityCapabilities(' in view
    assert 'canEdit ?' in view
    assert 'canDelete &&' in view


def test_screens_hold_no_validation_or_permission_rules_of_their_own(out):
    for rel in ('components/mobile_note/FormUpsert.tsx', 'components/mobile_note/FormView.tsx', 'components/mobile_note/List.tsx'):
        text = _read(out, rel)
        assert 'REQUIRED_FIELDS' not in text
        assert 'isMissingValue' not in text
        assert 'permissions.update' not in text and 'permissions.delete' not in text


def test_hooks_import_no_platform_module(out):
    forbidden = re.compile(r"from\s+['\"](next/|next-intl|@/i18n/|@mui/|react-dom)")
    for name in ('use_entity_form.ts', 'use_entity_capabilities.ts'):
        assert not forbidden.search(_read(out, f'lib/mobile_note/{name}'))


# --- transport ------------------------------------------------------------------------------

def test_client_mirrors_web_names_and_uses_rest_only(out):
    client = _read(out, 'lib/mobile_note/mobile_client.ts')
    for name in ('fetchMobileNotePage', 'getMobileNoteDetail', 'upsertMobileNote', 'removeMobileNote', 'getMobileNotePermissions'):
        assert f'export async function {name}' in client or f'export function {name}' in client
    assert "'use server'" not in client
    assert '/api/mobile_note' in client
    web_actions = (out / 'lib/mobile_note/actions.ts').read_text()
    assert 'export async function upsertMobileNote' in web_actions
    assert 'export async function removeMobileNote' in web_actions


def test_client_never_rejects_on_a_failed_save():
    http = (REPO / 'code_generator/templates/mobile/lib/entity-http.ts.jinja2').read_text()
    assert 'Never throws' in http
    assert "return { ok: false, errorCode: 'UNKNOWN' }" in http


def test_mobile_error_types_match_the_web_taxonomy(out):
    web = (REPO / 'lib/_errors.ts').read_text()
    mobile = _read(out, 'lib/_errors.ts')
    code_union = lambda text: re.findall(r"'([A-Z_]+)'", re.search(r'export type ErrorCode =(.*?);', text, re.S).group(1))
    assert code_union(web) == code_union(mobile)


def test_list_page_index_is_zero_based(out):
    list_screen = _read(out, 'components/mobile_note/List.tsx')
    assert 'useState(0)' in list_screen
    assert 'void load(0)' in list_screen


# --- platform version -----------------------------------------------------------------------

def test_app_runs_react_19_which_the_shared_form_hook_needs(out):
    package = json.loads(_read(out, 'package.json'))
    assert package['dependencies']['react'].startswith('19.')
    assert package['devDependencies']['@types/react'].lstrip('~^').startswith('19.')
    hook = _read(out, 'lib/mobile_note/use_entity_form.ts')
    assert 'startTransition(async' in hook


def test_expo_packages_share_one_sdk(out):
    deps = json.loads(_read(out, 'package.json'))['dependencies']
    sdk = deps['expo'].lstrip('~^').split('.')[0]
    for name, version in deps.items():
        if name.startswith('expo-') and name != 'expo-router':
            assert version.lstrip('~^').split('.')[0] == sdk, name
    assert deps['expo-router'].lstrip('~^').split('.')[0] == sdk


# --- relation pickers -----------------------------------------------------------------------

def _fields(out: Path, entity: str, const: str) -> list[dict]:
    client = _read(out, f'lib/{entity}/mobile_client.ts')
    return json.loads(re.search(rf'{const}_FIELDS: FieldSpec\[\] = (\[.*?\n\]);', client, re.S).group(1))


def test_relation_entity_gets_every_screen_and_is_registered(out):
    for rel in ('lib/mobile_task/mobile_client.ts', 'components/mobile_task/FormUpsert.tsx',
                'components/mobile_task/FormView.tsx', 'components/mobile_task/List.tsx'):
        assert (out / 'mobile' / rel).exists(), rel
    assert 'mobile_task: {' in _read(out, 'lib/entity-registry.ts')


def test_relation_fields_describe_target_label_and_request_key(out):
    by_key = {f['key']: f for f in _fields(out, 'mobile_task', 'MOBILE_TASK')}
    assert by_key['mobile_group_id']['kind'] == 'relation'
    assert by_key['mobile_group_id']['required'] is True
    assert by_key['mobile_group_id']['target'] == 'mobile_group'
    assert by_key['mobile_group_id']['labelField'] == 'name'
    assert by_key['mobile_group_id']['relationName'] == 'mobile_group'
    assert by_key['mobile_profile_id']['kind'] == 'relation'
    assert by_key['mobile_profile_id']['required'] is False
    assert by_key['mobile_profile_id']['relationName'] == 'mobile_profile'
    # the sibling field the label's autocomplete filter may narrow by
    assert by_key['mobile_label_id']['contextFields'] == ['mobile_group_id']
    assert by_key['mobile_label_id']['required'] is False
    assert by_key['mobile_group_id']['contextFields'] == []
    assert by_key['tags']['kind'] == 'relation_many'
    assert by_key['tags']['target'] == 'mobile_tag'
    # the key the generated REST routes read the selection from
    assert by_key['tags']['bodyKey'] == 'tags_ids'
    assert 'tags_ids' in (out / 'app/api/mobile_task/route.ts').read_text()
    assert 'mobile_group_id: mobileGroupId' in (out / 'app/api/mobile_task/route.ts').read_text()


def test_list_row_shows_scalar_columns_only(out):
    client = _read(out, 'lib/mobile_task/mobile_client.ts')
    assert 'MOBILE_TASK_LIST_KEYS: string[] = ["title"]' in client


def test_relation_screens_still_use_the_shared_hooks_and_validation(out):
    for name in ('use_entity_form.ts', 'use_entity_capabilities.ts'):
        assert _read(out, f'lib/mobile_task/{name}') == (out / 'lib/mobile_task' / name).read_text()
    # the required foreign key is checked by the same module the Web form uses
    validation = _read(out, 'components/mobile_task/form_validation.ts')
    assert validation == (out / 'components/mobile_task/form_validation.ts').read_text()
    assert "key: 'mobile_group_id'" in validation
    form = _read(out, 'components/mobile_task/FormUpsert.tsx')
    assert 'validate(() => validateForm(' in form
    assert 'useEntityForm(' in form and 'submit(formData' in form
    assert 'caller="mobile_task"' in form


def test_picker_reads_candidates_from_the_options_route_and_filters_nothing(out):
    picker = _read(out, 'components/native/RelationPicker.tsx')
    assert 'searchEntityOptions(' in picker
    assert '.filter(' not in picker.replace('selected.filter(', '').replace('current !== id', '')
    assert 'permissions' not in picker
    http = _read(out, 'lib/entity-http.ts')
    assert '/api/${entity}/options' in http
    assert 'err.status === 403' in http


def test_picker_is_disabled_without_read_on_the_target(out):
    picker = _read(out, 'components/native/RelationPicker.tsx')
    assert 'picker-denied-' in picker
    assert 'fkPermissionDenied' in picker


def test_many_to_many_is_sent_as_one_entry_per_id_and_clears_when_empty(out):
    http = _read(out, 'lib/entity-http.ts')
    assert "formData.getAll(key).map(String)" in http
    form = _read(out, 'components/mobile_task/FormUpsert.tsx')
    assert 'formData.append(spec.key, id)' in form
    view = _read(out, 'components/native/FieldInput.tsx')
    assert 'toRecordDisplayText' in view


def test_picker_strings_exist_in_both_locales():
    for locale in ('en', 'ja'):
        common = json.loads((REPO / 'messages' / f'{locale}.json').read_text(encoding='utf-8'))['Common']
        for key in ('select', 'clear', 'done', 'search', 'noOptions'):
            assert common.get(key), (locale, key)


# --- list: sort, filter, search, bulk delete -----------------------------------------------

def test_list_sort_filter_and_search_use_the_rest_list_parameters(out):
    http = _read(out, 'lib/entity-http.ts')
    assert "sort=${opts.sort.map" in http and ':${item.dir}' in http
    assert 'f.${encodeURIComponent(field)}' in http
    client = _read(out, 'lib/mobile_note/mobile_client.ts')
    assert "MOBILE_NOTE_SORT_KEYS: string[] = " in client
    assert 'MOBILE_NOTE_SEARCH_KEY: string | null = "title"' in client
    keys = json.loads(re.search(r'MOBILE_NOTE_FILTER_KEYS: string\[\] = (\[.*?\]);', client, re.S).group(1))
    assert 'status' in keys and 'is_done' in keys and 'due_on' not in keys
    lst = _read(out, 'components/mobile_note/List.tsx')
    for test_id in ('list-search', 'list-sort-toggle', 'list-filter-toggle', 'list-filter-clear'):
        assert test_id in lst
    assert 'fetchMobileNotePage({ page: target, pageSize: PAGE_SIZE, ...queryOf() })' in lst


def test_bulk_delete_goes_through_the_bulk_route_and_shared_capabilities(out):
    http = _read(out, 'lib/entity-http.ts')
    assert "`/api/${entity}/bulk`" in http and "method: 'DELETE'" in http
    lst = _read(out, 'components/mobile_note/List.tsx')
    assert 'bulkRemoveMobileNote' in lst and 'useEntityCapabilities' in lst
    assert 'getEntityFormErrorMessage' in lst  # the single delete's error mapping
    log = _read(out, 'components/mobile_log/List.tsx')
    assert 'bulkRemove' not in log and 'list-bulk-delete' not in log  # list-and-view entity: no delete


def test_list_strings_exist_in_both_locales():
    for locale in ('en', 'ja'):
        common = json.loads((REPO / 'messages' / f'{locale}.json').read_text())['Common']
        for key in ('sort', 'filter', 'selectedCount', 'search', 'clear', 'deleteMessage'):
            assert key in common, (locale, key)


# --- comment thread and reactions ------------------------------------------------------------

def _commentable_ctx(**overrides):
    ctx = _ctx(has_commentable=True, can_view=True, commentable_rel_name='commentable',
               one_to_one_rels=[{'prop_name': 'commentable_id', 'target': 'commentable', 'relation_name': 'commentable'}],
               named_constants=[{'const_name': 'COMMENT_REACTION_TYPES', 'items': [{'value': 'like'}, {'value': 'love'}]}])
    ctx.update(overrides)
    return ctx


def test_commentable_entity_is_eligible_through_its_comment_bridge():
    assert mobile_ineligible_reason(_commentable_ctx()) is None


def test_other_one_to_one_bridge_beside_the_comments_is_ineligible():
    other = {'prop_name': 'x_id', 'target': 'other', 'relation_name': 'x'}
    ctx = _commentable_ctx(one_to_one_rels=_commentable_ctx()['one_to_one_rels'] + [other])
    assert mobile_ineligible_reason(ctx) == 'declares one_to_one_rels'


def test_a_bridge_to_commentable_without_the_comment_feature_stays_ineligible():
    assert mobile_ineligible_reason(_commentable_ctx(has_commentable=False)) == 'declares one_to_one_rels'


def test_comment_thread_spec_carries_the_embed_key_and_reaction_values():
    from mobile_entities import comment_thread_spec
    assert comment_thread_spec(_commentable_ctx()) == {'rel_name': 'commentable', 'reaction_types': ['like', 'love']}
    assert comment_thread_spec(_commentable_ctx(can_view=False)) is None
    assert comment_thread_spec(_ctx()) is None


def test_detail_screen_draws_the_thread_and_reaction_bar_through_the_rest_seam(out):
    view = _read(out, 'components/mobile_thread/FormView.tsx')
    assert "import { CommentThread" in view
    assert 'REACTION_TYPES: string[] = ["like", "love", "laugh", "surprised", "sad"]' in view
    assert 'record["commentable"]' in view
    thread = _read(out, 'components/native/CommentThread.tsx')
    assert "fetchCommentReactions, toggleCommentReaction" in thread
    assert 'testID={`reaction-${comment.id}-${type}`}' in thread
    http = _read(out, 'lib/comment-http.ts')
    assert '/api/comment/${encodeURIComponent(commentId)}/reactions/toggle' in http
    assert "method: 'POST'" in http
    # No composer, edit or delete control: the comment routes for them do not exist.
    for forbidden in ('TextInput', 'addComment', 'updateComment', 'deleteComment', 'prisma'):
        assert forbidden not in thread + http


def test_entities_without_comments_get_no_thread(out):
    assert 'CommentThread' not in _read(out, 'components/mobile_note/FormView.tsx')


def test_reaction_labels_and_thread_heading_reach_the_message_bundle():
    from generate import _mobile_messages_json
    en = json.loads((REPO / 'messages' / 'en.json').read_text(encoding='utf-8'))
    bundle = json.loads(_mobile_messages_json({'en': en}))['en']
    assert bundle['ReactionType'] == en['ReactionType']
    # Only the thread heading of the (large) Fields namespace is shipped.
    assert bundle['Fields'] == {'comments': en['Fields']['comments']}
