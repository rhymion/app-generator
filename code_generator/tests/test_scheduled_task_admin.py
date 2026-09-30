"""The scheduled-task admin page: emitted only with the `scheduled_task_run`
table it reads, wired into the sidebar and the i18n files, and retracted by
cleanup. Uses the x-scheduled-tasks fixture pipeline like
test_scheduled_task_bulk_gate_fixture.py."""
import json
import shutil
from pathlib import Path

import pytest

from build_user_schema import build_user_schema
from generate import generate
from generators_i18n import SCHEDULED_TASK_RUN_MESSAGES, _update_json, _update_site_config, _update_sidebar
from nav_config import EXTRA_NAV_PARENT, nav_extra_entities, schema_declares_scheduled_tasks

REPO_ROOT = Path(__file__).resolve().parents[2]
FIXTURE_DIR = REPO_ROOT / 'code_generator' / 'tests' / 'fixtures' / 'scheduled_task_bulk_gate'
NO_TASK_FIXTURE_DIR = REPO_ROOT / 'code_generator' / 'tests' / 'fixtures' / 'decimal_gate'

ADMIN_FILES = [
    'lib/scheduled-tasks/admin.ts',
    'app/[locale]/scheduled_task_run/actions.ts',
    'app/[locale]/scheduled_task_run/page.tsx',
    'components/scheduled_task_run/ScheduledTaskRunTable.tsx',
]


def _run(fixture: Path, tmp_path: Path) -> Path:
    (tmp_path / 'prisma').mkdir(parents=True, exist_ok=True)
    shutil.copy(fixture / 'schema.prisma', tmp_path / 'prisma' / 'schema.prisma')
    intermediate = tmp_path / 'generated_json_schema.yaml'
    build_user_schema(fixture / 'json_schema.yaml', fixture / 'schema.prisma', intermediate)
    generate(str(intermediate), str(tmp_path))
    return tmp_path


def test_admin_files_written_when_tasks_declared(tmp_path):
    out = _run(FIXTURE_DIR, tmp_path)
    for rel in ADMIN_FILES:
        assert (out / rel).exists(), rel
    admin = (out / 'lib/scheduled-tasks/admin.ts').read_text()
    assert 'prisma.scheduled_task_run' in admin
    assert 'businessDate, reclaimRunning: stuck' in admin


def test_admin_files_absent_when_no_task_declared(tmp_path):
    out = _run(NO_TASK_FIXTURE_DIR, tmp_path)
    for rel in ADMIN_FILES:
        assert not (out / rel).exists(), rel
    assert 'scheduled_task_run' not in (out / 'prisma' / 'schema.prisma').read_text()


def test_actions_are_role_gated_and_audited(tmp_path):
    out = _run(FIXTURE_DIR, tmp_path)
    actions = (out / 'app/[locale]/scheduled_task_run/actions.ts').read_text()
    assert actions.startswith("'use server';")
    assert 'getScheduledTaskOperatorId' in actions
    admin = (out / 'lib/scheduled-tasks/admin.ts').read_text()
    for action in ('scheduled_task_run.rerun', 'scheduled_task_run.resolve', 'scheduled_task_run.skip'):
        assert f"'{action}'" in admin


def test_guard_accepts_a_business_date_override(tmp_path):
    out = _run(FIXTURE_DIR, tmp_path)
    guard = (out / 'lib/scheduled-tasks/run-guard.ts').read_text()
    assert 'businessDate?: Date;' in guard
    assert 'options.businessDate ?? businessDateOf(now)' in guard


def test_schema_declares_scheduled_tasks_detection():
    assert schema_declares_scheduled_tasks({'x-scheduled-tasks': [{'task_id': 'a'}]})
    assert schema_declares_scheduled_tasks({'definitions': {'w': {'x-scheduled-task': {'task_id': 'a'}}}})
    assert not schema_declares_scheduled_tasks({'definitions': {'w': {'fields': {}}}})
    assert nav_extra_entities({}) == []
    assert nav_extra_entities({'x-scheduled-tasks': [{'task_id': 'a'}]}) == [{'parent': EXTRA_NAV_PARENT}]


def test_nav_link_and_sidebar_key_added_idempotently(tmp_path):
    site_config = tmp_path / 'site-config.ts'
    site_config.write_text('navLinks: [\n    { label: "Home", href: "/" },\n  ] satisfies NavLink[]\n')
    sidebar = tmp_path / 'sidebar.tsx'
    sidebar.write_text('const navTranslationKeys = {\n  "/": "home",\n};\n\nexport default function Sidebar')
    extras = nav_extra_entities({'x-scheduled-tasks': [{'task_id': 'a'}]})
    nav_config = {'entity_group': {}, 'groups': []}
    assert _update_site_config(site_config, extras, nav_config)
    assert _update_sidebar(sidebar, extras)
    assert 'href: "/scheduled_task_run"' in site_config.read_text()
    assert '"/scheduled_task_run": "scheduledTaskRun"' in sidebar.read_text()
    assert not _update_site_config(site_config, extras, nav_config)
    assert not _update_sidebar(sidebar, extras)


def test_messages_namespace_is_complete_for_the_page(tmp_path):
    """Every key the page passes to the table (and the page's own) must exist."""
    page = (REPO_ROOT / 'code_generator/templates/scheduled_task_admin_page.tsx.jinja2').read_text()
    import re
    quoted = set(re.findall(r"'((?:column|status|why|result|confirm)[A-Za-z]+|rerun|resolve|skip|reasonLabel|reasonPlaceholder)'", page))
    quoted |= set(re.findall(r"t\('([A-Za-z]+)'", page))
    missing = quoted - set(SCHEDULED_TASK_RUN_MESSAGES)
    assert not missing, missing
    en = tmp_path / 'en.json'
    en.write_text('{}')
    _update_json(en, {'ScheduledTaskRun': dict(SCHEDULED_TASK_RUN_MESSAGES)})
    assert json.loads(en.read_text())['ScheduledTaskRun']['title'] == 'Scheduled tasks'
