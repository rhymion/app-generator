"""Generated server and web code must log through lib/logger.ts, never through console.*.

ESLint's no-console rule is the gate for generated output (it lints after generate-code). This test is
the earlier, cheaper check on the template sources, so a regression fails in the Python step.
"""

import re
from pathlib import Path

TEMPLATES = Path(__file__).resolve().parent.parent / 'templates'
CONSOLE_CALL = re.compile(r'\bconsole\s*\.\s*(log|info|warn|error|debug|trace)\s*\(')

# Allowlist: template path (relative to templates/) -> why raw console output is acceptable there.
ALLOWED = {
    # Expo app running on the device: there is no server log to leak into, and lib/logger.ts is not
    # part of the mobile project.
    'mobile/lib/token-storage.ts.jinja2': 'on-device Expo code, no shared server logs',
}


def test_templates_do_not_call_console_directly():
    offenders = []
    for path in sorted(TEMPLATES.rglob('*')):
        if not path.is_file():
            continue
        rel = path.relative_to(TEMPLATES).as_posix()
        if rel in ALLOWED:
            continue
        for lineno, line in enumerate(path.read_text(encoding='utf-8', errors='ignore').splitlines(), 1):
            if CONSOLE_CALL.search(line):
                offenders.append(f'{rel}:{lineno}: {line.strip()}')
    assert not offenders, 'use logger from @/lib/logger instead of console.*:\n' + '\n'.join(offenders)


def test_allowlist_entries_still_exist_and_still_need_it():
    for rel in ALLOWED:
        path = TEMPLATES / rel
        assert path.is_file(), f'{rel} no longer exists; remove it from ALLOWED'
        assert CONSOLE_CALL.search(path.read_text(encoding='utf-8')), f'{rel} no longer calls console; remove it from ALLOWED'
