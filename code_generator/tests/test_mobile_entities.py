"""
Native entity screens in the generated Expo app (mobile_entities.py + templates/mobile/).

Runs the real build_user_schema.py -> generate.py pipeline on tests/fixtures/mobile_entity_gate
and checks that:

- an entity without relations gets the screens its own x-generate flags allow, and one that
  declares a relation, a child, a custom component or similar gets none
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
    ('parent_rels_raw', [{'prop_name': 'org_id'}]),
    ('selector_oto_rels', [{'prop_name': 'x'}]),
    ('direct_attachment_rels', [{'prop_name': 'x'}]),
    ('children_raw', [{'name': 'child'}]),
    ('entity_view_components', [{'name': 'ApprovalSection'}]),
    ('has_commentable', True),
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
