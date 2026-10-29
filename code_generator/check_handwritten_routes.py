#!/usr/bin/env python3
"""
check_handwritten_routes.py -- flag hand-written API routes that write without
a permission check or rate limiting.

`check_generated.py` covers the files the generator writes. A consumer app's
own routes under `app/api/**/route.ts` (custom integrations, bespoke
endpoints) go through neither the entity service layer nor any gate, so a
route can omit both guards unnoticed. This script scans those routes.

A route file is *hand-written* when it is not listed in the generation
manifest (`.generated-manifest.json`) as a regenerated file and does not
carry the `AUTO-GENERATED` marker. A write-once stub counts as hand-written:
the consumer owns it after the first run. A hand-written route *writes* when it exports a `POST`, `PUT`, `PATCH`
or `DELETE` handler, or calls a direct `prisma.<model>.<write>(` method. A
writing route is flagged when its source (comments stripped) lacks either:

1. a permission check -- a call to `requireApiPermission(`, `requireApiRecordPermission(`, `requireEntityPermission(`, `requireRecordPermission(`
   or `requireScheduledTaskRole(`. Authentication alone (`authenticate(`,
   `requireSession(`, ...) answers "who is calling", not "may they do this".
2. rate limiting -- a call to `getRateLimiter(`, the limiter in
   `lib/rate-limit`.

The check is a static, per-file text match, deliberately simple: it does not
follow imports, so a route that delegates both guards to a shared wrapper in
another file must either call the helper in the route itself or be listed in
the allowlist. A match means the call is present, not that it guards the right
operation; review still decides that.

A route that is correct without one of the guards (a public sign-up route, a
token-authenticated refresh, a route whose caller is the signed-in user acting
on their own rows) is listed in `check_handwritten_routes_allowlist.yaml`
(sibling of this script, or the file given with `--allowlist`). Each entry
names the route `path`, the `skip` list (`permission`, `rate-limit`) and a
required `reason`. An entry that no longer matches a flagged route is reported
as stale, so the list cannot drift from the tree.

Usage:
    python check_handwritten_routes.py [<project-root>] [--allowlist <file>]

Exit codes:
    0 -- no violations
    1 -- at least one violation or stale allowlist entry
    2 -- invocation / configuration error
"""
from __future__ import annotations

import json
import re
import sys
from dataclasses import dataclass
from pathlib import Path

import yaml

from manifest import MANIFEST_FILENAME

_GENERATED_MARKER = 'AUTO-GENERATED'
_ALLOWLIST_PATH = Path(__file__).parent / 'check_handwritten_routes_allowlist.yaml'

_HTTP_WRITE_HANDLER = re.compile(
    r'\bexport\s+(?:async\s+)?(?:function\s+|const\s+)(POST|PUT|PATCH|DELETE)\b'
)
_DIRECT_WRITE = re.compile(
    r'\bprisma\.[A-Za-z_]\w*\.(create|update|delete|upsert|createMany|updateMany|deleteMany)\s*\('
)
_PERMISSION_CALL = re.compile(
    r'\b(requireApiPermission|requireApiRecordPermission|requireEntityPermission|requireRecordPermission|requireScheduledTaskRole)\s*\('
)
_RATE_LIMIT_CALL = re.compile(r'\bgetRateLimiter\s*\(')

_GUARDS = {
    'permission': _PERMISSION_CALL,
    'rate-limit': _RATE_LIMIT_CALL,
}


@dataclass(frozen=True)
class Violation:
    path: str
    guard: str  # 'permission' | 'rate-limit'

    def __str__(self) -> str:
        return f'{self.path}: writes but has no {self.guard} check'


def _strip_comments(text: str) -> str:
    text = re.sub(r'/\*.*?\*/', '', text, flags=re.S)
    return re.sub(r'(?m)^\s*//.*$|(?<=\s)//.*$', '', text)


def _manifest_paths(root: Path) -> tuple[set[str], set[str]]:
    """(overwritten, stub) route paths recorded by the last generate-code run.

    A write-once stub is generated once and then owned by the consumer, so it
    counts as hand-written.
    """
    manifest = root / MANIFEST_FILENAME
    if not manifest.is_file():
        return set(), set()
    try:
        data = json.loads(manifest.read_text(encoding='utf-8'))
    except (OSError, ValueError):
        return set(), set()
    overwritten: set[str] = set()
    stubs: set[str] = set()
    for entry in data.get('files', []):
        (stubs if entry.get('mode') == 'stub' else overwritten).add(entry.get('path', ''))
    return overwritten, stubs


def _route_files(root: Path) -> list[Path]:
    api = root / 'app' / 'api'
    return sorted(api.rglob('route.ts')) if api.is_dir() else []


def _load_allowlist(path: Path) -> list[dict]:
    if not path.is_file():
        return []
    data = yaml.safe_load(path.read_text(encoding='utf-8')) or {}
    entries = data.get('exemptions') or []
    for e in entries:
        if not e.get('path') or not e.get('reason'):
            raise ValueError(f'allowlist entry needs `path` and `reason`: {e!r}')
        bad = set(e.get('skip') or []) - set(_GUARDS)
        if not e.get('skip') or bad:
            raise ValueError(f'allowlist entry `skip` must list {sorted(_GUARDS)}: {e!r}')
    return entries


def check(root: Path, allowlist_path: Path = _ALLOWLIST_PATH) -> tuple[list[Violation], list[str]]:
    """Return (violations, stale allowlist paths)."""
    allowlist = _load_allowlist(allowlist_path)
    overwritten, stubs = _manifest_paths(root)
    flagged: list[Violation] = []
    for file in _route_files(root):
        rel = file.relative_to(root).as_posix()
        raw = file.read_text(encoding='utf-8')
        if rel in overwritten or (_GENERATED_MARKER in raw and rel not in stubs):
            continue
        code = _strip_comments(raw)
        if not (_HTTP_WRITE_HANDLER.search(code) or _DIRECT_WRITE.search(code)):
            continue
        for guard, pattern in _GUARDS.items():
            if not pattern.search(code):
                flagged.append(Violation(rel, guard))

    exempt = {(e['path'], g) for e in allowlist for g in e['skip']}
    violations = [v for v in flagged if (v.path, v.guard) not in exempt]
    flagged_keys = {(v.path, v.guard) for v in flagged}
    stale = sorted(f'{p} ({g})' for p, g in exempt if (p, g) not in flagged_keys)
    return violations, stale


def main(argv: list[str]) -> int:
    args = list(argv[1:])
    allowlist = _ALLOWLIST_PATH
    if '--allowlist' in args:
        i = args.index('--allowlist')
        if i + 1 >= len(args):
            print('--allowlist needs a file', file=sys.stderr)
            return 2
        allowlist = Path(args[i + 1])
        del args[i:i + 2]
    if len(args) > 1:
        print(__doc__, file=sys.stderr)
        return 2
    root = Path(args[0] if args else '.').resolve()
    if not (root / 'app' / 'api').is_dir():
        print(f'no app/api directory under {root}', file=sys.stderr)
        return 2
    try:
        violations, stale = check(root, allowlist)
    except (ValueError, yaml.YAMLError) as e:
        print(f'bad allowlist: {e}', file=sys.stderr)
        return 2
    for v in violations:
        print(v)
    for s in stale:
        print(f'stale allowlist entry (no longer flagged): {s}')
    if violations or stale:
        print(f'check_handwritten_routes: {len(violations)} violation(s), {len(stale)} stale entr(ies)')
        return 1
    print('check_handwritten_routes: OK')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
