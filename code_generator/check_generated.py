#!/usr/bin/env python3
"""
check_generated.py — Post-generation guard against low-level constraint bypass.

Walks the files the generator would have written for the current schema
(see cleanup.py for the same enumeration) and flags two classes of
violation:

1. Any `prisma.$queryRaw*` / `prisma.$executeRaw*` use. These bypass the
   Prisma query builder and trade type-safety + the implicit role/permission
   conventions the service layer enforces for raw SQL.

2. Direct `prisma.<model>.{create,update,delete,upsert,createMany,
   updateMany,deleteMany}` calls anywhere *outside* the entity's service
   layer (`lib/<entity>/{service,service_validation,service_after_create}.ts`).
   API routes, server actions, and pages have to route writes through the
   service so authorization, audit-log emission, and FK-cascade rules stay
   in one place. Reads (`findMany`, `findUnique`, `findFirst`, `count`, …)
   are unaffected — callers legitimately query for permission checks before
   delegating to the service.

`app/generated/` is intentionally excluded: that tree is produced by
`prisma generate` and contains the client-internal definitions of the
banned methods. Hand edits there would be caught by code review.

A YAML allowlist (`check_generated_allowlist.yaml`, sibling of this
script) lets reviewers exempt specific (path, pattern, substring)
combinations. Each entry must record a reason so the carve-out is
auditable. Entries are matched literally; no globs.

Usage:
    python check_generated.py <schema.yaml> <project-root>

Exit codes:
    0 — no violations
    1 — at least one violation
    2 — invocation / configuration error
"""
from __future__ import annotations

import re
import sys
from dataclasses import dataclass
from pathlib import Path

import yaml

from generate_types import extract_entities


# ---------------------------------------------------------------------------
# Rules
# ---------------------------------------------------------------------------

# Patterns banned anywhere in generator-emitted code.
_RAW_PATTERNS = [
    ('raw:queryRaw',         re.compile(r'\bprisma\.\$queryRaw\b')),
    ('raw:executeRaw',       re.compile(r'\bprisma\.\$executeRaw\b')),
    ('raw:queryRawUnsafe',   re.compile(r'\bprisma\.\$queryRawUnsafe\b')),
    ('raw:executeRawUnsafe', re.compile(r'\bprisma\.\$executeRawUnsafe\b')),
]

# Mutating delegate methods. Matches `prisma.<model>.<method>(` so we don't
# trip on identifiers like `myCreate` or string literals containing the word.
_WRITE_METHODS = ('create', 'update', 'delete', 'upsert',
                  'createMany', 'updateMany', 'deleteMany')
_DIRECT_WRITE = re.compile(
    r'\bprisma\.[A-Za-z_][A-Za-z0-9_]*\.(' + '|'.join(_WRITE_METHODS) + r')\s*\('
)

# Files where direct Prisma writes are legitimate (the service layer
# itself). Paths are relative to <project-root>/lib/<entity>/.
_SERVICE_LAYER_FILENAMES = frozenset({
    'service.ts',
    'service_validation.ts',
    'service_after_create.ts',
})

_ALLOWLIST_PATH = Path(__file__).parent / 'check_generated_allowlist.yaml'


@dataclass(frozen=True)
class Violation:
    path: str          # POSIX-style, relative to project root
    line: int
    column: int
    rule: str          # 'raw:queryRaw' | 'raw:executeRaw' | 'write:direct'
    snippet: str       # one-line context

    def render(self) -> str:
        return f'{self.path}:{self.line}:{self.column}  [{self.rule}]  {self.snippet}'


# ---------------------------------------------------------------------------
# File enumeration (mirrors cleanup.py)
# ---------------------------------------------------------------------------

def _generated_files_for_entity(entity: dict, root: Path) -> list[Path]:
    parent  = entity['parent']
    gen_cfg = entity.get('generate_config', {})
    children = entity.get('children', [])

    can_list   = gen_cfg.get('list', True)
    can_view   = gen_cfg.get('view', True)
    can_new    = gen_cfg.get('new', True)
    can_edit   = gen_cfg.get('edit', True)
    can_delete = gen_cfg.get('delete', True)
    can_api    = gen_cfg.get('api', False)

    lib_dir        = root / 'lib'        / parent
    components_dir = root / 'components' / parent
    app_dir        = root / 'app' / '[locale]' / parent
    api_dir        = root / 'app' / 'api' / parent

    files: list[Path] = []

    # lib/
    files.append(lib_dir / 'types.ts')
    files.append(lib_dir / 'getters.ts')
    files.append(lib_dir / 'chart-getters.ts')
    if can_new or can_edit or can_delete:
        files.append(lib_dir / 'service.ts')
        files.append(lib_dir / 'actions.ts')
        files.append(lib_dir / 'service_validation.ts')
    if can_new:
        files.append(lib_dir / 'service_after_create.ts')

    # components/
    if can_new or can_edit:
        files.append(components_dir / 'FormUpsert.tsx')
        files.append(components_dir / 'form_validation.ts')
    if can_view:
        files.append(components_dir / 'FormView.tsx')
    if children and (can_view or can_edit):
        files.append(components_dir / 'column_def.tsx')

    # app/[locale]/<entity>/
    if can_list:
        files.append(app_dir / 'page.tsx')
        files.append(app_dir / 'chart' / 'page.tsx')
    if can_new:
        files.append(app_dir / 'new' / 'page.tsx')
    if can_edit:
        files.append(app_dir / 'edit' / '[id]' / 'page.tsx')
    if can_view:
        files.append(app_dir / 'view' / '[id]' / 'page.tsx')

    # app/api/<entity>/
    if can_api:
        files.append(api_dir / 'route.ts')
        files.append(api_dir / '[id]' / 'route.ts')
        files.append(api_dir / 'bulk' / 'route.ts')

    return files


def _enumerate_generated_files(schema_path: Path, root: Path) -> list[Path]:
    with open(schema_path, 'r') as f:
        schema = yaml.safe_load(f)
    entities = extract_entities(schema)
    out: list[Path] = []
    seen: set[Path] = set()
    for entity in entities:
        for p in _generated_files_for_entity(entity, root):
            if p in seen:
                continue
            seen.add(p)
            if p.exists():
                out.append(p)
    return out


# ---------------------------------------------------------------------------
# Allowlist
# ---------------------------------------------------------------------------

def _load_allowlist(path: Path = _ALLOWLIST_PATH) -> list[dict]:
    if not path.exists():
        return []
    with open(path, 'r') as f:
        data = yaml.safe_load(f) or {}
    entries = data.get('exemptions', []) or []
    for i, entry in enumerate(entries):
        for field in ('path', 'pattern', 'substring', 'reason'):
            if field not in entry:
                raise SystemExit(
                    f'{path}: exemptions[{i}] missing required field {field!r}'
                )
    return entries


def _is_exempt(v: Violation, source_line: str, allowlist: list[dict]) -> bool:
    for entry in allowlist:
        if entry['path'] != v.path:
            continue
        if entry['pattern'] != v.rule:
            continue
        if entry['substring'] in source_line:
            return True
    return False


# ---------------------------------------------------------------------------
# Scanning
# ---------------------------------------------------------------------------

def _scan_file(path: Path, root: Path) -> list[Violation]:
    rel = path.relative_to(root).as_posix()
    is_service_layer = (
        path.parent.parent.name == 'lib'
        and path.name in _SERVICE_LAYER_FILENAMES
    )
    text = path.read_text(encoding='utf-8')
    lines = text.splitlines()
    violations: list[Violation] = []

    for line_no, line in enumerate(lines, start=1):
        for rule_id, pattern in _RAW_PATTERNS:
            for m in pattern.finditer(line):
                violations.append(Violation(
                    path=rel, line=line_no, column=m.start() + 1,
                    rule=rule_id, snippet=line.strip(),
                ))
        if not is_service_layer:
            for m in _DIRECT_WRITE.finditer(line):
                violations.append(Violation(
                    path=rel, line=line_no, column=m.start() + 1,
                    rule='write:direct', snippet=line.strip(),
                ))
    return violations


def check(schema_path: Path, root: Path,
          allowlist_path: Path = _ALLOWLIST_PATH) -> list[Violation]:
    """Public entry point. Returns the filtered violation list."""
    files = _enumerate_generated_files(schema_path, root)
    allowlist = _load_allowlist(allowlist_path)
    out: list[Violation] = []
    for path in files:
        for v in _scan_file(path, root):
            # Re-read the offending line to give the allowlist a full
            # substring match — the snippet is .strip()ed.
            line_text = path.read_text(encoding='utf-8').splitlines()[v.line - 1]
            if _is_exempt(v, line_text, allowlist):
                continue
            out.append(v)
    return out


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main(argv: list[str]) -> int:
    if len(argv) != 3:
        print('Usage: python check_generated.py <schema.yaml> <project-root>',
              file=sys.stderr)
        return 2

    schema_path = Path(argv[1]).resolve()
    root = Path(argv[2]).resolve()

    if not schema_path.is_file():
        print(f'Schema not found: {schema_path}', file=sys.stderr)
        return 2
    if not root.is_dir():
        print(f'Project root not found: {root}', file=sys.stderr)
        return 2

    violations = check(schema_path, root)
    if not violations:
        print('check_generated: OK (no banned patterns in generator output)')
        return 0

    print(f'check_generated: {len(violations)} violation(s)', file=sys.stderr)
    for v in violations:
        print('  ' + v.render(), file=sys.stderr)
    print(
        '\nTo exempt a legitimate case, add an entry to '
        f'{_ALLOWLIST_PATH.relative_to(Path.cwd()) if _ALLOWLIST_PATH.is_relative_to(Path.cwd()) else _ALLOWLIST_PATH}',
        file=sys.stderr,
    )
    return 1


if __name__ == '__main__':
    sys.exit(main(sys.argv))
