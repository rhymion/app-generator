"""check_generated.py must scan the schema-wide generated files that no
entity walk reaches: the scheduled-task service files (entity-level
`x-scheduled-task` and top-level `x-scheduled-tasks`) and the audit-log
storage jobs (`x-generator.audit-log-storage.enabled`).

Before the scan visited them, a string-built raw query planted in any of
these files was reported clean. Each test plants a `prisma.$queryRawUnsafe`
call and asserts it is flagged; the "gate off" cases pin that a file the
schema does not generate is not scanned.
"""
from __future__ import annotations

from pathlib import Path
from textwrap import dedent

from check_generated import check

_SCHEMA_BASE = dedent("""
    $schema: "http://json-schema.org/draft-07/schema#"
    {top_level}
    definitions:
      __widget:
        type: object
        required: [id, name]
        properties:
          id:
            type: string
            pattern: "^c[a-z0-9]{{24,}}$"
          name:
            type: string
        x-generate:
          list: true
          view: true
          new: true
          edit: true
          delete: true
          api: true
        {entity_extra}
""").lstrip()

_ENTITY_TASK = dedent("""
    x-scheduled-task:
          task_id: widget_timeout
          handler: afterTimeout
          interval: "0 * * * *"
          filter:
            status_in: ["pending"]
""").strip()

_BULK_TASKS = dedent("""
    x-scheduled-tasks:
      - task_id: demo_reset
        handler: resetDemo
        interval: "0 3 * * *"
""").strip()

_AUDIT_STORAGE = dedent("""
    x-generator:
      audit-log-storage:
        enabled: true
""").strip()

_UNSAFE_TS = (
    "import prisma from '@/lib/prisma';\n"
    "export async function run(name: string) {\n"
    "  return prisma.$queryRawUnsafe(`SELECT * FROM t WHERE n = '${name}'`);\n"
    "}\n"
)


def _make_tree(tmp_path: Path, *, top_level: str = '', entity_extra: str = '') -> Path:
    schema_path = tmp_path / 'json_schema.yaml'
    schema_path.write_text(_SCHEMA_BASE.format(top_level=top_level, entity_extra=entity_extra))
    for sub in (
        'lib/widget', 'components/widget', 'app/[locale]/widget',
        'app/[locale]/widget/new', 'app/[locale]/widget/edit/[id]',
        'app/[locale]/widget/view/[id]', 'app/api/widget', 'app/api/widget/[id]',
        'app/api/widget/bulk',
    ):
        (tmp_path / sub).mkdir(parents=True, exist_ok=True)
    return schema_path


def _plant(tmp_path: Path, rel: str) -> None:
    path = tmp_path / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(_UNSAFE_TS)


def _allowlist(tmp_path: Path) -> Path:
    path = tmp_path / 'allowlist.yaml'
    path.write_text('exemptions: []\n')
    return path


def _raw_violation_paths(schema: Path, tmp_path: Path) -> set[str]:
    return {v.path for v in check(schema, tmp_path, _allowlist(tmp_path)) if v.rule.startswith('raw:')}


def test_entity_scheduled_task_service_file_is_scanned(tmp_path: Path) -> None:
    schema = _make_tree(tmp_path, entity_extra=_ENTITY_TASK)
    _plant(tmp_path, 'lib/widget/service_scheduled.ts')
    assert 'lib/widget/service_scheduled.ts' in _raw_violation_paths(schema, tmp_path)


def test_bulk_scheduled_task_service_file_is_scanned(tmp_path: Path) -> None:
    schema = _make_tree(tmp_path, top_level=_BULK_TASKS)
    _plant(tmp_path, 'lib/scheduled-tasks/demo_reset/service_scheduled.ts')
    assert 'lib/scheduled-tasks/demo_reset/service_scheduled.ts' in _raw_violation_paths(schema, tmp_path)


def test_audit_log_ops_jobs_file_is_scanned_when_storage_enabled(tmp_path: Path) -> None:
    schema = _make_tree(tmp_path, top_level=_AUDIT_STORAGE)
    _plant(tmp_path, 'lib/audit-log-ops/jobs.ts')
    assert 'lib/audit-log-ops/jobs.ts' in _raw_violation_paths(schema, tmp_path)


def test_files_are_not_scanned_when_the_schema_does_not_generate_them(tmp_path: Path) -> None:
    schema = _make_tree(tmp_path)
    _plant(tmp_path, 'lib/widget/service_scheduled.ts')
    _plant(tmp_path, 'lib/audit-log-ops/jobs.ts')
    assert _raw_violation_paths(schema, tmp_path) == set()


def test_clean_scheduled_and_audit_files_report_nothing(tmp_path: Path) -> None:
    schema = _make_tree(tmp_path, top_level=_AUDIT_STORAGE, entity_extra=_ENTITY_TASK)
    for rel in ('lib/widget/service_scheduled.ts', 'lib/audit-log-ops/jobs.ts'):
        path = tmp_path / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("import prisma from '@/lib/prisma';\nexport const x = 1;\n")
    assert _raw_violation_paths(schema, tmp_path) == set()
