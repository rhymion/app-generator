"""Tests for generate.py's `_write_vercel_json_crons` (cmd_781) -- the
generator-owned `crons` key inside the otherwise hand-authored vercel.json.
"""
import json
from pathlib import Path

from generate import _write_vercel_json_crons, _VERCEL_JSON_DEFAULTS


_ENTITY_A = {
    'snake_name': 'inventory_reservation',
    'task_id': 'inventory_reservation_expire',
    'interval': '*/15 * * * *',
}
_ENTITY_B = {
    'snake_name': 'approval_request',
    'task_id': 'approval_request_timeout_release',
    'interval': '0 * * * *',
}


def test_writes_crons_into_existing_file_preserving_other_keys(tmp_path):
    path = tmp_path / 'vercel.json'
    path.write_text(json.dumps({
        '$schema': 'https://openapi.vercel.sh/vercel.json',
        'framework': 'nextjs',
        'buildCommand': 'npm run vercel-build',
        'regions': ['sin1'],
    }), encoding='utf-8')

    _write_vercel_json_crons(path, [_ENTITY_A])

    data = json.loads(path.read_text(encoding='utf-8'))
    assert data['framework'] == 'nextjs'
    assert data['buildCommand'] == 'npm run vercel-build'
    assert data['regions'] == ['sin1']
    assert data['crons'] == [
        {'path': '/api/scheduled-tasks/inventory_reservation_expire', 'schedule': '*/15 * * * *'},
    ]


def test_multiple_entities_produce_multiple_cron_entries(tmp_path):
    path = tmp_path / 'vercel.json'
    path.write_text(json.dumps(dict(_VERCEL_JSON_DEFAULTS)), encoding='utf-8')

    _write_vercel_json_crons(path, [_ENTITY_A, _ENTITY_B])

    data = json.loads(path.read_text(encoding='utf-8'))
    assert len(data['crons']) == 2
    paths = {c['path'] for c in data['crons']}
    assert paths == {
        '/api/scheduled-tasks/inventory_reservation_expire',
        '/api/scheduled-tasks/approval_request_timeout_release',
    }


def test_no_entities_removes_crons_key(tmp_path):
    """A task_id removed from the schema must also disappear from
    vercel.json -- crons is fully replaced, not merged, each run."""
    path = tmp_path / 'vercel.json'
    path.write_text(json.dumps({
        **_VERCEL_JSON_DEFAULTS,
        'crons': [{'path': '/api/scheduled-tasks/stale_task', 'schedule': '0 0 * * *'}],
    }), encoding='utf-8')

    _write_vercel_json_crons(path, [])

    data = json.loads(path.read_text(encoding='utf-8'))
    assert 'crons' not in data
    assert data['framework'] == 'nextjs'


def test_missing_file_created_with_defaults(tmp_path):
    """Fixture/test output dirs that never had a vercel.json (unlike the
    real app-generator repo, where the file is tracked) still get a valid
    one."""
    path = tmp_path / 'vercel.json'
    assert not path.exists()

    _write_vercel_json_crons(path, [_ENTITY_A])

    data = json.loads(path.read_text(encoding='utf-8'))
    assert data['framework'] == 'nextjs'
    assert data['crons'] == [
        {'path': '/api/scheduled-tasks/inventory_reservation_expire', 'schedule': '*/15 * * * *'},
    ]


def test_unchanged_content_is_not_rewritten(tmp_path):
    path = tmp_path / 'vercel.json'
    initial = dict(_VERCEL_JSON_DEFAULTS)
    initial['crons'] = [
        {'path': '/api/scheduled-tasks/inventory_reservation_expire', 'schedule': '*/15 * * * *'},
    ]
    path.write_text(json.dumps(initial, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
    mtime_before = path.stat().st_mtime_ns

    _write_vercel_json_crons(path, [_ENTITY_A])

    assert path.stat().st_mtime_ns == mtime_before
