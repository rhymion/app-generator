"""Tests for code_generator/check_handwritten_routes.py."""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from check_handwritten_routes import _ALLOWLIST_PATH, check, main

_GUARDED = """
import { requireApiPermission } from '@/lib/api-auth';
import { getRateLimiter } from '@/lib/rate-limit';
export async function POST(request) {
  await requireApiPermission(userId, 'widget', 'create');
  await getRateLimiter().check('api:write', userId);
}
"""


def _route(root: Path, rel: str, body: str) -> None:
    f = root / rel
    f.parent.mkdir(parents=True, exist_ok=True)
    f.write_text(body)


def _flags(root: Path, allowlist: Path | None = None):
    violations, stale = check(root, allowlist or root / 'none.yaml')
    return sorted((v.path, v.guard) for v in violations), stale


def test_guarded_write_route_passes(tmp_path):
    _route(tmp_path, 'app/api/custom/route.ts', _GUARDED)
    assert _flags(tmp_path) == ([], [])


def test_write_without_guards_is_flagged_for_each(tmp_path):
    _route(tmp_path, 'app/api/custom/route.ts',
           "export async function POST() { return Response.json({}); }")
    assert _flags(tmp_path)[0] == [
        ('app/api/custom/route.ts', 'permission'),
        ('app/api/custom/route.ts', 'rate-limit'),
    ]


def test_authentication_alone_is_not_a_permission_check(tmp_path):
    _route(tmp_path, 'app/api/custom/route.ts',
           "import { getRateLimiter } from '@/lib/rate-limit';\n"
           "export async function PUT(r) { await requireCaller(r); await getRateLimiter().check('a', 'b'); }")
    assert _flags(tmp_path)[0] == [('app/api/custom/route.ts', 'permission')]


def test_read_only_route_is_ignored(tmp_path):
    _route(tmp_path, 'app/api/custom/route.ts',
           "export async function GET() { return prisma.widget.findMany(); }")
    assert _flags(tmp_path) == ([], [])


def test_direct_prisma_write_in_a_get_handler_is_a_write(tmp_path):
    _route(tmp_path, 'app/api/custom/route.ts',
           "export async function GET() { await prisma.widget.deleteMany({}); }")
    assert len(_flags(tmp_path)[0]) == 2


def test_guard_names_in_comments_do_not_count(tmp_path):
    _route(tmp_path, 'app/api/custom/route.ts',
           "// requireApiPermission( getRateLimiter(\n"
           "/* requirePermission( */\n"
           "export async function POST() {}")
    assert len(_flags(tmp_path)[0]) == 2


def test_const_handler_form_is_detected(tmp_path):
    _route(tmp_path, 'app/api/custom/route.ts', "export const DELETE = async () => null;")
    assert len(_flags(tmp_path)[0]) == 2


def test_generated_routes_are_skipped_by_marker_and_by_manifest(tmp_path):
    bare = "export async function POST() {}"
    _route(tmp_path, 'app/api/marked/route.ts', "// AUTO-GENERATED - DO NOT EDIT\n" + bare)
    _route(tmp_path, 'app/api/listed/route.ts', bare)
    (tmp_path / '.generated-manifest.json').write_text(json.dumps({
        'files': [{'path': 'app/api/listed/route.ts', 'mode': 'overwrite'}]}))
    assert _flags(tmp_path) == ([], [])


def test_write_once_stub_counts_as_hand_written(tmp_path):
    _route(tmp_path, 'app/api/stub/route.ts',
           "// AUTO-GENERATED stub\nexport async function POST() {}")
    (tmp_path / '.generated-manifest.json').write_text(json.dumps({
        'files': [{'path': 'app/api/stub/route.ts', 'mode': 'stub'}]}))
    assert len(_flags(tmp_path)[0]) == 2


def test_allowlist_exempts_only_listed_guards_and_reports_stale(tmp_path):
    _route(tmp_path, 'app/api/custom/route.ts', "export async function POST() {}")
    allow = tmp_path / 'allow.yaml'
    allow.write_text(
        "exemptions:\n"
        "  - {path: app/api/custom/route.ts, skip: [permission], reason: test}\n"
        "  - {path: app/api/gone/route.ts, skip: [permission], reason: test}\n")
    violations, stale = _flags(tmp_path, allow)
    assert violations == [('app/api/custom/route.ts', 'rate-limit')]
    assert stale == ['app/api/gone/route.ts (permission)']


@pytest.mark.parametrize('entry', [
    "{path: a, skip: [permission]}",             # no reason
    "{path: a, skip: [bogus], reason: x}",       # unknown guard
    "{path: a, reason: x}",                      # no skip
])
def test_malformed_allowlist_entry_is_rejected(tmp_path, entry):
    allow = tmp_path / 'allow.yaml'
    allow.write_text(f"exemptions:\n  - {entry}\n")
    with pytest.raises(ValueError):
        check(tmp_path, allow)


def test_main_exit_codes(tmp_path, capsys):
    assert main(['x', str(tmp_path)]) == 2  # no app/api
    _route(tmp_path, 'app/api/custom/route.ts', "export async function POST() {}")
    assert main(['x', str(tmp_path), '--allowlist', str(tmp_path / 'n.yaml')]) == 1
    _route(tmp_path, 'app/api/custom/route.ts', _GUARDED)
    assert main(['x', str(tmp_path), '--allowlist', str(tmp_path / 'n.yaml')]) == 0


def test_repository_routes_pass_with_shipped_allowlist():
    repo = Path(__file__).resolve().parents[2]
    violations, stale = check(repo, _ALLOWLIST_PATH)
    assert not violations, [str(v) for v in violations]
    assert not stale, stale
