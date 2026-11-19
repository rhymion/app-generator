"""
The generated block of docs/knowledge/data-egress-ledger.md is up to date, and every API route has a data-class
entry (Issue #1240). See code_generator/egress_ledger.py.
"""
import json
from pathlib import Path

import pytest

import egress_ledger as el


@pytest.fixture(scope='module')
def default_app(tmp_path_factory) -> Path:
    out = tmp_path_factory.mktemp('egress_ledger')
    el.generate_default_app(out)
    return out


def test_generated_block_is_up_to_date(default_app):
    expected = el.render_block(el.collect_rows(default_app, el.load_classes()))
    current = el.current_block(el.LEDGER_PATH.read_text(encoding='utf-8'))
    assert current == expected, 'run: python code_generator/egress_ledger.py --write'


def test_ledger_lists_the_personal_and_secret_routes(default_app):
    rows = el.collect_rows(default_app, el.load_classes())
    by_class = {}
    for r in rows:
        by_class.setdefault(r['class'], set()).add(r['route'])
    assert 'GET /api/user' in by_class['personal']
    assert 'GET /api/user/export' in by_class['personal']
    assert 'GET /api/attachments/[id]' in by_class['personal']
    assert 'POST /api/mobile/auth/refresh' in by_class['secret']
    assert 'GET /api/role' in by_class['business']


def _fake_app(root: Path, routes: dict[str, str], paths: dict) -> Path:
    (root / 'docs' / 'generated').mkdir(parents=True)
    (root / 'docs' / 'generated' / 'openapi.json').write_text(json.dumps({'paths': paths}))
    for rel, body in routes.items():
        f = root / rel
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_text(body)
    return root


CLASSES = {
    'openapi_default': 'business',
    'openapi_prefixes': {'/api/person': 'personal'},
    'routes': {'app/api/*/[id]/capabilities/route.ts': {'classes': [], 'data': 'flags only'}},
}


def test_openapi_get_operations_get_their_class_by_prefix(tmp_path):
    app = _fake_app(tmp_path, {}, {
        '/api/person': {'get': {'summary': 'List person'}, 'post': {'summary': 'Create'}},
        '/api/personnel': {'get': {'summary': 'List personnel'}},
        '/api/widget/{id}': {'get': {'summary': 'Get widget'}},
    })
    rows = el.collect_rows(app, {**CLASSES, 'routes': {}}, tracked_routes={})
    assert [(r['class'], r['route']) for r in rows] == [
        ('personal', 'GET /api/person'),
        ('business', 'GET /api/personnel'),
        ('business', 'GET /api/widget/{id}'),
    ]


def test_a_route_without_an_entry_fails(tmp_path):
    app = _fake_app(tmp_path, {'app/api/widget/[id]/capabilities/route.ts': 'export async function GET() {}'}, {})
    with pytest.raises(el.LedgerError, match='app/api/custom/route.ts'):
        el.collect_rows(app, CLASSES, tracked_routes={'app/api/custom/route.ts': 'export async function GET() {}'})


def test_an_entry_that_matches_no_route_fails(tmp_path):
    app = _fake_app(tmp_path, {}, {})
    with pytest.raises(el.LedgerError, match='match no route'):
        el.collect_rows(app, CLASSES, tracked_routes={})


def test_routes_described_by_openapi_need_no_entry(tmp_path):
    app = _fake_app(tmp_path, {
        'app/api/widget/route.ts': 'export async function GET() {}',
        'app/api/widget/[id]/route.ts': 'export async function GET() {}',
        'app/api/widget/[id]/capabilities/route.ts': 'export async function GET() {}',
    }, {'/api/widget': {'get': {}}, '/api/widget/{id}': {'get': {}}})
    assert len(el.collect_rows(app, CLASSES, tracked_routes={})) == 2


def test_a_route_releasing_nothing_adds_no_row_and_one_with_two_classes_adds_two(tmp_path):
    classes = {**CLASSES, 'routes': {**CLASSES['routes'],
                                     'app/api/files/route.ts': {'classes': ['business', 'personal'], 'data': 'files'}}}
    app = _fake_app(tmp_path, {'app/api/widget/[id]/capabilities/route.ts': 'export async function GET() {}'}, {})
    rows = el.collect_rows(app, classes, tracked_routes={'app/api/files/route.ts': 'export const { GET, POST } = h;'})
    assert [(r['class'], r['route'], r['source']) for r in rows] == [
        ('personal', 'GET/POST /api/files', 'hand-written'),
        ('business', 'GET/POST /api/files', 'hand-written'),
    ]


@pytest.mark.parametrize('bad', [
    {'openapi_default': 'nope', 'openapi_prefixes': {}, 'routes': {}},
    {'openapi_default': 'business', 'openapi_prefixes': {'/api/x': 'nope'}, 'routes': {}},
    {'openapi_default': 'business', 'openapi_prefixes': {}, 'routes': {'app/api/x/route.ts': {'classes': []}}},
    {'openapi_default': 'business', 'openapi_prefixes': {}, 'routes': {'app/api/x/route.ts': {'classes': ['x'], 'data': 'd'}}},
])
def test_classes_file_is_validated(tmp_path, bad):
    import yaml
    p = tmp_path / 'c.yaml'
    p.write_text(yaml.safe_dump(bad))
    with pytest.raises(el.LedgerError):
        el.load_classes(p)


def test_pull_request_template_asks_for_a_ledger_row():
    template = (el.REPO / '.github' / 'pull_request_template.md').read_text(encoding='utf-8')
    assert 'docs/knowledge/data-egress-ledger.md' in template
