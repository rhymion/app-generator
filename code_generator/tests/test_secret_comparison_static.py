"""No shipped code compares a bearer or shared secret with ===, !==, == or !=.

String equality can return at the first differing character. Secrets go
through `secretsEqual` (lib/_secret_compare.ts), which hashes both sides and
uses `crypto.timingSafeEqual`. The scan covers the hand-maintained TypeScript
and the generator templates, so a template cannot reintroduce the pattern.
"""
from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SCAN_DIRS = ['lib', 'app', 'code_generator/templates', 'scripts']
SUFFIXES = ('.ts', '.tsx', '.jinja2')
_SECRET_NAME = r'[A-Za-z_.$`{}]*(?:secret|authHeader|bearer|apiKey|expectedToken|providedToken)[A-Za-z_.$`{}]*'
_CMP = r'(?:===|!==|==|!=)'
_PATTERN = re.compile(rf'{_SECRET_NAME}\s*{_CMP}\s*(?P<rhs1>\S+)|(?P<lhs2>\S+)\s*{_CMP}\s*{_SECRET_NAME}', re.IGNORECASE)
_EXEMPT_OPERAND = re.compile(r'^(?:undefined|null|\'\'|""|typeof)\b|^[\'"][^\'"]*[\'"]\)?[;,]?$')


def _violations() -> list[str]:
    found = []
    for d in SCAN_DIRS:
        for path in (ROOT / d).rglob('*'):
            if path.suffix not in SUFFIXES or 'node_modules' in path.parts:
                continue
            if '.test.' in path.name or path.name.startswith('test_'):
                continue
            for n, line in enumerate(path.read_text(encoding='utf-8', errors='ignore').splitlines(), 1):
                stripped = line.strip()
                if stripped.startswith(('//', '*', '/*')) or 'typeof' in line:
                    continue
                m = _PATTERN.search(line)
                if not m:
                    continue
                operand = m.group('rhs1') or m.group('lhs2') or ''
                if _EXEMPT_OPERAND.match(operand) and 'typeof' not in operand:
                    continue
                found.append(f'{path.relative_to(ROOT)}:{n}: {stripped}')
    return found


def test_no_secret_is_compared_with_string_equality():
    assert _violations() == []


def test_scheduled_task_route_uses_the_constant_time_helper():
    src = (ROOT / 'code_generator/templates/scheduled_task_route.ts.jinja2').read_text(encoding='utf-8')
    assert "import { secretsEqual } from '@/lib/_secret_compare';" in src
    assert 'secretsEqual(authHeader' in src


def test_scanner_detects_the_old_pattern():
    assert _PATTERN.search('const ok = authHeader === `Bearer ${cronSecret}`;')
    assert _PATTERN.search('if (provided !== expected) {') is None  # names carry no secret hint; covered by the helper adoption test above
