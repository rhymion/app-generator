#!/usr/bin/env python3
"""
egress_ledger.py -- build the generated part of docs/knowledge/data-egress-ledger.md (Issue #1240).

The ledger has one row per (protected data class, outbound route). The HTTP rows are derived mechanically:

- every `GET` operation of the OpenAPI document the generator writes for the default schema
  (`docs/generated/openapi.json`); its class comes from `openapi_prefixes` in `egress_ledger_classes.yaml`
  (longest matching path prefix), else `openapi_default`. Write operations answer with ids and status only and are
  not listed;
- every other `app/api/**/route.ts`: the generated routes the OpenAPI document does not describe (attachment
  download, search, upload, ...) and the hand-written routes tracked in this repository. Each needs an entry under
  `routes` in the classes file (`classes`, `data`); an entry with `classes: []` records a route that releases no
  protected data, with the reason in `data`.

A route with no entry, or an entry for a route that no longer exists, is an error: adding an outbound route forces a
decision about what it releases. The non-HTTP routes (logs, storage backends, third-party services) are written by
hand in the same page, outside the generated block.

Usage:
    python code_generator/egress_ledger.py --check   # exit 1 when the block in the ledger is out of date
    python code_generator/egress_ledger.py --write   # rewrite the block
"""
from __future__ import annotations

import contextlib
import io
import json
import re
import subprocess
import sys
import tempfile
import warnings
from pathlib import Path

import yaml

HERE = Path(__file__).resolve().parent
REPO = HERE.parent
CLASSES_PATH = HERE / 'egress_ledger_classes.yaml'
LEDGER_PATH = REPO / 'docs' / 'knowledge' / 'data-egress-ledger.md'
BEGIN = '<!-- BEGIN GENERATED: egress-ledger (python code_generator/egress_ledger.py --write) -->'
END = '<!-- END GENERATED: egress-ledger -->'

CLASS_LABELS = {
    'secret': 'Secret',
    'personal': 'Personal data',
    'business': 'Business data',
    'operational': 'Operational record',
}
_HTTP_METHODS = ('GET', 'POST', 'PUT', 'PATCH', 'DELETE')
_EXPORTED_HANDLER = re.compile(r'\bexport\s+(?:async\s+)?(?:function|const)\s+(GET|POST|PUT|PATCH|DELETE)\b')
_EXPORTED_DESTRUCTURED = re.compile(r'\bexport\s+const\s*\{([^}]*)\}')


class LedgerError(Exception):
    pass


def load_classes(path: Path = CLASSES_PATH) -> dict:
    data = yaml.safe_load(path.read_text(encoding='utf-8')) or {}
    for key in ('openapi_default', 'openapi_prefixes', 'routes'):
        if key not in data:
            raise LedgerError(f'{path.name}: missing `{key}`')
    known = set(CLASS_LABELS)
    if data['openapi_default'] not in known:
        raise LedgerError(f'{path.name}: openapi_default must be one of {sorted(known)}')
    for prefix, cls in data['openapi_prefixes'].items():
        if cls not in known:
            raise LedgerError(f'{path.name}: openapi_prefixes[{prefix}] must be one of {sorted(known)}')
    for route, entry in data['routes'].items():
        if not isinstance(entry, dict) or 'classes' not in entry or not (entry.get('data') or '').strip():
            raise LedgerError(f'{path.name}: routes[{route}] needs `classes` and `data`')
        bad = set(entry['classes']) - known
        if bad:
            raise LedgerError(f'{path.name}: routes[{route}] has unknown classes {sorted(bad)}')
    return data


def route_methods(source: str) -> list[str]:
    found = set(_EXPORTED_HANDLER.findall(source))
    for group in _EXPORTED_DESTRUCTURED.findall(source):
        found |= {name.strip() for name in group.split(',')} & set(_HTTP_METHODS)
    return [m for m in _HTTP_METHODS if m in found]


def _segments_match(pattern: str, path: str) -> bool:
    """`*` matches exactly one path segment; everything else is literal (route paths contain `[id]`)."""
    p, s = pattern.split('/'), path.split('/')
    return len(p) == len(s) and all(a == '*' or a == b for a, b in zip(p, s))


def _route_entry(classes: dict, route: str) -> tuple[str, dict] | None:
    exact = classes['routes'].get(route)
    if exact is not None:
        return route, exact
    for pattern, entry in classes['routes'].items():
        if '*' in pattern and _segments_match(pattern, route):
            return pattern, entry
    return None


def _openapi_class(classes: dict, path: str) -> str:
    best = ''
    for prefix in classes['openapi_prefixes']:
        if (path == prefix or path.startswith(prefix.rstrip('/') + '/')) and len(prefix) > len(best):
            best = prefix
    return classes['openapi_prefixes'][best] if best else classes['openapi_default']


def _openapi_route_file(path: str) -> str:
    """`/api/user/{id}` -> `app/api/user/[id]/route.ts`."""
    return 'app' + re.sub(r'\{([^}]+)\}', r'[\1]', path) + '/route.ts'


def generate_default_app(out: Path) -> None:
    """Run the generator on the repository's default schema into `out`."""
    sys.path.insert(0, str(HERE))
    from build_user_schema import build_user_schema  # noqa: E402
    from generate import generate  # noqa: E402

    (out / 'prisma').mkdir(parents=True, exist_ok=True)
    prisma = REPO / 'prisma' / 'schema.prisma'
    (out / 'prisma' / 'schema.prisma').write_text(prisma.read_text(encoding='utf-8'), encoding='utf-8')
    built = out / 'generated_json_schema.yaml'
    with contextlib.redirect_stdout(io.StringIO()), warnings.catch_warnings():
        warnings.simplefilter('ignore')  # schema lint warnings belong to generate-code, not to the ledger
        build_user_schema(HERE / 'json_schema.yaml', prisma, built)
        generate(str(built), str(out))


def _tracked_routes() -> dict[str, str]:
    out = subprocess.run(['git', 'ls-files', '--', 'app/api'], cwd=REPO, capture_output=True, text=True, check=True)
    return {rel: (REPO / rel).read_text(encoding='utf-8')
            for rel in out.stdout.splitlines() if rel.endswith('/route.ts')}


def collect_rows(generated_root: Path, classes: dict, tracked_routes: dict[str, str] | None = None) -> list[dict]:
    """Rows for the generated block. Raises LedgerError on an unclassified or stale route entry."""
    doc = json.loads((generated_root / 'docs' / 'generated' / 'openapi.json').read_text(encoding='utf-8'))
    rows: list[dict] = []
    openapi_files: set[str] = set()
    for path, item in doc.get('paths', {}).items():
        openapi_files.add(_openapi_route_file(path))
        op = item.get('get')
        if isinstance(op, dict):
            rows.append({'class': _openapi_class(classes, path), 'route': f'GET {path}', 'source': 'OpenAPI',
                         'data': op.get('summary') or ''})

    routes: dict[str, tuple[str, str]] = {}
    api = generated_root / 'app' / 'api'
    for f in sorted(api.rglob('route.ts')) if api.is_dir() else []:
        routes[f.relative_to(generated_root).as_posix()] = ('generated', f.read_text(encoding='utf-8'))
    for rel, text in (tracked_routes if tracked_routes is not None else _tracked_routes()).items():
        routes[rel] = ('hand-written', text)

    used: set[str] = set()
    missing: list[str] = []
    for rel in sorted(routes):
        if rel in openapi_files:
            continue
        source, text = routes[rel]
        hit = _route_entry(classes, rel)
        if hit is None:
            missing.append(rel)
            continue
        key, entry = hit
        used.add(key)
        methods = '/'.join(route_methods(text)) or '-'
        url = '/' + rel[len('app/'):-len('/route.ts')]
        for cls in entry['classes']:
            rows.append({'class': cls, 'route': f'{methods} {url}', 'source': source, 'data': entry['data'].strip()})
    stale = sorted(set(classes['routes']) - used)
    problems = []
    if missing:
        problems.append('routes with no entry in egress_ledger_classes.yaml (add `classes` and `data`): '
                        + ', '.join(missing))
    if stale:
        problems.append('entries in egress_ledger_classes.yaml that match no route: ' + ', '.join(stale))
    if problems:
        raise LedgerError('\n'.join(problems))
    order = list(CLASS_LABELS)
    return sorted(rows, key=lambda r: (order.index(r['class']), r['route']))


def render_block(rows: list[dict]) -> str:
    def cell(text: str) -> str:
        return text.replace('|', '\\|').replace('\n', ' ')

    lines = [BEGIN, '', '| Class | Route | Source | What leaves |', '|-------|-------|--------|-------------|']
    lines += [f"| {CLASS_LABELS[r['class']]} | `{cell(r['route'])}` | {r['source']} | {cell(r['data'])} |" for r in rows]
    lines += ['', END]
    return '\n'.join(lines)


def build_block() -> str:
    classes = load_classes()
    with tempfile.TemporaryDirectory(prefix='egress-ledger-') as tmp:
        generate_default_app(Path(tmp))
        return render_block(collect_rows(Path(tmp), classes))


def current_block(text: str) -> str:
    if BEGIN not in text or END not in text:
        raise LedgerError(f'{LEDGER_PATH.name}: generated block markers not found')
    return text[text.index(BEGIN):text.index(END) + len(END)]


def main(argv: list[str]) -> int:
    mode = argv[1] if len(argv) > 1 else '--check'
    if mode not in ('--check', '--write'):
        print(__doc__, file=sys.stderr)
        return 2
    try:
        block = build_block()
        text = LEDGER_PATH.read_text(encoding='utf-8')
        old = current_block(text)
    except LedgerError as e:
        print(f'egress_ledger: {e}', file=sys.stderr)
        return 1
    if mode == '--write':
        LEDGER_PATH.write_text(text.replace(old, block), encoding='utf-8')
        print(f'egress_ledger: wrote {LEDGER_PATH.relative_to(REPO)}')
        return 0
    if old != block:
        print('egress_ledger: the generated block is out of date; run python code_generator/egress_ledger.py --write',
              file=sys.stderr)
        return 1
    print('egress_ledger: OK')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
