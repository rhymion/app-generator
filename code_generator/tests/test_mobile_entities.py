"""
Native entity screens in the generated Expo app (mobile_entities.py + templates/mobile/).

Runs the real build_user_schema.py -> generate.py pipeline on tests/fixtures/mobile_entity_gate
and checks that:

- an entity gets the screens its own x-generate flags allow; a many-to-one foreign key, a one-to-one
  selector and a many-to-many declared with `x-outputType: list` are drawn as relation pickers, while an entity with a child grid,
  a bridge, a custom component or similar gets none
- a direct attachment field is drawn as a file input that uploads through the REST routes and submits the
  attachment row's id; the upload route accepts a mobile access token as well as the browser session
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
from mobile_entities import (
    build_mobile_entity_spec, group_ineligible_by_reason, ineligible_log_lines, ineligible_note,
    _relation_many_entry, mobile_ineligible_reason,
)

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


def test_reservation_entity_is_eligible():
    assert mobile_ineligible_reason(_ctx(reservation_config={'mode': 'count'})) is None
    assert mobile_ineligible_reason(_ctx(reservation_config={'mode': 'item'})) is None


def test_plain_context_is_eligible():
    assert mobile_ineligible_reason(_ctx()) is None


@pytest.mark.parametrize('key,value', [
    ('children_raw', [{'name': 'child'}]),
    ('non_comment_ch', [{'name': 'child', 'property_name': 'kids', 'is_many_to_many': False}]),
    ('entity_view_components', [{'name': 'ApprovalSection'}]),
    ('has_attachable', True),
    ('state_machine_transitions', [{'field': 'status'}]),
    ('is_self_only', True),
])
def test_feature_beyond_plain_crud_is_ineligible(key, value):
    assert mobile_ineligible_reason(_ctx(**{key: value})) is not None


@pytest.mark.parametrize('category', ['image', 'file_uri'])
def test_url_field_with_an_upload_kind_is_eligible_and_drawn_as_plain_text(category):
    # A URL column takes a pasted URL only: no upload path, so the entity keeps its native screens.
    ctx = _ctx(field_categories={'text': ['name'], category: ['photo']})
    assert mobile_ineligible_reason(ctx) is None
    ctx.update(
        filtered_props={'name': {'type': 'string'}, 'photo': {'type': 'string', 'format': 'uri'}},
        model_def={}, readonly_fields=[], parent='asset', parent_pascal='Asset',
    )
    spec = build_mobile_entity_spec(ctx, {'client_required_fields': []}, str.title)
    kinds = {f['key']: f['kind'] for f in spec['fields']}
    assert kinds['photo'] == 'text'


def test_entity_select_field_is_eligible_and_drawn_as_labelled_enum_chips():
    ctx = _ctx(
        field_categories={'text': ['name'], 'entity_select': ['entity_name']},
        entity_select_options=[
            {'value': 'purchase_order', 'label': 'Purchase Order', 'key': 'purchaseOrder'},
            {'value': 'user', 'label': 'User', 'key': 'user'},
        ],
    )
    assert mobile_ineligible_reason(ctx) is None
    ctx.update(
        filtered_props={'name': {'type': 'string'}, 'entity_name': {'type': 'string', 'x-entity-select': True}},
        model_def={}, readonly_fields=[], parent='rule', parent_pascal='Rule',
    )
    spec = build_mobile_entity_spec(ctx, {'client_required_fields': [{'key': 'entity_name'}]}, str.title)
    field = [f for f in spec['fields'] if f['key'] == 'entity_name'][0]
    assert field['kind'] == 'enum'
    assert field['required'] is True
    assert field['options'] == ['purchase_order', 'user']
    assert field['option_labels'] == ['Purchase Order', 'User']
    assert field['option_label_keys'] == ['EntityLabel.purchaseOrder', 'EntityLabel.user']
    assert field['numeric_enum'] is False
    assert 'entity_name' in spec['filter_keys']


def test_entity_select_spec_reaches_the_generated_client(out):
    client = _read(out, 'lib/mobile_rule/mobile_client.ts')
    spec = json.loads(re.search(r'MOBILE_RULE_FIELDS: FieldSpec\[\] = (\[.*?\n\]);', client, re.S).group(1))
    field = [f for f in spec if f['key'] == 'entity_name'][0]
    assert field['kind'] == 'enum'
    assert 'mobile_note' in field['options']
    labels = dict(zip(field['options'], field['optionLabels']))
    assert labels['mobile_note'] == 'Mobile Note'
    keys = dict(zip(field['options'], field['optionLabelKeys']))
    assert keys['mobile_note'] == 'EntityLabel.mobileNote'
    assert 'mobile_rule: {' in _read(out, 'lib/entity-registry.ts')


def test_entity_label_words_of_the_offered_entities_ship_with_the_app():
    from generate import _mobile_messages_json
    en = {'EntityLabel': {'auditLog': 'Audit Log', 'purchaseOrder': 'Purchase Order', 'user': 'User', 'other': 'Other'}}
    ja = {'EntityLabel': {'auditLog': '監査ログ', 'purchaseOrder': '発注', 'user': 'ユーザー', 'other': 'その他'}}
    shipped = json.loads(_mobile_messages_json({'en': en, 'ja': ja}, ('purchaseOrder', 'user')))
    assert shipped['en']['EntityLabel'] == {'auditLog': 'Audit Log', 'purchaseOrder': 'Purchase Order', 'user': 'User'}
    assert shipped['ja']['EntityLabel']['purchaseOrder'] == '発注'
    # Without an entity-name field only the single built-in key ships, as before.
    assert json.loads(_mobile_messages_json({'en': en}))['en']['EntityLabel'] == {'auditLog': 'Audit Log'}


def test_entity_name_chips_and_texts_read_the_dictionary_not_the_english_title(out):
    field_input = _read(out, 'components/native/FieldInput.tsx')
    assert 'spec.optionLabelKeys?.[index]' in field_input
    assert '{optionText(spec, option, t)}' in field_input
    assert 'toDisplayText(spec, item[key], t)' in _read(out, 'components/mobile_rule/List.tsx')
    assert '<RelationValue spec={spec} record={record} translate={t}' in _read(out, 'components/mobile_rule/FormView.tsx')


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


def _list_child(**overrides):
    """A one-to-many list child (`procedure.children`): no `x-relationship`, attached through a nullable FK."""
    child = {
        'name': 'step', 'property_name': 'children', 'child_var': 'children', 'output_type': 'list',
        'is_many_to_many': False, 'use_connect': True, 'attach_fk': 'parent_id',
    }
    child.update(overrides)
    return child


def _row_child(**overrides):
    child = {
        'name': 'line', 'property_name': 'lines', 'child_var': 'lines', 'output_type': None,
        'is_many_to_many': False, 'is_independent': False, 'nested_writable': True, 'relationship': None,
        'props_no_id': ['description', 'quantity', 'group_id'],
        'child_prop_defs': {
            'description': {'type': 'string'},
            'quantity': {'type': 'integer', 'minimum': 1},
            'group_id': {'type': 'string', 'x-relationship': {'type': 'many-to-one', 'target': 'group', 'labelField': 'name'}},
        },
        'readonly_field_names': set(),
    }
    child.update(overrides)
    return child


def test_one_to_many_list_child_attached_through_a_nullable_fk_is_eligible():
    child = _list_child()
    ctx = _ctx(parent='step', children_raw=[child], non_comment_ch=[child])
    assert mobile_ineligible_reason(ctx) is None
    assert mobile_ineligible_reason(ctx, {'step'}) is None
    # The offered records are the child's own entity, so it needs REST routes.
    assert 'step, which has no REST routes' in mobile_ineligible_reason(ctx, {'other'})


@pytest.mark.parametrize('overrides', [{'attach_fk': None}, {'output_type': None}, {'output_type': 'comments'}])
def test_one_to_many_child_that_is_not_an_attachable_list_stays_ineligible(overrides):
    child = _list_child(**overrides)
    ctx = _ctx(parent='step', children_raw=[child], non_comment_ch=[child])
    assert mobile_ineligible_reason(ctx) == 'declares children_raw'


def test_list_child_picker_of_its_own_kind_sends_the_record_id_to_the_options_route():
    entry = _relation_many_entry(_list_child(), set(), lambda n: n, 'step')
    assert (entry['target'], entry['body_key'], entry['context_fields']) == ('step', 'children_ids', ['id'])
    other = _relation_many_entry(_list_child(name='item'), set(), lambda n: n, 'order')
    assert (other['target'], other['context_fields']) == ('item', [])
    m2m = _relation_many_entry(_m2m_child(child_var='tags'), set(), lambda n: n, 'task')
    assert m2m['context_fields'] == []


def test_editable_child_rows_are_eligible_beside_a_picker():
    rows, picker = _row_child(), _m2m_child()
    ctx = _ctx(children_raw=[rows, picker], non_comment_ch=[rows, picker])
    assert mobile_ineligible_reason(ctx) is None
    assert mobile_ineligible_reason(ctx, {'group', 'tag'}) is None


@pytest.mark.parametrize('overrides', [
    {'is_independent': True}, {'nested_writable': False}, {'output_type': 'list'}, {'output_type': 'comments'},
])
def test_a_child_the_parent_cannot_save_stays_ineligible(overrides):
    child = _row_child(**overrides)
    assert mobile_ineligible_reason(_ctx(children_raw=[child], non_comment_ch=[child])) == 'declares children_raw'


def test_a_row_field_without_a_native_control_names_the_child_and_the_field():
    child = _row_child(
        props_no_id=['description', 'photo'],
        child_prop_defs={'description': {'type': 'string'}, 'photo': {'type': 'integer', 'x-relationship': {'type': 'one-to-many', 'target': 'asset'}}},
    )
    reason = mobile_ineligible_reason(_ctx(children_raw=[child], non_comment_ch=[child]))
    assert reason is not None and 'lines' in reason and 'photo' in reason


def test_a_row_url_field_with_an_upload_kind_is_a_plain_text_cell():
    child = _row_child(
        props_no_id=['description', 'photo'],
        child_prop_defs={'description': {'type': 'string'}, 'photo': {'type': 'string', 'format': 'uri', 'x-uri-kind': 'image'}},
    )
    assert mobile_ineligible_reason(_ctx(children_raw=[child], non_comment_ch=[child])) is None


def test_a_row_relation_to_an_entity_without_rest_routes_is_ineligible():
    child = _row_child()
    ctx = _ctx(children_raw=[child], non_comment_ch=[child])
    assert 'no REST routes' in mobile_ineligible_reason(ctx, {'other'})


def test_readonly_and_bridge_columns_are_not_drawn_in_a_row():
    child = _row_child(
        props_no_id=['description', 'note', 'inventory_transactionable_id'],
        child_prop_defs={
            'description': {'type': 'string'}, 'note': {'type': 'string', 'x-readonly': True},
            'inventory_transactionable_id': {'type': 'string'},
        },
        readonly_field_names={'note'},
    )
    ctx = _ctx(children_raw=[child], non_comment_ch=[child])
    assert mobile_ineligible_reason(ctx) is None


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
    # Candidates are never gated here; only the "Create new" control reads the server's create flag.
    assert 'permissions.view' not in picker and 'permissions.read' not in picker
    assert 'permissions.create' in picker
    http = _read(out, 'lib/entity-http.ts')
    assert '/api/${entity}/options' in http
    assert 'err.status === 403' in http


def test_edit_form_hands_the_record_id_to_its_pickers(out):
    assert 'formValues={id ? { ...values, id } : values}' in _read(out, 'components/mobile_task/FormUpsert.tsx')


def test_one_to_many_list_entity_gets_screens_and_a_picker_field(out):
    assert 'mobile_step' in _read(out, 'lib/entity-registry.ts')
    fields = _fields(out, 'mobile_step', 'MOBILE_STEP')
    children = next(f for f in fields if f['key'] == 'children')
    assert children['kind'] == 'relation_many'
    assert (children['target'], children['bodyKey'], children['relationName']) == ('mobile_step', 'children_ids', 'children')
    assert children['contextFields'] == ['id']
    parent = next(f for f in fields if f['key'] == 'parent_id')
    assert parent['kind'] == 'relation' and parent['contextFields'] == []
    tags = next(f for f in _fields(out, 'mobile_task', 'MOBILE_TASK') if f['key'] == 'tags')
    assert tags['contextFields'] == []


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


# --- create the referenced record in place (x-create-inline) --------------------------------

def test_inline_create_target_is_no_longer_ineligible():
    assert mobile_ineligible_reason(_ctx(is_inline_create_target=True)) is None
    assert mobile_ineligible_reason(_ctx(is_payment=True)) is None


def test_field_declares_create_inline_and_target_form_is_wired(out):
    by_key = {f['key']: f for f in _fields(out, 'mobile_ticket', 'MOBILE_TICKET')}
    assert by_key['mobile_category_id']['createInline'] is True
    # a plain foreign key declares nothing
    assert 'createInline' not in {f['key']: f for f in _fields(out, 'mobile_task', 'MOBILE_TASK')}['mobile_group_id']
    form = _read(out, 'components/mobile_ticket/FormUpsert.tsx')
    assert "import { MobileCategoryFormUpsert } from '@/components/mobile_category/FormUpsert'" in form
    assert 'mobile_category_id: MobileCategoryFormUpsert' in form
    assert 'createForm={CREATE_FORMS[spec.key]}' in form
    # a form with no create-inline field imports no other entity's form
    assert 'CREATE_FORMS' not in _read(out, 'components/mobile_task/FormUpsert.tsx')


def test_target_form_can_be_hosted_without_navigating(out):
    form = _read(out, 'components/mobile_category/FormUpsert.tsx')
    assert 'onCreated, onCancel' in form
    assert 'if (onCreated) {' in form
    assert 'onCancel ? onCancel()' in form


def test_picker_creates_through_the_target_form_and_selects_the_new_record(out):
    picker = _read(out, 'components/native/RelationPicker.tsx')
    assert 'createForm: CreateForm' in picker
    assert 'fetchPermissions(target)' in picker
    assert 'picker-create-${spec.key}' in picker
    assert 'onChange(id)' in picker
    # the save goes through the target's own form (shared hook and REST create), not the picker
    assert 'upsert' not in picker


# --- payment checkout (x-payment) -------------------------------------------------------------

def test_payment_entity_gets_screens_and_reads_the_create_response(out):
    client = _read(out, 'lib/mobile_order/mobile_client.ts')
    assert 'export type CheckoutCreated = ActionCreated & { checkoutUrl?: string }' in client
    assert 'created.record.id' in client and 'checkoutUrl: created.checkoutUrl' in client
    # an entity without x-payment keeps the bare record
    plain = _read(out, 'lib/mobile_note/mobile_client.ts')
    assert 'CheckoutCreated' not in plain and 'created.record' not in plain


def test_payment_form_opens_the_checkout_url_in_the_in_app_browser(out):
    form = _read(out, 'components/mobile_order/FormUpsert.tsx')
    assert "from '@/lib/checkout'" in form
    assert 'isCheckoutUrl(result.checkoutUrl)' in form
    assert 'await openCheckout(url)' in form
    assert "payment=returned" in form
    assert 'checkout' not in _read(out, 'components/mobile_note/FormUpsert.tsx').lower()
    helper = _read(out, 'lib/checkout.ts')
    assert "from 'expo-web-browser'" in helper
    assert 'openBrowserAsync(url)' in helper
    assert 'payment=returned' not in helper


def test_payment_dependency_and_helper_exist_only_with_a_payment_entity(out):
    assert json.loads(_read(out, 'package.json'))['dependencies']['expo-web-browser'].startswith('~58.')
    view = _read(out, 'components/mobile_order/FormView.tsx')
    assert 'view-payment-returned' in view
    assert 'view-payment-returned' not in _read(out, 'components/mobile_note/FormView.tsx')

# --- list: sort, filter, search, bulk delete -----------------------------------------------

def test_list_sort_filter_and_search_use_the_rest_list_parameters(out):
    http = _read(out, 'lib/entity-http.ts')
    assert "sort=${opts.sort.map" in http and ':${item.dir}' in http
    assert 'f.${encodeURIComponent(field)}' in http
    client = _read(out, 'lib/mobile_note/mobile_client.ts')
    assert "MOBILE_NOTE_SORT_KEYS: string[] = " in client
    assert 'MOBILE_NOTE_SEARCH_KEYS: string[] = ["title"]' in client
    assert 'search=${encodeURIComponent(opts.search)}' in http
    keys = json.loads(re.search(r'MOBILE_NOTE_FILTER_KEYS: string\[\] = (\[.*?\]);', client, re.S).group(1))
    assert 'status' in keys and 'is_done' in keys and 'due_on' not in keys
    lst = _read(out, 'components/mobile_note/List.tsx')
    for test_id in ('list-search', 'list-sort-toggle', 'list-filter-toggle', 'list-filter-clear'):
        assert test_id in lst
    assert 'fetchMobileNotePage({ page: target, pageSize: PAGE_SIZE, ...queryOf() })' in lst


def test_list_sorts_and_filters_by_a_relation_display_column_like_the_web_list(out):
    # mobile_task shows its mobile_group foreign key in x-display.table, so the REST list's
    # relation display column `mobile_group` (sorted and filtered by the group's name) is offered.
    getters = (out / 'lib' / 'mobile_task' / 'getters.ts').read_text()
    assert "RELATION_FILTER_FIELDS: RelationFilterMap = { 'mobile_group': { field: 'name' } }" in getters
    client = _read(out, 'lib/mobile_task/mobile_client.ts')
    sort_keys = json.loads(re.search(r'MOBILE_TASK_SORT_KEYS: string\[\] = (\[.*?\]);', client, re.S).group(1))
    filter_keys = json.loads(re.search(r'MOBILE_TASK_FILTER_KEYS: string\[\] = (\[.*?\]);', client, re.S).group(1))
    assert 'mobile_group' in sort_keys and 'mobile_group' in filter_keys
    assert 'mobile_group_id' not in sort_keys and 'mobile_group_id' not in filter_keys  # the id is not the column
    assert 'MOBILE_TASK_QUERY_FIELDS: FieldSpec[] = [...MOBILE_TASK_FIELDS' in client
    assert '"key": "mobile_group",' in client.split('MOBILE_TASK_QUERY_FIELDS')[1]
    lst = _read(out, 'components/mobile_task/List.tsx')
    assert 'fields: MOBILE_TASK_QUERY_FIELDS' in lst
    # The form still draws only the entity's own fields.
    assert 'MOBILE_TASK_QUERY_FIELDS' not in _read(out, 'components/mobile_task/FormUpsert.tsx')


def test_a_relation_column_outside_the_list_table_is_not_offered(out):
    # mobile_note has no foreign key; mobile_group has none either: no relation column appears.
    client = _read(out, 'lib/mobile_note/mobile_client.ts')
    assert 'MOBILE_NOTE_QUERY_FIELDS: FieldSpec[] = [...MOBILE_NOTE_FIELDS, ...([] as FieldSpec[])]' in client


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


# --- polymorphic attachable bridge ---------------------------------------------------------

def _attachable_ctx(**overrides):
    section = {'name': 'AttachmentSection', 'props': {}}
    ctx = _ctx(has_attachable=True, can_view=True, can_update=True, attachable_rel_name='attachable',
               attachable_attachments_prop='attachments',
               one_to_one_rels=[{'prop_name': 'attachable_id', 'target': 'attachable', 'relation_name': 'attachable'}],
               entity_view_components=[section], entity_edit_components=[section])
    ctx.update(overrides)
    return ctx


def test_entity_owning_attachments_through_the_attachable_bridge_is_eligible():
    assert mobile_ineligible_reason(_attachable_ctx()) is None


def test_attachable_bridge_without_the_attachment_section_stays_ineligible():
    # The Web shows no attachments without the component, so the placeholder is kept.
    ctx = _attachable_ctx(entity_view_components=[], entity_edit_components=[])
    assert mobile_ineligible_reason(ctx) == 'declares one_to_one_rels'


def test_other_components_beside_the_attachment_section_are_extension_points():
    ctx = _attachable_ctx(entity_view_components=[{'name': 'AttachmentSection'}, {'name': 'SomethingElse'}])
    assert mobile_ineligible_reason(ctx) is None


def test_attachment_section_without_its_bridge_stays_ineligible():
    # A built-in section the screens cannot serve is not an extension point: the Web would show attachments.
    ctx = _ctx(can_view=True, entity_view_components=[{'name': 'AttachmentSection'}])
    assert mobile_ineligible_reason(ctx) == 'declares entity_view_components'


def test_other_one_to_one_bridge_beside_the_attachable_bridge_is_ineligible():
    other = {'prop_name': 'x_id', 'target': 'other', 'relation_name': 'x'}
    ctx = _attachable_ctx(one_to_one_rels=_attachable_ctx()['one_to_one_rels'] + [other])
    assert mobile_ineligible_reason(ctx) == 'declares one_to_one_rels'


def test_attachment_section_component_without_the_bridge_is_ineligible():
    ctx = _attachable_ctx(has_attachable=False, one_to_one_rels=[])
    assert mobile_ineligible_reason(ctx) == 'declares entity_view_components'


def test_attachment_section_spec_follows_the_component_props():
    from mobile_entities import attachment_section_spec
    assert attachment_section_spec(_attachable_ctx()) == {
        'rel_name': 'attachable', 'prop': 'attachments', 'show_images': True, 'show_files': True,
        'types': ['image', 'file'], 'can_edit': True,
    }
    files_only = {'name': 'AttachmentSection', 'props': {'showImages': False}}
    spec = attachment_section_spec(_attachable_ctx(entity_view_components=[files_only], entity_edit_components=[files_only]))
    assert spec['types'] == ['file'] and spec['show_images'] is False
    none = {'name': 'AttachmentSection', 'props': {'showImages': False, 'showFiles': False}}
    assert attachment_section_spec(_attachable_ctx(entity_edit_components=[none]))['types'] == []
    assert attachment_section_spec(_attachable_ctx(can_update=False))['can_edit'] is False
    assert attachment_section_spec(_attachable_ctx(can_view=False)) is None
    assert attachment_section_spec(_ctx()) is None


def test_detail_screen_lists_the_attachments_read_from_the_rest_detail(out):
    view = _read(out, 'components/mobile_asset/FormView.tsx')
    assert "import { AttachmentList } from '@/components/native/AttachmentList'" in view
    assert 'record["attachable"]' in view
    assert 'ATTACHMENT_TYPES: string[] = ["image", "file"]' in view
    # Read-only on the detail screen: no change handler.
    assert 'onChange=' not in view[view.index('<AttachmentList'):view.index('/>', view.index('<AttachmentList'))]


def test_edit_form_saves_the_attachments_after_the_record_through_the_attachments_route(out):
    form = _read(out, 'components/mobile_asset/FormUpsert.tsx')
    assert "setBridgeAttachments('mobile_asset', id, type" in form
    assert 'attachmentsChanged(savedBridge, bridgeItems, type)' in form
    # Only on edit: attachments can be added once the owner exists, as on the Web.
    assert '{isEdit ? <AttachmentList' in form
    # The owner is saved first (inside the submit success callback); a refusal stays on the section.
    assert form.index('submit(formData, async (savedId)') < form.index('setBridgeAttachments(')
    assert 'setBridgeError(' in form
    http = _read(out, 'lib/attachment-http.ts')
    assert '/api/${encodeURIComponent(entity)}/${encodeURIComponent(recordId)}/attachments' in http
    assert "method: 'PUT'" in http
    lst = _read(out, 'components/native/AttachmentList.tsx')
    for needle in ('attachments-pick-${type}', 'attachment-remove-${type}-${index}', 'attachment-up-${type}-${index}',
                   'attachment-down-${type}-${index}', 'uploadFile('):
        assert needle in lst, needle
    # The picker uploads the file only; the attachment rows are written by the attachments route.
    assert 'uploadAttachment' not in lst and '/api/attachment/direct' not in lst
    for forbidden in ('prisma', 'use server'):
        assert forbidden not in lst + http, forbidden


def test_entities_without_the_bridge_get_no_attachment_list(out):
    for name in ('mobile_note', 'mobile_thread'):
        assert 'AttachmentList' not in _read(out, f'components/{name}/FormView.tsx')
    assert 'AttachmentList' not in _read(out, 'components/mobile_note/FormUpsert.tsx')


def test_attachments_route_is_generated_for_the_owner_only(out):
    route = (out / 'app/api/mobile_asset/[id]/attachments/route.ts').read_text()
    assert 'export async function PUT' in route
    assert "requireApiPermission(actorId, 'mobile_asset', 'update')" in route
    assert 'resolvePermissions(basePerms, item, actorId)' in route
    assert "setAttachmentsForBridge(attachableId, type as AttachmentType, parsed)" in route or 'setAttachmentsForBridge(attachableId' in route
    # Items are attachment ids only; a path is not accepted, and the action itself checks each id (the
    # record's own row, or an unlinked upload by the caller).
    assert 'parsed.push({ id: entry.id, order: index })' in route
    assert 'entry.path' not in route
    assert 'const ATTACHMENT_TYPES: readonly string[] = ["image", "file", "video", "audio"]' in route
    assert not (out / 'app/api/mobile_note/[id]/attachments/route.ts').exists()
    assert not (out / 'app/api/mobile_thread/[id]/attachments/route.ts').exists()


def test_bridge_only_app_gets_the_upload_helpers_and_the_picker_dependency(out):
    # mobile_document has direct attachment fields too in this fixture; the helpers are written for either.
    assert (out / 'mobile/components/native/AttachmentList.tsx').exists()
    assert (out / 'mobile/lib/attachment-http.ts').exists()
    assert 'expo-document-picker' in (out / 'mobile/package.json').read_text()


def test_attachment_list_headings_and_buttons_reach_the_message_bundle():
    from generate import _mobile_messages_json
    en = json.loads((REPO / 'messages' / 'en.json').read_text(encoding='utf-8'))
    bundle = json.loads(_mobile_messages_json({'en': en}))['en']
    assert bundle['Fields']['images'] == en['Fields']['images']
    assert bundle['Fields']['attachments'] == en['Fields']['attachments']
    assert bundle['Common']['add'] == en['Common']['add'] and bundle['Common']['delete'] == en['Common']['delete']


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
    assert comment_thread_spec(_commentable_ctx()) == {'rel_name': 'commentable', 'reaction_types': ['like', 'love'], 'write': False}
    assert comment_thread_spec(_commentable_ctx(can_view=False)) is None
    assert comment_thread_spec(_ctx()) is None


def test_comment_thread_is_writable_only_where_the_comment_write_routes_are_written():
    from mobile_entities import comment_thread_spec
    # The routes need the comment actions and one of the write operations (the condition generate.py applies).
    for flag in ('can_create', 'can_update', 'can_delete', 'can_invalidate'):
        assert comment_thread_spec(_commentable_ctx(comment_actions_code='x', **{flag: True}))['write'] is True, flag
    assert comment_thread_spec(_commentable_ctx(comment_actions_code='x'))['write'] is False
    assert comment_thread_spec(_commentable_ctx(can_update=True))['write'] is False


def test_detail_screen_draws_the_thread_and_reaction_bar_through_the_rest_seam(out):
    view = _read(out, 'components/mobile_thread/FormView.tsx')
    assert "import { CommentThread" in view
    assert 'REACTION_TYPES: string[] = ["like", "love", "laugh", "surprised", "sad"]' in view
    assert 'record["commentable"]' in view
    thread = _read(out, 'components/native/CommentThread.tsx')
    assert "fetchCommentReactions," in thread and "toggleCommentReaction," in thread
    assert 'testID={`reaction-${comment.id}-${type}`}' in thread
    http = _read(out, 'lib/comment-http.ts')
    assert '/api/comment/${encodeURIComponent(commentId)}/reactions/toggle' in http
    assert "method: 'POST'" in http
    # The thread writes through the comment routes only: no Server Action, no database access.
    for forbidden in ('prisma', '/actions', 'use server'):
        assert forbidden not in thread + http, forbidden


def test_writable_thread_has_the_composer_edit_and_delete_through_the_comment_routes(out):
    view = _read(out, 'components/mobile_thread/FormView.tsx')
    assert "entity: 'mobile_thread'" in view
    assert 'canComment: permissions?.update === true' in view
    assert 'canDeleteAny: permissions?.delete === true' in view
    assert 'setReloads' in view
    thread = _read(out, 'components/native/CommentThread.tsx')
    for needle in ('addComment(write.entity', 'updateComment(write.entity', 'deleteComment(write.entity',
                   'testID={`${testIdPrefix}-input`}', 'comment-delete-confirm-'):
        assert needle in thread, needle
    http = _read(out, 'lib/comment-http.ts')
    assert '/api/${encodeURIComponent(entity)}/${encodeURIComponent(recordId)}/comments' in http
    for method in ("method: 'POST'", "method: 'PATCH'", "method: 'DELETE'"):
        assert method in http, method
    # A schema without an x-mention field has no mention search route, so no lookup is drawn.
    assert 'searchMentionUsers' not in thread + http
    assert '/api/mention/users' not in http


def test_mention_lookup_is_wired_when_the_schema_has_a_mention_field():
    from generate import _make_env, _render
    env = _make_env()
    http = _render(env, 'mobile/lib/comment-http.ts.jinja2', {'has_mention': True})
    thread = _render(env, 'mobile/components/native/CommentThread.tsx.jinja2', {'has_mention': True})
    assert '/api/mention/users?q=${encodeURIComponent(q)}' in http
    assert 'search: searchMentionUsers' in thread
    plain = _render(env, 'mobile/components/native/CommentThread.tsx.jinja2', {'has_mention': False})
    assert 'searchMentionUsers' not in plain


def test_composer_module_is_emitted_with_the_thread(out):
    composer = _read(out, 'lib/comment-composer.ts')
    # The markers are put back from the picked mentions; the search is passed in, not imported.
    assert '@[user_id:${mentions[index].id}]' in composer
    assert 'comment-http' not in composer.replace('./comment-http', '')


def test_entities_without_comments_get_no_thread(out):
    assert 'CommentThread' not in _read(out, 'components/mobile_note/FormView.tsx')


def test_reaction_labels_and_thread_heading_reach_the_message_bundle():
    from generate import _mobile_messages_json
    en = json.loads((REPO / 'messages' / 'en.json').read_text(encoding='utf-8'))
    bundle = json.loads(_mobile_messages_json({'en': en}))['en']
    assert bundle['ReactionType'] == en['ReactionType']
    # Only the keys the screens read of the (large) Fields namespace are shipped, the thread heading among them.
    assert bundle['Fields']['comments'] == en['Fields']['comments']
    assert set(bundle['Fields']) < set(en['Fields'])


# --- the list of entities left out of the mobile app ------------------------------------------

def _generate_fixture_with(tmp_path: Path, mutate=None) -> Path:
    """Run the pipeline on the fixture (optionally edited by `mutate(schema)`) and return its output dir."""
    import yaml
    schema = yaml.safe_load((FIXTURE / 'json_schema.yaml').read_text())
    if mutate:
        mutate(schema)
    src = tmp_path / 'json_schema.yaml'
    src.write_text(yaml.safe_dump(schema, sort_keys=False))
    (tmp_path / 'prisma').mkdir()
    shutil.copy(FIXTURE / 'schema.prisma', tmp_path / 'prisma' / 'schema.prisma')
    intermediate = tmp_path / 'generated_json_schema.yaml'
    build_user_schema(src, FIXTURE / 'schema.prisma', intermediate)
    generate(str(intermediate), str(tmp_path))
    return tmp_path


def test_nothing_is_listed_when_every_entity_has_a_mobile_screen(out):
    assert 'Every entity has a mobile screen.' in _read(out, 'MOBILE_ENTITIES.md')
    assert '- ' not in _read(out, 'MOBILE_ENTITIES.md')
    assert ineligible_log_lines([]) == []


def test_log_and_note_list_exactly_the_ineligible_entities_with_their_reasons(tmp_path, capsys):
    def edit(schema):
        # No REST routes -> mobile_log is left out; the other entities keep their screens.
        schema['definitions']['mobile_log']['x-generate']['api'] = False
    out = _generate_fixture_with(tmp_path, edit)
    log = capsys.readouterr().out
    reason = 'no REST routes (x-generate.api is off)'
    assert '1 entity left out of the mobile app' in log
    assert f'{reason}: mobile_log' in log
    note = _read(out, 'MOBILE_ENTITIES.md')
    assert f'## {reason}\n\n- mobile_log\n' in note
    assert note.count('\n- ') == 1
    assert 'mobile_note' not in note
    registry = _read(out, 'lib/entity-registry.ts')
    assert 'mobile_log: {' not in registry and 'mobile_note: {' in registry


def test_report_groups_entities_by_reason_in_a_stable_order():
    pairs = [('b', 'declares children_raw'), ('c', 'no list screen'), ('a', 'declares children_raw')]
    assert group_ineligible_by_reason(pairs) == {'declares children_raw': ['a', 'b'], 'no list screen': ['c']}
    lines = ineligible_log_lines(pairs)
    assert lines[0].startswith('  3 entities left out')
    assert lines[1:] == ['    declares children_raw: a, b', '    no list screen: c']
    note = ineligible_note(pairs)
    assert '## declares children_raw\n\n- a\n- b\n\n## no list screen\n\n- c\n' in note


# --- direct attachment fields ---------------------------------------------------------------

def test_direct_attachment_alone_is_eligible_but_a_polymorphic_attachment_is_not():
    ctx = _ctx(direct_attachment_rels=[{'prop_name': 'file_id', 'relation_name': 'file', 'required': False}])
    assert mobile_ineligible_reason(ctx) is None
    assert mobile_ineligible_reason({**ctx, 'has_attachable': True}) == 'declares has_attachable'


def test_attachment_fields_are_described_by_embed_key_and_body_key(out):
    client = _read(out, 'lib/mobile_document/mobile_client.ts')
    spec = json.loads(re.search(r'MOBILE_DOCUMENT_FIELDS: FieldSpec\[\] = (\[.*?\n\]);', client, re.S).group(1))
    by_key = {f['key']: f for f in spec}
    assert {k: f['kind'] for k, f in by_key.items()} == {'title': 'text', 'file_id': 'attachment', 'contract_id': 'attachment'}
    # The REST detail embeds the row under the column name without `_id`; the write body carries the id.
    assert (by_key['file_id']['relationName'], by_key['file_id']['bodyKey']) == ('file', 'file_id')
    assert (by_key['contract_id']['relationName'], by_key['contract_id']['bodyKey']) == ('contract', 'contract_id')
    assert by_key['contract_id']['required'] is True and by_key['file_id']['required'] is False
    assert 'target' not in by_key['file_id']


def test_list_row_sort_and_filter_leave_out_attachment_fields(out):
    client = _read(out, 'lib/mobile_document/mobile_client.ts')
    assert 'MOBILE_DOCUMENT_LIST_KEYS: string[] = ["title"]' in client
    assert 'MOBILE_DOCUMENT_SORT_KEYS: string[] = ["title"]' in client
    assert 'MOBILE_DOCUMENT_FILTER_KEYS: string[] = ["title"]' in client


def test_attachment_form_keeps_the_row_and_submits_only_its_id(out):
    form = _read(out, 'components/mobile_document/FormUpsert.tsx')
    assert 'useState<Record<string, AttachmentRow | null>>' in form
    assert 'attachment={attachments[spec.key] ?? null}' in form
    assert 'onAttachmentChange=' in form
    # The edit form starts from the row the REST detail embeds.
    assert 'record[spec.relationName ?? spec.key]' in form
    http = _read(out, 'lib/entity-http.ts')
    assert "spec.kind === 'relation' || spec.kind === 'attachment'" in http
    input_ = _read(out, 'components/native/FieldInput.tsx')
    assert "onChange(row ? row.id : '')" in input_


def test_attachment_detail_shows_the_file_name_as_a_link(out):
    view = _read(out, 'components/mobile_document/FormView.tsx')
    assert "import { AttachmentValue } from '@/components/native/AttachmentInput';" in view
    assert 'testID={`view-field-${spec.key}`}' in view
    widget = _read(out, 'components/native/AttachmentInput.tsx')
    # The file route needs the access token, which a link handed to the system browser cannot carry.
    assert 'openAttachment(row.path)' in widget
    assert 'Linking.openURL' not in widget
    assert "from 'expo-document-picker'" in widget


def test_attachment_helpers_upload_then_create_the_row_through_rest(out):
    helper = _read(out, 'lib/attachment-http.ts')
    assert "apiFetch<UploadedFile>('/api/upload', { method: 'POST', body: form })" in helper
    assert "'/api/attachment/direct'" in helper
    # The row is prepared from the id the upload answered with; no path travels to the server.
    assert 'JSON.stringify({ id, type: attachmentKind(picked.mimeType) })' in helper
    assert "form.append('file', picked.file, picked.name)" in helper
    # Every type the upload route accepts is offered by the picker.
    policy = (REPO / 'lib' / '_upload_validation.ts').read_text()
    default_mimes = policy.split('DEFAULT_UPLOAD_MIME_TYPES')[1].split('];')[0]
    for mime in re.findall(r"'((?:image|application|text)/[^']+)'", default_mimes):
        if mime != 'image/jpg':
            assert f"'{mime}'" in helper, mime


def test_multipart_upload_keeps_its_own_content_type(out):
    base = _read(out, 'lib/api-base.ts')
    assert 'init.body instanceof FormData' in base
    assert 'export function resolveApiUrl' in base


def test_attachment_dependency_and_helpers_exist_only_with_an_attachment_entity(out):
    deps = json.loads(_read(out, 'package.json'))['dependencies']
    assert deps['expo-document-picker'].startswith('~58.')
    assert 'attachment' not in _read(out, 'components/mobile_note/FormUpsert.tsx').lower()
    assert 'AttachmentValue' not in _read(out, 'components/mobile_note/FormView.tsx')


def _generate_without(tmp_path, *removed):
    import yaml
    schema = yaml.safe_load((FIXTURE / 'json_schema.yaml').read_text())
    for name in removed:
        del schema['definitions'][name]
    trimmed = tmp_path / 'json_schema.yaml'
    trimmed.write_text(yaml.safe_dump(schema, sort_keys=False))
    prisma = tmp_path / 'schema.prisma'
    shutil.copy(FIXTURE / 'schema.prisma', prisma)
    work = tmp_path / 'work'
    (work / 'prisma').mkdir(parents=True)
    shutil.copy(prisma, work / 'prisma' / 'schema.prisma')
    intermediate = work / 'generated_json_schema.yaml'
    build_user_schema(trimmed, prisma, intermediate)
    generate(str(intermediate), str(work))
    return work


def test_attachment_dependency_is_absent_without_an_attachment_entity(tmp_path):
    work = _generate_without(tmp_path, 'mobile_document', 'mobile_asset')
    assert 'expo-document-picker' not in (work / 'mobile' / 'package.json').read_text()
    assert not (work / 'mobile' / 'lib' / 'attachment-http.ts').exists()
    assert not (work / 'mobile' / 'components' / 'native' / 'AttachmentInput.tsx').exists()
    assert not (work / 'mobile' / 'components' / 'native' / 'AttachmentList.tsx').exists()
    assert not (work / 'app' / 'api' / 'mobile_asset').exists()


def test_bridge_attachments_alone_need_the_helpers_and_the_list_but_not_the_direct_input(tmp_path):
    work = _generate_without(tmp_path, 'mobile_document')
    assert 'expo-document-picker' in (work / 'mobile' / 'package.json').read_text()
    assert (work / 'mobile' / 'lib' / 'attachment-http.ts').exists()
    assert (work / 'mobile' / 'components' / 'native' / 'AttachmentList.tsx').exists()
    assert not (work / 'mobile' / 'components' / 'native' / 'AttachmentInput.tsx').exists()


def test_direct_attachment_fields_alone_do_not_write_the_bridge_list(tmp_path):
    work = _generate_without(tmp_path, 'mobile_asset')
    assert (work / 'mobile' / 'components' / 'native' / 'AttachmentInput.tsx').exists()
    assert not (work / 'mobile' / 'components' / 'native' / 'AttachmentList.tsx').exists()


def test_upload_route_accepts_the_browser_session_and_a_mobile_token(out):
    route = (out / 'app' / 'api' / 'upload' / 'route.ts').read_text()
    assert "import { requireCaller, ApiError } from '@/lib/api-auth';" in route
    assert 'requireCaller(request)' in route
    # A refused caller still gets the 401 body the Web form already handles.
    assert "{ error: 'Unauthorized' }, { status: 401 }" in route
    assert "from '@/auth'" not in route


def test_direct_attachment_rest_route_runs_the_web_action_as_the_caller(out):
    route = (out / 'app' / 'api' / 'attachment' / 'direct' / 'route.ts').read_text()
    assert 'const { userId } = await requireCaller(request);' in route
    assert 'withActor(userId, () =>' in route
    assert "import { createDirectAttachment } from '@/lib/attachment/direct_actions';" in route
    # The enum members of attachment.type are checked before Prisma sees the value.
    assert 'const ATTACHMENT_TYPES: readonly string[] = ["image", "file", "video", "audio"];' in route
    assert 'createDirectAttachment(id, type as' in route
    # Only the id of an uploaded attachment and its kind are read from the body; no path is accepted.
    assert 'const { id, type } = (body ?? {}) as Record<string, unknown>;' in route



# --- one-to-many child rows --------------------------------------------------------------------

def _invoice_fields(out):
    return {f['key']: f for f in _fields(out, 'mobile_invoice', 'MOBILE_INVOICE')}


def test_an_entity_with_an_editable_child_collection_gets_every_screen(out):
    for rel in ('lib/mobile_invoice/mobile_client.ts', 'components/mobile_invoice/FormUpsert.tsx',
                'components/mobile_invoice/FormView.tsx', 'components/mobile_invoice/List.tsx'):
        assert (out / 'mobile' / rel).exists(), rel
    assert 'mobile_invoice: {' in _read(out, 'lib/entity-registry.ts')
    assert 'mobile_invoice' not in _read(out, 'MOBILE_ENTITIES.md')


def test_the_child_collection_is_a_field_that_describes_its_rows(out):
    lines = _invoice_fields(out)['lines']
    assert lines['kind'] == 'child_rows'
    assert lines['bodyKey'] == 'lines' and lines['relationName'] == 'lines'
    rows = {f['key']: f for f in lines['rowFields']}
    assert {k: f['kind'] for k, f in rows.items()} == {
        'description': 'text', 'quantity': 'number', 'line_status': 'enum', 'shipped_on': 'date', 'mobile_group_id': 'relation',
    }
    # the parent's foreign key is not drawn; the others are required unless nullable or defaulted
    assert {k for k, f in rows.items() if f['required']} == {'description', 'quantity', 'mobile_group_id'}
    assert rows['line_status']['options'] == ['open', 'billed']
    # a schema default starts a new row at that value, and a blank field is left out so the server applies it
    assert rows['line_status']['defaultValue'] == 'open' and 'defaultValue' not in rows['quantity']
    assert rows['mobile_group_id']['target'] == 'mobile_group' and rows['mobile_group_id']['bodyKey'] == 'mobile_group_id'


def test_the_list_row_leaves_the_child_collection_out(out):
    client = _read(out, 'lib/mobile_invoice/mobile_client.ts')
    assert 'MOBILE_INVOICE_LIST_KEYS: string[] = ["invoice_no"]' in client
    assert '"lines"' not in re.search(r'MOBILE_INVOICE_SORT_KEYS: string\[\] = (.*);', client).group(1)


def test_rows_travel_as_one_json_entry_and_become_the_property_array(out):
    form = _read(out, 'components/mobile_invoice/FormUpsert.tsx')
    assert "formData.append(spec.key, JSON.stringify(value))" in form
    http = _read(out, 'lib/entity-http.ts')
    assert "spec.kind === 'child_rows'" in http
    assert 'body[spec.bodyKey ?? key] = rows.map' in http
    # a saved row keeps its id so the server updates it in place
    assert "row.id ? { id: row.id } : {}" in http
    assert 'field.defaultValue !== undefined' in http


def test_the_form_checks_required_row_fields_before_it_sends_the_rows(out):
    form = _read(out, 'components/mobile_invoice/FormUpsert.tsx')
    assert 'firstMissingRowField' in form
    assert 'firstMissingRowField' not in _read(out, 'components/mobile_note/FormUpsert.tsx')


def test_the_row_editor_adds_and_removes_rows_and_reuses_the_field_controls(out):
    input_ = _read(out, 'components/native/FieldInput.tsx')
    assert 'function ChildRowsInput' in input_
    assert 'row-${spec.key}-add' in input_ and 'row-${spec.key}-${index}-remove' in input_
    assert "t('Common.add')" in input_ and "t('Common.delete')" in input_
    assert 'function emptyRow' in input_ or 'export function emptyRow' in input_


def test_the_detail_screen_lists_the_rows(out):
    input_ = _read(out, 'components/native/FieldInput.tsx')
    assert "spec.kind === 'child_rows'" in input_
    view = _read(out, 'components/mobile_invoice/FormView.tsx')
    assert '<RelationValue spec={spec} record={record} translate={t}' in view
    assert 'toRecordDisplayText(spec, record, translate)' in input_


def test_row_editor_strings_exist_in_both_locales():
    for locale in ('en', 'ja'):
        common = json.loads((REPO / 'messages' / f'{locale}.json').read_text(encoding='utf-8'))['Common']
        assert 'add' in common and 'delete' in common, locale
