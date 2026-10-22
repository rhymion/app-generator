"""
The scheduled-task-e2e-gate fixture (code_generator/tests/fixtures/scheduled_task_e2e_gate/)
is merged into a disposable copy of the app by scripts/compose_child_datagrid_e2e_fixture.py
(the composer takes any fixture directory). These tests check, without docker or a browser,
that the merge adds the fixture's scheduled tasks and handlers, never edits the repository's
own files, and yields a schema the generator accepts end to end, with the admin REST routes
the gate's specs call.
"""
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

from build_user_schema import build_user_schema
from generate import generate

REPO_ROOT = Path(__file__).resolve().parents[2]
FIXTURE_DIR = REPO_ROOT / 'code_generator' / 'tests' / 'fixtures' / 'scheduled_task_e2e_gate'
COMPOSE = REPO_ROOT / 'scripts' / 'compose_child_datagrid_e2e_fixture.py'
TASKS = ('st_first', 'st_second', 'st_boom')


@pytest.fixture()
def app_copy(tmp_path):
    (tmp_path / 'code_generator').mkdir()
    (tmp_path / 'prisma').mkdir()
    shutil.copy(REPO_ROOT / 'code_generator' / 'json_schema.yaml', tmp_path / 'code_generator')
    shutil.copy(REPO_ROOT / 'code_generator' / 'json_schema_internal.yaml', tmp_path / 'code_generator')
    shutil.copy(REPO_ROOT / 'prisma' / 'schema.prisma', tmp_path / 'prisma')
    return tmp_path


def _compose(app_dir: Path):
    return subprocess.run([sys.executable, str(COMPOSE), str(FIXTURE_DIR), str(app_dir)],
                          capture_output=True, text=True)


def test_compose_adds_the_tasks_and_their_handlers(app_copy):
    result = _compose(app_copy)
    assert result.returncode == 0, result.stderr
    schema = (app_copy / 'code_generator' / 'json_schema.yaml').read_text()
    for task in TASKS:
        assert f'task_id: {task}' in schema
        assert (app_copy / 'lib' / 'scheduled-tasks' / task / 'service_scheduled_handler.ts').exists()
    assert 'depends_on: [st_first]' in schema
    assert 'always fails' in (app_copy / 'lib/scheduled-tasks/st_boom/service_scheduled_handler.ts').read_text()


def test_compose_leaves_the_repositorys_own_files_alone(app_copy):
    own = REPO_ROOT / 'code_generator' / 'json_schema.yaml'
    before = own.read_bytes()
    assert _compose(app_copy).returncode == 0
    assert own.read_bytes() == before
    assert 'st_first' not in before.decode()


def test_compose_refuses_to_shadow_tasks_the_default_schema_declares(app_copy):
    schema = app_copy / 'code_generator' / 'json_schema.yaml'
    schema.write_text(schema.read_text().replace('definitions:', 'x-scheduled-tasks:\n  - task_id: other\n    handler: runOther\n\ndefinitions:', 1))
    result = _compose(app_copy)
    assert result.returncode != 0
    assert 'x-scheduled-tasks' in result.stderr


def test_composed_schema_generates_the_admin_routes(app_copy, tmp_path_factory):
    assert _compose(app_copy).returncode == 0
    out = tmp_path_factory.mktemp('generated')
    (out / 'prisma').mkdir()
    shutil.copy(app_copy / 'prisma' / 'schema.prisma', out / 'prisma' / 'schema.prisma')
    intermediate = out / 'generated_json_schema.yaml'
    build_user_schema(app_copy / 'code_generator' / 'json_schema.yaml', out / 'prisma' / 'schema.prisma', intermediate)
    generate(str(intermediate), str(out))
    assert (out / 'app/api/scheduled-task-runs/route.ts').exists()
    assert (out / 'app/api/scheduled-task-runs/[task]/[action]/route.ts').exists()
    registry = (out / 'lib/scheduled-tasks/registry.ts').read_text()
    for task in TASKS:
        assert task in registry
    assert 'model scheduled_task_run' in (out / 'prisma' / 'schema.prisma').read_text()
