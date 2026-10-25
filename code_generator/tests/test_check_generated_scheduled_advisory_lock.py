"""check_generated.py against the scheduled-task service the generator really emits.

The default schema declares no `x-scheduled-task` entity, so `npm run
check:generated` in this repo never saw the advisory lock that
service_scheduled.ts.jinja2 emits (`tx.$executeRaw`...`), and the first
consumer that declared a scheduled task failed the check. These tests render
the real templates and run the real checker with the real allowlist, so a
template change that adds raw SQL without an allowlist entry fails here.
"""
from __future__ import annotations

from pathlib import Path
from textwrap import dedent

import pytest
from jinja2 import Environment, FileSystemLoader

from check_generated import check, _load_allowlist
from helpers.naming import to_camel_case, to_pascal_case

_TEMPLATES = Path(__file__).parent.parent / 'templates'

_SCHEMA = dedent("""
    $schema: "http://json-schema.org/draft-07/schema#"
    x-scheduled-tasks:
      - task_id: demo_reset
        handler: resetDemo
        interval: "0 3 * * *"
    definitions:
      __widget:
        type: object
        required: [id, name]
        properties:
          id:
            type: string
            pattern: "^c[a-z0-9]{24,}$"
          name:
            type: string
        x-generate:
          list: true
          view: true
          new: true
          edit: true
          delete: true
          api: true
        x-scheduled-task:
          task_id: widget_timeout
          handler: afterTimeout
          interval: "0 * * * *"
          filter:
            status_in: ["pending"]
""").lstrip()

_ENTITY_CTX = {
    'snake_name': 'widget',
    'pascal_name': 'Widget',
    'task_id': 'widget_timeout',
    'handler': 'afterTimeout',
    'interval': '0 * * * *',
    'expires_at_before_now': False,
    'status_in': ['pending'],
    'module_path': 'widget',
    'run_name': 'widgetRun',
}

_BULK_CTX = {
    'task_id': 'demo_reset',
    'handler': 'resetDemo',
    'interval': '0 3 * * *',
    'module_path': 'scheduled-tasks/demo_reset',
    'run_name': 'demoResetRun',
}


def _render(template: str, ctx: dict) -> str:
    env = Environment(
        loader=FileSystemLoader(_TEMPLATES),
        trim_blocks=True,
        lstrip_blocks=True,
        keep_trailing_newline=True,
    )
    env.filters['pascal_case'] = to_pascal_case
    env.filters['camel_case'] = to_camel_case
    return env.get_template(template).render(**ctx)


def _make_tree(tmp_path: Path) -> Path:
    schema = tmp_path / 'json_schema.yaml'
    schema.write_text(_SCHEMA)
    for rel, template, ctx in (
        ('lib/widget/service_scheduled.ts', 'service_scheduled.ts.jinja2', _ENTITY_CTX),
        ('lib/scheduled-tasks/demo_reset/service_scheduled.ts',
         'service_scheduled_bulk.ts.jinja2', _BULK_CTX),
    ):
        path = tmp_path / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(_render(template, ctx))
    return schema


def test_rendered_scheduled_services_pass_with_the_real_allowlist(tmp_path: Path) -> None:
    schema = _make_tree(tmp_path)
    assert check(schema, tmp_path) == []


def test_rendered_entity_service_really_contains_the_advisory_lock(tmp_path: Path) -> None:
    # Guards the test above against passing vacuously: if the template stopped
    # emitting raw SQL, the exemption below would be dead weight.
    schema = _make_tree(tmp_path)
    text = (tmp_path / 'lib/widget/service_scheduled.ts').read_text()
    assert 'tx.$executeRaw`SELECT pg_advisory_xact_lock(' in text
    violations = check(schema, tmp_path, _empty_allowlist(tmp_path))
    assert [(v.path, v.rule) for v in violations] == [('lib/widget/service_scheduled.ts', 'raw:executeRaw')]


def _empty_allowlist(tmp_path: Path) -> Path:
    path = tmp_path / 'empty_allowlist.yaml'
    path.write_text('exemptions: []\n')
    return path


def test_real_allowlist_entry_is_scoped_to_the_lock_statement(tmp_path: Path) -> None:
    schema = _make_tree(tmp_path)
    service = tmp_path / 'lib/widget/service_scheduled.ts'
    service.write_text(service.read_text() + "\nawait tx.$executeRaw`DELETE FROM widget`;\n")
    violations = check(schema, tmp_path)
    assert [(v.path, v.rule) for v in violations] == [('lib/widget/service_scheduled.ts', 'raw:executeRaw')]
    assert 'DELETE FROM widget' in violations[0].snippet


def test_scheduled_lock_exemption_does_not_cover_other_directories(tmp_path: Path) -> None:
    schema = _make_tree(tmp_path)
    bulk = tmp_path / 'lib/scheduled-tasks/demo_reset/service_scheduled.ts'
    bulk.write_text(
        bulk.read_text()
        + "\nawait tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${row.id}, 0))`;\n"
    )
    violations = check(schema, tmp_path)
    assert [v.path for v in violations] == ['lib/scheduled-tasks/demo_reset/service_scheduled.ts']


def test_path_glob_star_does_not_cross_directories(tmp_path: Path) -> None:
    allow = tmp_path / 'allowlist.yaml'
    allow.write_text(dedent("""
        exemptions:
          - path_glob: lib/*/service_scheduled.ts
            pattern: raw:executeRaw
            substring: "pg_advisory_xact_lock"
            reason: test
    """).lstrip())
    schema = _make_tree(tmp_path)
    nested = tmp_path / 'lib/scheduled-tasks/demo_reset/service_scheduled.ts'
    nested.write_text("await tx.$executeRaw`SELECT pg_advisory_xact_lock(1)`;\n")
    assert [v.path for v in check(schema, tmp_path, allow)] == [
        'lib/scheduled-tasks/demo_reset/service_scheduled.ts'
    ]


@pytest.mark.parametrize('entry', [
    {'pattern': 'raw:executeRaw', 'substring': 'x', 'reason': 'r'},
    {'path': 'a.ts', 'path_glob': 'lib/*/a.ts', 'pattern': 'raw:executeRaw', 'substring': 'x', 'reason': 'r'},
])
def test_allowlist_entry_needs_exactly_one_of_path_or_path_glob(tmp_path: Path, entry: dict) -> None:
    import yaml
    allow = tmp_path / 'allowlist.yaml'
    allow.write_text(yaml.safe_dump({'exemptions': [entry]}))
    with pytest.raises(SystemExit):
        _load_allowlist(allow)
