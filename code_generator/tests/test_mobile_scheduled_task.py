"""
Scheduled task administration screens in the generated Expo app (templates/mobile/scheduled_task_run/).

Runs the real build_user_schema.py -> generate.py pipeline on tests/fixtures/mobile_entity_gate, once with a
scheduled task declared and once without, and checks that:

- the screen is generated, registered and linked only when the schema declares a task
- it talks to the REST routes of the admin page only (GET /api/scheduled-task-runs and
  POST /api/scheduled-task-runs/<task>/<action>), never the cron dispatcher or a Server Action
- it carries no role logic of its own: which actions are offered is the `actions` flags the server
  returns, and a 403 is shown as the server's answer
- the strings it reads are bundled for every locale

Run:
    cd code_generator && python3 -m pytest tests/test_mobile_scheduled_task.py -v
"""
import json
from pathlib import Path
import shutil

import pytest
import yaml

from build_user_schema import build_user_schema
from generate import generate

FIXTURE = Path(__file__).resolve().parent / 'fixtures' / 'mobile_entity_gate'
REPO = Path(__file__).resolve().parents[2]


def _build(tmp_path: Path, with_task: bool) -> Path:
    prisma_dir = tmp_path / 'prisma'
    prisma_dir.mkdir(parents=True)
    shutil.copy(FIXTURE / 'schema.prisma', prisma_dir / 'schema.prisma')
    shutil.copytree(REPO / 'messages', tmp_path / 'messages')
    intermediate = tmp_path / 'generated_json_schema.yaml'
    build_user_schema(FIXTURE / 'json_schema.yaml', FIXTURE / 'schema.prisma', intermediate)
    if with_task:
        schema = yaml.safe_load(intermediate.read_text())
        schema['x-scheduled-tasks'] = [{'task_id': 'st_first', 'handler': 'runFirst'}]
        intermediate.write_text(yaml.safe_dump(schema))
    generate(str(intermediate), str(tmp_path))
    return tmp_path


@pytest.fixture(scope='module')
def out(tmp_path_factory):
    return _build(tmp_path_factory.mktemp('mobile_sched_on'), with_task=True)


@pytest.fixture(scope='module')
def out_without_task(tmp_path_factory):
    return _build(tmp_path_factory.mktemp('mobile_sched_off'), with_task=False)


def _read(out: Path, rel: str) -> str:
    return (out / 'mobile' / rel).read_text()


def test_screen_is_generated_registered_and_linked_when_a_task_is_declared(out):
    assert (out / 'mobile' / 'lib/scheduled_task_run/mobile_client.ts').exists()
    assert (out / 'mobile' / 'components/scheduled_task_run/List.tsx').exists()
    registry = _read(out, 'lib/entity-registry.ts')
    assert 'scheduled_task_run: {' in registry
    assert 'List: ScheduledTaskRunList' in registry
    nav = _read(out, 'lib/nav.ts')
    assert '"href": "/scheduled_task_run"' in nav


def test_nothing_is_generated_when_no_task_is_declared(out_without_task):
    assert not (out_without_task / 'mobile' / 'lib/scheduled_task_run').exists()
    assert not (out_without_task / 'mobile' / 'components/scheduled_task_run').exists()
    assert 'scheduled_task_run' not in _read(out_without_task, 'lib/entity-registry.ts')
    assert 'scheduled_task_run' not in _read(out_without_task, 'lib/nav.ts')
    bundle = _read(out_without_task, 'lib/messages.ts')
    assert 'ScheduledTaskRun' not in bundle


def test_client_uses_only_the_admin_rest_routes(out):
    client = _read(out, 'lib/scheduled_task_run/mobile_client.ts')
    assert '/api/scheduled-task-runs${query}' in client
    assert '/api/scheduled-task-runs/${encodeURIComponent(task)}/${action}' in client
    assert "method: 'POST'" in client
    assert '/api/scheduled-tasks/' not in client  # the cron dispatcher is not an operator action
    assert 'server action' not in client.lower()


def test_screen_follows_the_servers_action_flags_and_403(out):
    source = _read(out, 'components/scheduled_task_run/List.tsx')
    assert 'row.actions[kind]' in source
    assert "'FORBIDDEN'" in _read(out, 'lib/scheduled_task_run/mobile_client.ts')
    assert "label('forbidden')" in source  # a refused overview shows the server-side role message
    assert 'ScheduledTaskRunner' not in source  # no role check of its own
    assert 'canAccess' not in source and 'getModelPermissions' not in source


def test_strings_are_bundled_for_every_locale(out):
    messages = _read(out, 'lib/messages.ts')
    start = messages.index('const MESSAGES')
    bundle = json.loads(messages[messages.index('=', start) + 1:messages.index(';\n', start)])
    for locale in ('en', 'ja'):
        section = bundle[locale]['ScheduledTaskRun']
        for key in (
            'title', 'forbidden', 'settingsNote', 'statusBlocked', 'whyBlocked', 'rerun', 'resolve', 'skip',
            'reasonPlaceholder', 'attentionTitle', 'resultDone', 'resultForbidden', 'resultBlocked',
        ):
            assert section[key], (locale, key)
