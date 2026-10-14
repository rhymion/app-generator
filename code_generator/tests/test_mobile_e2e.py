"""
Maestro flows for the native screens (mobile_e2e.py + templates/mobile/e2e/).

Runs the real build_user_schema.py -> generate.py pipeline on tests/fixtures/mobile_entity_gate and checks that:

- a flow exists for exactly the entities that have native screens (the same decision that emits the screens)
- a flow opens its list through the footer tab or the nav-group rows, and addresses only testIDs the native templates emit
- a creatable entity with simple required fields gets one create step; others get none
- nothing is written when the app has no native screens

Run:
    cd code_generator && python3 -m pytest tests/test_mobile_e2e.py -v
"""
from pathlib import Path
import re
import shutil

import pytest
import yaml

from build_user_schema import build_user_schema
from generate import generate
from mobile_e2e import FLOW_DIR, build_flows, create_steps, navigation_path

FIXTURE = Path(__file__).resolve().parent / 'fixtures' / 'mobile_entity_gate'
REPO = Path(__file__).resolve().parents[2]


@pytest.fixture(scope='module')
def out(tmp_path_factory):
    tmp_path = tmp_path_factory.mktemp('mobile_e2e')
    (tmp_path / 'prisma').mkdir(parents=True)
    shutil.copy(FIXTURE / 'schema.prisma', tmp_path / 'prisma' / 'schema.prisma')
    intermediate = tmp_path / 'generated_json_schema.yaml'
    build_user_schema(FIXTURE / 'json_schema.yaml', FIXTURE / 'schema.prisma', intermediate)
    generate(str(intermediate), str(tmp_path))
    return tmp_path


def _flow_dir(out: Path) -> Path:
    return out / 'mobile' / FLOW_DIR


def _load(path: Path) -> list:
    header, steps = list(yaml.safe_load_all(path.read_text()))
    assert header['appId'] == '${E2E_APP_ID}'
    return steps


def _screen_entities(out: Path) -> set[str]:
    return {p.name for p in (out / 'mobile' / 'components').iterdir() if (p / 'List.tsx').exists() and p.name != 'native'}


def test_a_flow_exists_for_exactly_the_entities_with_native_screens(out):
    with_screens = _screen_entities(out) - {'audit_log', 'scheduled_task_run'}
    flows = {p.stem for p in _flow_dir(out).glob('*.yaml')}
    assert with_screens, 'the fixture must have native screens'
    assert flows == with_screens


def test_entity_with_screens_but_no_tab_gets_no_flow():
    specs = [{**_spec([_field('title', 'text')]), 'name': 'a', 'title': 'A'},
             {**_spec([_field('title', 'text')]), 'name': 'b', 'title': 'B'}]
    tabs = [{'kind': 'link', 'entity': 'a', 'key': '/a'}]
    assert list(build_flows(specs, tabs)) == ['a']


def test_flows_are_built_only_from_the_specs_given():
    """An entity the screens skipped has no spec, so it cannot get a flow even when a tab names it."""
    tabs = [{'kind': 'link', 'entity': 'a', 'key': '/a'}, {'kind': 'link', 'entity': 'skipped', 'key': '/skipped'}]
    specs = [{**_spec([_field('title', 'text')]), 'name': 'a', 'title': 'A'}]
    assert list(build_flows(specs, tabs)) == ['a']


def test_the_flow_opens_the_list_from_the_footer_and_checks_the_list_chrome(out):
    steps = _load(_flow_dir(out) / 'mobile_note.yaml')
    assert steps[0] == {'runFlow': 'subflows/sign_in.yaml'}
    assert steps[1] == {'tapOn': {'id': 'footer-tab-mobile_note'}}
    ids = [s.get('assertVisible', {}).get('id') for s in steps if 'assertVisible' in s]
    assert 'list-title' in ids and 'list-page' in ids


def test_the_flow_signs_in_with_the_environment_not_literals(out):
    text = (_flow_dir(out) / 'subflows' / 'sign_in.yaml').read_text()
    assert '${E2E_EMAIL}' in text and '${E2E_PASSWORD}' in text
    assert 'admin@example.com' not in text


def test_a_creatable_entity_creates_one_record_and_lands_on_its_detail_screen(out):
    steps = _load(_flow_dir(out) / 'mobile_note.yaml')
    taps = [s['tapOn']['id'] for s in steps if 'tapOn' in s]
    assert 'list-new' in taps and 'form-save' in taps
    assert taps.index('list-new') < taps.index('field-title') < taps.index('form-save')
    assert 'field-status-open' in taps
    assert {'inputText': 'e2e ${E2E_RUN_ID} title'} in steps
    assert steps[-1]['extendedWaitUntil']['visible']['id'] == 'view-mobile_note'


def test_a_read_only_entity_gets_no_create_step(out):
    taps = [s['tapOn']['id'] for s in _load(_flow_dir(out) / 'mobile_log.yaml') if 'tapOn' in s]
    assert 'list-new' not in taps and 'form-save' not in taps


# An id the flows build from an entity or field name -> the template expression that emits it.
_DYNAMIC_ID_SOURCES = {
    'footer-tab-': 'footer-tab-${tabId(tab)}',
    'nav-row-': 'nav-row-${',
    'list-row-': 'list-row-${item.id}',
    'list-': 'list-{{ name }}',
    'view-': 'view-{{ name }}',
    'form-new-': 'form-new-{{ name }}',
    'field-': 'field-${spec.key}',
}


def test_every_addressed_id_is_emitted_by_a_native_template(out):
    emitted = '\n'.join(p.read_text() for p in (REPO / 'code_generator' / 'templates' / 'mobile').rglob('*.jinja2'))
    seen = 0
    for path in _flow_dir(out).rglob('*.yaml'):
        for line in path.read_text().splitlines():
            m = re.match(r'\s*id: (\S+)$', line)
            if not m:
                continue
            ident = m.group(1)
            seen += 1
            if f'"{ident}"' in emitted:
                continue
            prefix = next((p for p in _DYNAMIC_ID_SOURCES if ident.startswith(p)), None)
            assert prefix, f'{ident} is neither a static testID nor a known dynamic one'
            assert _DYNAMIC_ID_SOURCES[prefix] in emitted, ident
    assert seen > 20


def test_navigation_path_for_flat_and_grouped_entities():
    tabs = [
        {'kind': 'link', 'entity': 'a', 'key': '/a'},
        {'kind': 'group', 'slug': 'ops', 'key': 'ops', 'children': [
            {'kind': 'link', 'entity': 'b', 'key': '/b'},
            {'kind': 'group', 'slug': 'sub', 'key': 'sub', 'children': [{'kind': 'link', 'entity': 'c', 'key': '/c'}]},
        ]},
    ]
    assert navigation_path(tabs, 'a') == ['footer-tab-a']
    assert navigation_path(tabs, 'b') == ['footer-tab-ops', 'nav-row-b']
    assert navigation_path(tabs, 'c') == ['footer-tab-ops', 'nav-row-sub', 'nav-row-c']
    assert navigation_path(tabs, 'missing') is None


def _spec(fields, can_new=True, can_view=True):
    return {'can_new': can_new, 'can_view': can_view, 'fields': fields}


def _field(key, kind, required=True, **extra):
    return {'key': key, 'kind': kind, 'required': required, 'readonly': False, 'options': [], **extra}


def test_create_steps_cover_simple_required_kinds_and_skip_optional_ones():
    spec = _spec([
        _field('title', 'text'), _field('qty', 'number'), _field('price', 'decimal'),
        _field('state', 'enum', options=['open', 'closed']), _field('due', 'date'), _field('flag', 'boolean'),
        _field('note', 'text', required=False),
    ])
    assert create_steps(spec) == [
        {'action': 'type', 'id': 'field-title', 'text': 'e2e ${E2E_RUN_ID} title'},
        {'action': 'type', 'id': 'field-qty', 'text': '1'},
        {'action': 'type', 'id': 'field-price', 'text': '1.5'},
        {'action': 'tap', 'id': 'field-state-open'},
        {'action': 'tap', 'id': 'field-due-now'},
    ]


@pytest.mark.parametrize('kind', ['relation', 'relation_many', 'attachment', 'child_rows'])
def test_no_create_step_when_a_required_field_needs_a_picker_file_or_rows(kind):
    assert create_steps(_spec([_field('title', 'text'), _field('x', kind)])) is None


def test_no_create_step_when_the_entity_cannot_be_created_or_viewed():
    assert create_steps(_spec([_field('title', 'text')], can_new=False)) is None
    assert create_steps(_spec([_field('title', 'text')], can_view=False)) is None
    assert create_steps(_spec([{**_field('title', 'text'), 'readonly': True}])) is None


def test_nothing_is_written_when_the_app_has_no_native_screens(tmp_path):
    from jinja2 import Environment
    from generate import generate_mobile_native_e2e
    generate_mobile_native_e2e([], [], tmp_path, Environment())
    assert not (tmp_path / FLOW_DIR).exists()


# --- scripts/run_mobile_native_e2e.sh ---------------------------------------------------------

SCRIPT = REPO / 'scripts' / 'run_mobile_native_e2e.sh'


def _fake_maestro(tmp_path: Path, verdict: str) -> Path:
    fake = tmp_path / 'maestro'
    fake.write_text(f'#!/bin/sh\necho "{verdict}"\n')
    fake.chmod(0o755)
    return fake


def _run(args: list[str], **env) -> 'subprocess.CompletedProcess':
    import os
    import subprocess
    return subprocess.run(['bash', str(SCRIPT), *args], capture_output=True, text=True, cwd=REPO, env={**os.environ, **env})


def test_script_reports_unavailable_never_a_silent_pass_without_the_cli(tmp_path):
    result = _run([], MAESTRO_BIN=str(tmp_path / 'absent'), FLOW_DIR=str(tmp_path))
    assert result.returncode == 3 and 'UNAVAILABLE' in result.stderr


def test_script_fails_when_there_is_no_generated_flow(tmp_path):
    result = _run([], MAESTRO_BIN=str(_fake_maestro(tmp_path, 'OK')), FLOW_DIR=str(tmp_path / 'none'))
    assert result.returncode == 1 and 'no generated flow' in result.stderr


def test_script_validates_every_flow_and_the_sign_in_subflow(out, tmp_path):
    flows = _flow_dir(out)
    result = _run([], MAESTRO_BIN=str(_fake_maestro(tmp_path, 'OK')), FLOW_DIR=str(flows))
    assert result.returncode == 0, result.stderr
    assert f'validated {len(list(flows.glob("*.yaml")))} flow(s)' in result.stdout
    assert 'nothing was executed' in result.stdout


def test_script_fails_on_an_invalid_flow(out, tmp_path):
    result = _run([], MAESTRO_BIN=str(_fake_maestro(tmp_path, 'Invalid Command: tapOnn')), FLOW_DIR=str(_flow_dir(out)))
    assert result.returncode == 1 and 'INVALID' in result.stderr


def test_run_mode_is_unavailable_without_an_apk(out, tmp_path):
    result = _run(['run'], MAESTRO_BIN=str(_fake_maestro(tmp_path, 'OK')), FLOW_DIR=str(_flow_dir(out)), APK=str(tmp_path / 'absent.apk'))
    assert result.returncode == 3 and 'UNAVAILABLE' in result.stderr
