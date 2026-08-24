"""Proves the x-scheduled-tasks bulk mechanism (cmd_790) fires end-to-end
through the real build_user_schema.py -> generate.py pipeline, not just at
the Jinja-rendering level (test_scheduled_task_templates.py) or the
schema-validation level (test_validate_scheduled_task.py). Also proves it
coexists with the pre-existing entity-level x-scheduled-task mechanism
(cmd_750/subtask_741a) in one merged TASK_REGISTRY.

Modeled on code_generator/tests/test_payment_gate_fixture.py's
fixture-pipeline pattern.
"""
from pathlib import Path
import shutil

from build_user_schema import build_user_schema
from generate import generate

REPO_ROOT = Path(__file__).resolve().parents[2]
FIXTURE_DIR = REPO_ROOT / 'code_generator' / 'tests' / 'fixtures' / 'scheduled_task_bulk_gate'


def _run_pipeline(tmp_path: Path) -> Path:
    prisma_dir = tmp_path / 'prisma'
    prisma_dir.mkdir(parents=True, exist_ok=True)
    shutil.copy(FIXTURE_DIR / 'schema.prisma', prisma_dir / 'schema.prisma')

    intermediate = tmp_path / 'generated_json_schema.yaml'
    build_user_schema(
        FIXTURE_DIR / 'json_schema.yaml',
        FIXTURE_DIR / 'schema.prisma',
        intermediate,
    )
    generate(str(intermediate), str(tmp_path))
    return tmp_path


def test_bulk_service_scheduled_written_with_no_entity_binding(tmp_path):
    out = _run_pipeline(tmp_path)
    service = out / 'lib' / 'scheduled-tasks' / 'demo_reset' / 'service_scheduled.ts'
    assert service.exists(), 'bulk mode must write lib/scheduled-tasks/<task_id>/service_scheduled.ts'
    content = service.read_text()
    assert 'await resetDemo(systemActorId)' in content
    assert 'findMany' not in content


def test_bulk_handler_stub_written_once(tmp_path):
    out = _run_pipeline(tmp_path)
    stub = out / 'lib' / 'scheduled-tasks' / 'demo_reset' / 'service_scheduled_handler.ts'
    assert stub.exists(), 'bulk mode must write a GENERATED ONCE handler stub'
    content = stub.read_text()
    assert content.startswith('// GENERATED ONCE')
    assert 'export async function resetDemo(systemActorId: string): Promise<void> {' in content


def test_bulk_handler_stub_not_overwritten_on_second_run(tmp_path):
    """GENERATED ONCE contract: a hand-edit must survive a second
    generate-code run, same as every other write-once stub."""
    out = _run_pipeline(tmp_path)
    stub = out / 'lib' / 'scheduled-tasks' / 'demo_reset' / 'service_scheduled_handler.ts'
    hand_edit = stub.read_text().replace('void systemActorId;', "await resetDemoData();")
    stub.write_text(hand_edit)

    intermediate = tmp_path / 'generated_json_schema.yaml'
    generate(str(intermediate), str(tmp_path))

    assert stub.read_text() == hand_edit


def test_registry_contains_both_bulk_and_row_scan_tasks(tmp_path):
    """cmd_790 AC1/AC3: the bulk task must coexist with the pre-existing
    entity-level x-scheduled-task mechanism in one merged registry -- neither
    displaces the other."""
    out = _run_pipeline(tmp_path)
    registry = (out / 'lib' / 'scheduled-tasks' / 'registry.ts').read_text()
    assert "'demo_reset': demoResetRun" in registry
    assert "'widget_timeout': widgetRun" in registry
    assert "from '@/lib/scheduled-tasks/demo_reset/service_scheduled'" in registry
    assert "from '@/lib/widget/service_scheduled'" in registry


def test_row_scan_task_still_writes_its_own_files_unchanged(tmp_path):
    """Negative control: adding the bulk mechanism must not disturb the
    pre-existing per-entity output shape."""
    out = _run_pipeline(tmp_path)
    service = out / 'lib' / 'widget' / 'service_scheduled.ts'
    assert service.exists()
    content = service.read_text()
    assert 'prisma.widget.findMany' in content
    assert "status: { in: ['pending'] }" in content


def test_vercel_json_crons_include_both(tmp_path):
    out = _run_pipeline(tmp_path)
    import json
    data = json.loads((out / 'vercel.json').read_text())
    paths = {c['path'] for c in data['crons']}
    assert paths == {
        '/api/scheduled-tasks/demo_reset',
        '/api/scheduled-tasks/widget_timeout',
    }
