#!/usr/bin/env python3
"""
check_tracked_generated_imports.py -- flag tracked source files that statically
import a git-ignored (generated) file.

CI's Unit Tests job runs `npm ci`, `db:generate` and `test:vitest` on a clean
checkout, with no `generate-code` step. A tracked file under `lib/`,
`components/`, `app/` or the test setup that statically imports a git-ignored
generated file (for example `lib/<entity>/service.ts`) resolves in a local
worktree where `generate-code` already ran, so the local gate stays green, and
then fails to resolve in CI. This check closes that gap: it runs on a clean
checkout and on a generated tree alike, because it decides from the git index
and the ignore rules, never from what happens to exist on disk.

For every tracked `.ts` / `.tsx` file outside the directories listed in
`_SKIPPED_ROOTS`, each static import / re-export specifier that is relative or
uses the `@/` alias is resolved to its candidate paths (`<p>.ts`, `<p>.tsx`,
`<p>/index.ts`, ...). A specifier passes when a candidate is tracked. It is a
violation when no candidate is tracked and a candidate is git-ignored. A
specifier that matches neither (a path that is simply missing, a package) is
left to `tsc` / the bundler. A target under `app/generated/prisma/`
passes: CI's Unit Tests job runs `db:generate` first. Dynamic `import()` calls
are not static imports and are not flagged.

A file that deliberately wires into generated code (a caller that only exists
in generated apps) is listed in `check_tracked_generated_imports_allowlist.yaml`
(sibling of this script, or the file given with `--allowlist`). Each entry names
the importing `path`, the imported `targets` (candidate paths as the check
prints them, extension omitted when the import omits it) and a required `reason`. An entry
that no longer matches a flagged import is reported as stale, so the list cannot
drift from the tree.

Usage:
    python check_tracked_generated_imports.py [<project-root>] [--allowlist <file>]

Exit codes:
    0 -- no violations
    1 -- at least one violation or stale allowlist entry
    2 -- invocation / configuration error
"""
from __future__ import annotations

import re
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path, PurePosixPath

import yaml

_ALLOWLIST_PATH = Path(__file__).parent / 'check_tracked_generated_imports_allowlist.yaml'

# Tracked code that only runs after generate-code (or is not part of the app).
_SKIPPED_ROOTS = ('code_generator/', 'cypress/', 'mobile/', 'scripts/', 'docs/', 'node_modules/')
# Ignored output that CI produces before the vitest step (`npm run db:generate`).
_DB_GENERATE_OUTPUT = 'app/generated/prisma/'
_SOURCE_SUFFIXES = ('.ts', '.tsx')
_RESOLVE_SUFFIXES = ('', '.ts', '.tsx', '.js', '.jsx', '.mjs', '/index.ts', '/index.tsx', '/index.js')

# `import x from 'p'`, `import 'p'`, `export * from 'p'`, `export { a } from 'p'`.
# Multi-line specifier lists are matched through the `[^;'"]*?` span. A leading
# `import type` is still a static import for the bundler's purposes only when it
# is not erased, so type-only imports are reported too: they break `tsc` in CI.
_STATIC_IMPORT = re.compile(
    r'''(?:^|[;\n])\s*(?:import|export)\b(?:[^;'"`]*?\bfrom\b)?\s*(['"])([^'"\n]+)\1''',
)


@dataclass(frozen=True)
class Violation:
    path: str
    target: str

    def __str__(self) -> str:
        return f'{self.path}: statically imports git-ignored file {self.target}'


def _git(root: Path, *args: str, stdin: str | None = None) -> str:
    result = subprocess.run(
        ['git', '-C', str(root), *args],
        input=stdin, capture_output=True, text=True, check=False,
    )
    if result.returncode not in (0, 1):  # check-ignore exits 1 when nothing matches
        raise RuntimeError(f'git {" ".join(args)} failed: {result.stderr.strip()}')
    return result.stdout


def _strip_comments(text: str) -> str:
    text = re.sub(r'/\*.*?\*/', '', text, flags=re.S)
    return re.sub(r'(?m)(?<![:\'"`])//.*$', '', text)


def _candidates(importer: str, specifier: str) -> list[str] | None:
    """Candidate repo-relative paths for a relative or `@/` specifier, else None."""
    if specifier.startswith('@/'):
        base = PurePosixPath(specifier[2:])
    elif specifier.startswith('.'):
        base = PurePosixPath(importer).parent / specifier
    else:
        return None
    parts: list[str] = []
    for part in base.parts:
        if part == '..':
            if parts:
                parts.pop()
        elif part != '.':
            parts.append(part)
    joined = '/'.join(parts)
    return [joined + suffix for suffix in _RESOLVE_SUFFIXES]


def _ignored(root: Path, paths: list[str]) -> set[str]:
    if not paths:
        return set()
    out = _git(root, 'check-ignore', '--stdin', '-z', stdin='\0'.join(paths) + '\0')
    return {p for p in out.split('\0') if p}


def _load_allowlist(path: Path) -> list[dict]:
    if not path.is_file():
        return []
    data = yaml.safe_load(path.read_text(encoding='utf-8')) or {}
    entries = data.get('exemptions') or []
    for e in entries:
        if not e.get('path') or not e.get('targets') or not e.get('reason'):
            raise ValueError(f'allowlist entry needs `path`, `targets` and `reason`: {e!r}')
    return entries


def check(root: Path, allowlist_path: Path = _ALLOWLIST_PATH) -> tuple[list[Violation], list[str]]:
    """Return (violations, stale allowlist entries)."""
    allowlist = _load_allowlist(allowlist_path)
    tracked = {p for p in _git(root, 'ls-files', '-z').split('\0') if p}
    sources = sorted(
        p for p in tracked
        if p.endswith(_SOURCE_SUFFIXES) and not p.startswith(_SKIPPED_ROOTS)
    )

    pending: list[tuple[str, list[str]]] = []
    for rel in sources:
        file = root / rel
        if not file.is_file():
            continue
        code = _strip_comments(file.read_text(encoding='utf-8'))
        for match in _STATIC_IMPORT.finditer(code):
            candidates = _candidates(rel, match.group(2))
            if candidates is None or any(c in tracked for c in candidates):
                continue
            pending.append((rel, candidates))

    ignored = _ignored(root, sorted({c for _, cands in pending for c in cands}))
    flagged: set[tuple[str, str]] = set()
    for rel, candidates in pending:
        hit = next((c for c in candidates if c in ignored), None)
        if hit and not hit.startswith(_DB_GENERATE_OUTPUT):
            flagged.add((rel, hit))

    exempt = {(e['path'], t) for e in allowlist for t in e['targets']}
    violations = [Violation(p, t) for p, t in sorted(flagged - exempt)]
    stale = sorted(f'{p} -> {t}' for p, t in exempt - flagged)
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
    if not (root / '.git').exists():
        print(f'{root} is not a git checkout', file=sys.stderr)
        return 2
    try:
        violations, stale = check(root, allowlist)
    except (ValueError, yaml.YAMLError, RuntimeError) as e:
        print(f'check_tracked_generated_imports: {e}', file=sys.stderr)
        return 2
    for v in violations:
        print(v)
    for s in stale:
        print(f'stale allowlist entry (no longer flagged): {s}')
    if violations or stale:
        print(f'check_tracked_generated_imports: {len(violations)} violation(s), {len(stale)} stale entr(ies)')
        return 1
    print('check_tracked_generated_imports: OK')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
