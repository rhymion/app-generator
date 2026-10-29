"""Tests for code_generator/check_tracked_generated_imports.py."""
from __future__ import annotations

import subprocess
from pathlib import Path

from check_tracked_generated_imports import _ALLOWLIST_PATH, check, main


def _repo(tmp_path: Path, files: dict[str, str], ignore: str = 'lib/*/*\napp/generated/\n') -> Path:
    subprocess.run(['git', 'init', '-q', str(tmp_path)], check=True)
    (tmp_path / '.gitignore').write_text(ignore)
    for rel, body in files.items():
        f = tmp_path / rel
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_text(body)
    tracked = ['.gitignore'] + [r for r in files if not _is_ignored(tmp_path, r)]
    subprocess.run(['git', '-C', str(tmp_path), 'add', '-f', *tracked], check=True)
    return tmp_path


def _is_ignored(root: Path, rel: str) -> bool:
    return subprocess.run(['git', '-C', str(root), 'check-ignore', '-q', rel]).returncode == 0


def _flags(root: Path, allowlist: Path | None = None):
    violations, stale = check(root, allowlist or root / 'none.yaml')
    return sorted((v.path, v.target) for v in violations), stale


def test_import_of_tracked_file_passes(tmp_path):
    _repo(tmp_path, {
        'lib/_a.ts': "import { b } from './_b';\nimport { c } from '@/lib/_c';\n",
        'lib/_b.ts': 'export const b = 1;\n',
        'lib/_c.ts': 'export const c = 1;\n',
    })
    assert _flags(tmp_path) == ([], [])


def test_import_of_ignored_generated_file_is_flagged(tmp_path):
    _repo(tmp_path, {
        'lib/_a.ts': "import { s } from '@/lib/widget/service';\n",
        'lib/widget/service': 'export const s = 1;\n',
    })
    assert _flags(tmp_path)[0] == [('lib/_a.ts', 'lib/widget/service')]


def test_flagged_whether_or_not_generated_file_exists_on_disk(tmp_path):
    root = _repo(tmp_path, {'lib/_a.ts': "import { s } from '@/lib/widget/service';\n"})
    assert _flags(root)[0] == [('lib/_a.ts', 'lib/widget/service')]
    (root / 'lib/widget').mkdir()
    (root / 'lib/widget/service').write_text('export const s = 1;\n')
    assert _flags(root)[0] == [('lib/_a.ts', 'lib/widget/service')]


def test_reexport_and_side_effect_and_multiline_imports_are_flagged(tmp_path):
    _repo(tmp_path, {
        'lib/_a.ts': "export * from './widget/one';\n",
        'lib/_b.ts': "import './widget/two';\n",
        'lib/_c.ts': "import {\n  a,\n  b,\n} from './widget/three';\n",
    })
    assert _flags(tmp_path)[0] == [
        ('lib/_a.ts', 'lib/widget/one'),
        ('lib/_b.ts', 'lib/widget/two'),
        ('lib/_c.ts', 'lib/widget/three'),
    ]


def test_dynamic_import_comment_and_package_import_are_not_flagged(tmp_path):
    _repo(tmp_path, {
        'lib/_a.ts': (
            "// import { s } from '@/lib/widget/service';\n"
            "import React from 'react';\n"
            "const m = () => import('@/lib/widget/service');\n"
        ),
    })
    assert _flags(tmp_path) == ([], [])


def test_prisma_client_output_is_exempt(tmp_path):
    _repo(tmp_path, {'lib/_a.ts': "import { PrismaClient } from '@/app/generated/prisma/client';\n"})
    assert _flags(tmp_path) == ([], [])


def test_skipped_roots_are_not_scanned(tmp_path):
    _repo(tmp_path, {'cypress/e2e/a.cy.ts': "import { s } from '@/lib/widget/service';\n"})
    assert _flags(tmp_path) == ([], [])


def test_allowlist_exempts_and_reports_stale(tmp_path):
    _repo(tmp_path, {'lib/_a.ts': "import { s } from '@/lib/widget/service';\n"})
    allow = tmp_path / 'allow.yaml'
    allow.write_text(
        'exemptions:\n'
        '  - path: lib/_a.ts\n    targets: [lib/widget/service]\n    reason: wiring\n'
        '  - path: lib/_gone.ts\n    targets: [lib/widget/service]\n    reason: old\n'
    )
    violations, stale = _flags(tmp_path, allow)
    assert violations == []
    assert stale == ['lib/_gone.ts -> lib/widget/service']


def test_main_exit_codes(tmp_path, capsys):
    _repo(tmp_path, {'lib/_a.ts': "import { s } from '@/lib/widget/service';\n"})
    assert main(['x', str(tmp_path), '--allowlist', str(tmp_path / 'none.yaml')]) == 1
    assert 'lib/_a.ts' in capsys.readouterr().out
    assert main(['x', str(tmp_path / 'missing')]) == 2


def test_shipped_allowlist_is_well_formed():
    import yaml
    data = yaml.safe_load(_ALLOWLIST_PATH.read_text())
    for e in data['exemptions']:
        assert e['path'] and e['targets'] and e['reason']


def test_repository_tree_has_no_tracked_import_of_a_generated_file():
    """Runs in the pytest job (clean checkout) and in the local gate (generated tree)."""
    root = Path(__file__).resolve().parents[2]
    violations, stale = check(root)
    assert [str(v) for v in violations] == []
    assert stale == []
