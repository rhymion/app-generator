"""
Hand-written component slots in the generated Expo app (mobile_entities.py + templates/mobile/).

Runs the real build_user_schema.py -> generate.py pipeline on tests/fixtures/mobile_entity_gate, whose
`mobile_widget` entity declares entity-level components (`x-custom-components`: list, view, edit) and
field-level ones (`x-custom-component`: upsert, view), and checks that:

- declaring them no longer leaves the entity out of the mobile app
- each screen mounts the components at the position of the Web counterpart, with the props contract
  of lib/custom-component.ts
- every component gets a native stub, generated once, that renders nothing and shows no marker text
- regenerating never overwrites a stub a developer edited
- the generation log announces a newly created stub (ACTION REQUIRED) and only then
- a credential field (upsert-only string) is not listed, sorted or sent back

Run:
    cd code_generator && python3 -m pytest tests/test_mobile_custom_components.py -v
"""
import contextlib
import io
from pathlib import Path
import re
import shutil

import pytest

from build_user_schema import build_user_schema
from generate import _write_stub, generate
from mobile_entities import build_mobile_entity_spec, custom_component_slots, mobile_ineligible_reason

FIXTURE = Path(__file__).resolve().parent / 'fixtures' / 'mobile_entity_gate'

ENTITY_STUBS = ('WidgetToolbar', 'WidgetSummary', 'WidgetHelper', 'WidgetEditNote')
FIELD_STUBS = ('Secret', 'Badge', 'Mood')


@pytest.fixture(scope='module')
def run(tmp_path_factory):
    """The output directory, the first run's log and the second run's log (after a stub was hand-edited)."""
    tmp_path = tmp_path_factory.mktemp('mobile_custom_components')
    prisma_dir = tmp_path / 'prisma'
    prisma_dir.mkdir(parents=True)
    shutil.copy(FIXTURE / 'schema.prisma', prisma_dir / 'schema.prisma')
    intermediate = tmp_path / 'generated_json_schema.yaml'
    build_user_schema(FIXTURE / 'json_schema.yaml', FIXTURE / 'schema.prisma', intermediate)
    first = io.StringIO()
    with contextlib.redirect_stdout(first):
        generate(str(intermediate), str(tmp_path))
    # A developer implements one stub; regenerating must leave it alone.
    edited = tmp_path / 'mobile' / 'components' / 'mobile_widget' / 'custom' / 'WidgetHelper.tsx'
    edited.write_text('// hand-written\nexport default function WidgetHelper() { return null; }\n')
    second = io.StringIO()
    with contextlib.redirect_stdout(second):
        generate(str(intermediate), str(tmp_path))
    return tmp_path, first.getvalue(), second.getvalue()


def _read(run, rel: str) -> str:
    return (run[0] / 'mobile' / rel).read_text()


def _custom(name: str) -> str:
    return f'components/mobile_widget/custom/{name}.tsx'


def _field_stub(name: str) -> str:
    return f'components/mobile_widget/custom/fields/{name}.tsx'


# --- eligibility and the spec ---------------------------------------------------------------

def test_an_entity_declaring_custom_components_gets_native_screens(run):
    out = run[0]
    for rel in ('List', 'FormView', 'FormUpsert'):
        assert (out / 'mobile' / 'components' / 'mobile_widget' / f'{rel}.tsx').exists(), rel
    assert 'mobile_widget: {' in _read(run, 'lib/entity-registry.ts')


def test_slots_follow_the_declared_targets_in_declaration_order():
    ctx = {
        'entity_custom_components': [{'name': 'A', 'props': {}}],
        'entity_view_components': [{'name': 'ApprovalSection'}, {'name': 'B', 'props': {'compact': True}}],
        'entity_edit_components': [{'name': 'B', 'props': {}}, {'name': 'C'}],
    }
    slots = custom_component_slots(ctx)
    assert [c['name'] for c in slots['list']] == ['A']
    assert [c['name'] for c in slots['view']] == ['B']  # ApprovalSection is served natively
    assert slots['view'][0]['props'] == {'compact': True}
    assert [c['name'] for c in slots['edit']] == ['B', 'C']


def test_a_list_component_alone_no_longer_makes_the_entity_ineligible():
    ctx = {'can_api': True, 'can_list': True, 'field_categories': {'text': ['name']},
           'entity_custom_components': [{'name': 'CopyShiftsButton'}]}
    assert mobile_ineligible_reason(ctx) is None


def test_custom_upsert_field_is_eligible_and_keeps_the_kind_of_its_value():
    ctx = {'can_api': True, 'can_list': True, 'can_create': True, 'can_update': True, 'can_view': True, 'parent': 'x',
           'parent_pascal': 'X', 'model_def': {},
           'field_categories': {'text': ['name'], 'custom_upsert': ['mfa_enabled']},
           'filtered_props': {'name': {'type': 'string'}, 'mfa_enabled': {'type': 'boolean',
                                                                          'x-custom-component': {'target': ['upsert']}}}}
    assert mobile_ineligible_reason(ctx) is None
    spec = build_mobile_entity_spec(ctx, {'client_required_fields': []}, lambda n: n.title())
    field = next(f for f in spec['fields'] if f['key'] == 'mfa_enabled')
    assert field['kind'] == 'boolean'
    assert field['custom'] == {'upsert': True, 'view': False}


# --- stubs ----------------------------------------------------------------------------------

@pytest.mark.parametrize('name', ENTITY_STUBS)
def test_every_entity_component_gets_a_stub_that_renders_nothing(run, name):
    stub = _read(run, _custom(name))
    if name == 'WidgetHelper':
        return  # hand-edited by the fixture; see the non-overwrite test
    assert f'export default function {name}(' in stub
    assert 'return null;' in stub
    assert 'EntityComponentProps' in stub
    # Nothing a user could read: no JSX text, no marker.
    assert '<' not in stub.split('export default function')[1]
    assert 'not implemented' not in stub.lower()


@pytest.mark.parametrize('name', FIELD_STUBS)
def test_every_field_component_gets_a_stub_that_renders_nothing(run, name):
    stub = _read(run, _field_stub(name))
    assert f'export default function {name}(' in stub
    assert 'return null;' in stub
    assert 'not implemented' not in stub.lower()


def test_a_component_mounted_on_two_screens_has_one_stub(run):
    # WidgetHelper is declared for view and edit; both screens import the same file.
    assert "import WidgetHelper from '@/components/mobile_widget/custom/WidgetHelper';" in _read(run, 'components/mobile_widget/FormView.tsx')
    assert "import WidgetHelper from '@/components/mobile_widget/custom/WidgetHelper';" in _read(run, 'components/mobile_widget/FormUpsert.tsx')
    assert len(list((run[0] / 'mobile/components/mobile_widget/custom').glob('WidgetHelper*.tsx'))) == 1


def test_regenerating_never_overwrites_a_stub_a_developer_edited(run):
    assert _read(run, _custom('WidgetHelper')).startswith('// hand-written')
    assert 'Skipped (exists)' in run[2]


def test_the_log_announces_created_stubs_once(run):
    first, second = run[1], run[2]
    assert 'ACTION REQUIRED' in first
    for name in ENTITY_STUBS:
        assert _custom(name) in first, name
    for name in FIELD_STUBS:
        assert _field_stub(name) in first, name
    assert 'mobile_widget' in first and 'draws nothing yet' in first
    # The second run found every stub in place: it announces none of them again.
    assert 'ACTION REQUIRED' not in second or 'mobile_widget' not in second.split('ACTION REQUIRED')[-1]


def test_write_stub_reports_whether_it_created_the_file(tmp_path):
    path = tmp_path / 'stub.tsx'
    assert _write_stub(path, 'one') is True
    assert _write_stub(path, 'one') is False
    path.write_text('edited')
    assert _write_stub(path, 'one') is False
    assert path.read_text() == 'edited'


# --- the props contract ---------------------------------------------------------------------

def test_the_props_contract_is_generated_beside_the_stubs(run):
    contract = _read(run, 'lib/custom-component.ts')
    for needle in ('EntityComponentProps', 'record?:', 'permissions?: ModelPermissions', 'reload: () => void',
                   'FieldUpsertProps', 'onChange', 'isEdit: boolean', 'FieldViewProps', 'value: unknown'):
        assert needle in contract, needle


# --- placement ------------------------------------------------------------------------------

def test_list_component_sits_in_the_search_sort_filter_row_and_gets_permissions(run):
    lst = _read(run, 'components/mobile_widget/List.tsx')
    assert "import WidgetToolbar from '@/components/mobile_widget/custom/WidgetToolbar';" in lst
    toolbar = lst.split('<View style={styles.toolbar}>')[1].split('</View>')[0]
    assert toolbar.index('list-filter-toggle') < toolbar.index('<WidgetToolbar ')
    assert '<WidgetToolbar permissions={permissions} reload={() => void load(page)} />' in toolbar
    assert 'setPermissions(permissions)' in lst  # loaded even though the entity could not bulk delete otherwise


def test_view_components_follow_the_fields_and_receive_record_permissions_and_reload(run):
    view = _read(run, 'components/mobile_widget/FormView.tsx')
    assert '<WidgetSummary record={record} permissions={permissions} reload={() => setReloads((n) => n + 1)} compact={ true } />' in view
    assert '<WidgetHelper record={record} permissions={permissions} reload={() => setReloads((n) => n + 1)} />' in view
    assert view.index('FIELDS.filter') < view.index('<WidgetSummary ') < view.index('<WidgetHelper ') < view.index('view-error')
    assert 'WidgetEditNote' not in view and 'WidgetToolbar' not in view
    assert '[id, reloads]' in view


def test_edit_components_follow_the_inputs_on_the_create_screen_too(run):
    form = _read(run, 'components/mobile_widget/FormUpsert.tsx')
    assert '<WidgetHelper record={record} permissions={permissions} reload={() => setReloads((n) => n + 1)} />' in form
    assert '<WidgetEditNote record={record} permissions={permissions} reload={() => setReloads((n) => n + 1)} />' in form
    assert form.index('FIELDS.map') < form.index('<WidgetHelper ') < form.index('<WidgetEditNote ') < form.index('form-validation-error')
    # Not gated on `isEdit`: the create form shows them as the Web form does (the record is null there).
    assert 'isEdit ? <WidgetHelper' not in form
    assert 'setRecord(record)' in form


def test_a_field_upsert_component_replaces_the_input_and_is_sent_only_when_changed(run):
    form = _read(run, 'components/mobile_widget/FormUpsert.tsx')
    assert "import FieldSecret from '@/components/mobile_widget/custom/fields/Secret';" in form
    assert "import FieldMood from '@/components/mobile_widget/custom/fields/Mood';" in form
    assert 'FieldBadge' not in form  # view-only
    assert 'CUSTOM_UPSERT[spec.key] ? createElement(CUSTOM_UPSERT[spec.key]' in form
    assert 'onChange: (next: string | boolean)' in form and 'isEdit,' in form
    assert 'A field a custom component draws is sent only once the component has changed it.' in form


def test_a_field_view_component_replaces_the_whole_row(run):
    view = _read(run, 'components/mobile_widget/FormView.tsx')
    assert "import FieldBadge from '@/components/mobile_widget/custom/fields/Badge';" in view
    assert "import FieldMood from '@/components/mobile_widget/custom/fields/Mood';" in view
    assert 'FieldSecret' not in view  # upsert-only
    assert 'CUSTOM_VIEW[spec.key] ? createElement(CUSTOM_VIEW[spec.key], { key: spec.key, value: record[spec.key] })' in view


def test_a_credential_field_is_neither_listed_nor_sorted_nor_shown(run):
    client = _read(run, 'lib/mobile_widget/mobile_client.ts')
    assert '"writeOnly": true' in client
    list_keys = re.search(r'MOBILE_WIDGET_LIST_KEYS: string\[\] = (\[.*?\]);', client, re.S).group(1)
    sort_keys = re.search(r'MOBILE_WIDGET_SORT_KEYS: string\[\] = (\[.*?\]);', client, re.S).group(1)
    assert 'secret' not in list_keys and 'secret' not in sort_keys
    assert 'FIELDS.filter((spec) => !spec.writeOnly)' in _read(run, 'components/mobile_widget/FormView.tsx')


def test_an_entity_without_components_carries_no_trace_of_the_slots(run):
    for rel in ('List', 'FormView', 'FormUpsert'):
        text = _read(run, f'components/mobile_note/{rel}.tsx')
        assert '/custom/' not in text and 'createElement' not in text, rel
    assert not (run[0] / 'mobile/components/mobile_note/custom').exists()


# --- ride-along: the virtual column resolver stub is announced too -------------------------

def test_a_new_virtual_resolver_stub_is_announced_in_the_action_required_summary(tmp_path):
    # `_write_stub` used to return None, so the notice keyed on its result never fired.
    schema = (FIXTURE / 'json_schema.yaml').read_text()
    marker = "  mobile_log:\n    x-generate:"
    head, tail = schema.split(marker, 1)
    tail = tail.replace("        - message:\n            primary: true\n", "        - message:\n            primary: true\n        - extra_info: {}\n", 1)
    schema_path = tmp_path / 'json_schema.yaml'
    schema_path.write_text(head + marker + tail)
    (tmp_path / 'prisma').mkdir()
    shutil.copy(FIXTURE / 'schema.prisma', tmp_path / 'prisma' / 'schema.prisma')
    intermediate = tmp_path / 'generated_json_schema.yaml'
    build_user_schema(schema_path, FIXTURE / 'schema.prisma', intermediate)
    log = io.StringIO()
    with contextlib.redirect_stdout(log):
        generate(str(intermediate), str(tmp_path))
    summary = log.getvalue().split('ACTION REQUIRED')[1]
    assert 'virtual_resolvers.ts' in summary
    assert 'has virtual column(s) [extra_info] with no resolver' in summary
