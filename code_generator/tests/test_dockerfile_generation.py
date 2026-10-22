"""
Dockerfile and .dockerignore are generated for x-cloud:gcp and for any schema that declares scheduled tasks,
independent of x-cloud.provider (Issue #1029), so scripts/gcp-task-runner.sh can build the task-runner image
for an app deployed on Vercel.

Runs the real build_user_schema.py -> generate.py pipeline on tests/fixtures/mobile_entity_gate, with and without a
top-level x-scheduled-tasks entry.

Run:
    cd code_generator && python3 -m pytest tests/test_dockerfile_generation.py -v
"""
import shutil
from pathlib import Path

import pytest
import yaml

import cleanup
from build_user_schema import build_user_schema
from generate import generate
from manifest import MANIFEST_FILENAME

FIXTURES = Path(__file__).resolve().parent / 'fixtures'
FIXTURE = FIXTURES / 'mobile_entity_gate'
_TASKS = [{'task_id': 'nightly_task', 'handler': 'runNightly'}]


def _build(tmp_path: Path, scheduled: bool, x_cloud=None) -> Path:
    fixture = FIXTURE
    prisma_dir = tmp_path / 'prisma'
    prisma_dir.mkdir(parents=True)
    shutil.copy(fixture / 'schema.prisma', prisma_dir / 'schema.prisma')
    intermediate = tmp_path / 'generated_json_schema.yaml'
    build_user_schema(fixture / 'json_schema.yaml', fixture / 'schema.prisma', intermediate)
    schema = yaml.safe_load(intermediate.read_text())
    schema.pop('x-cloud', None)
    schema.pop('x-scheduled-tasks', None)
    if scheduled:
        schema['x-scheduled-tasks'] = _TASKS
    if x_cloud is not None:
        schema['x-cloud'] = x_cloud
    intermediate.write_text(yaml.safe_dump(schema))
    generate(str(intermediate), str(tmp_path))
    return tmp_path


def test_scheduled_tasks_without_x_cloud_generate_dockerfile_and_dockerignore(tmp_path):
    out = _build(tmp_path, True)
    assert (out / 'Dockerfile').exists()
    assert (out / '.dockerignore').exists()
    # Provider-specific output stays off: Vercel Blob upload route, vercel.json crons, no standalone output.
    assert 'GCS' not in (out / 'app' / 'api' / 'upload' / 'route.ts').read_text()
    assert not (out / 'app' / 'api' / 'gcs').exists()


def test_dockerignore_keeps_secrets_and_node_modules_out_of_the_image(tmp_path):
    lines = (_build(tmp_path, True) / '.dockerignore').read_text().splitlines()
    assert 'node_modules' in lines
    assert '.env*' in lines
    assert '!.env.example' in lines


def test_no_scheduled_tasks_and_no_x_cloud_generates_neither_file(tmp_path):
    out = _build(tmp_path, False)
    assert not (out / 'Dockerfile').exists()
    assert not (out / '.dockerignore').exists()


def test_x_cloud_gcp_still_generates_both_files_and_gcp_output(tmp_path):
    out = _build(tmp_path, False, {'enabled': True, 'provider': 'gcp'})
    assert (out / 'Dockerfile').exists()
    assert (out / '.dockerignore').exists()
    assert (out / 'app' / 'api' / 'gcs' / '[...path]' / 'route.ts').exists()


def test_both_files_are_tracked_by_the_manifest_and_cleaned_up(tmp_path, monkeypatch):
    out = _build(tmp_path, True)
    manifest = (out / MANIFEST_FILENAME).read_text()
    assert 'Dockerfile' in manifest
    assert '.dockerignore' in manifest
    monkeypatch.setattr(cleanup, '_MANIFEST_FRESH_THRESHOLD_S', 0)
    assert cleanup._clean_from_manifest(out) is True
    assert not (out / 'Dockerfile').exists()
    assert not (out / '.dockerignore').exists()


def _stage_body(dockerfile: str, name: str) -> str:
    """Return the text of one Dockerfile stage, from its FROM line up to the next FROM."""
    parts = dockerfile.split('\nFROM ')
    for part in parts:
        header = part.split('\n', 1)[0]
        if header.endswith(f' AS {name}'):
            return part
    raise AssertionError(f'stage {name!r} not found')


def test_task_runner_stage_skips_next_build_but_generates_code_and_prisma_client(tmp_path):
    dockerfile = (_build(tmp_path, True) / 'Dockerfile').read_text()
    stage = _stage_body(dockerfile, 'task-runner')
    assert 'npm run generate-code' in stage
    assert 'npx prisma generate' in stage
    assert 'npm run build' not in stage
    assert 'COPY --from=deps /app/node_modules' in stage  # keeps tsx and the Prisma CLI


def test_builder_stage_extends_task_runner_and_adds_the_next_build(tmp_path):
    dockerfile = (_build(tmp_path, True) / 'Dockerfile').read_text()
    assert '\nFROM task-runner AS builder' in dockerfile
    assert 'npm run build' in _stage_body(dockerfile, 'builder')
    # The runner stage still takes the standalone output from builder.
    assert 'COPY --from=builder' in _stage_body(dockerfile, 'runner')
    assert dockerfile.rstrip().endswith('CMD ["node", "server.js"]')
