"""
Generated code reads the cookie session through lib/authz.ts, never through `auth()` directly.

`getSessionUserId()` answers null for a session that may not act yet: one that must enrol in
MFA first (MFA_REQUIRED_ROLES, Issue #1281). A template that calls `auth()` itself would let
such a session through, so no template may import `auth` from '@/auth'.

Run:
    cd code_generator && python3 -m pytest tests/test_session_reads_through_authz.py -v
"""
import re
from pathlib import Path

TEMPLATES = Path(__file__).resolve().parent.parent / 'templates'
AUTH_IMPORT = re.compile(r"""import\s*\{[^}]*\bauth\b[^}]*\}\s*from\s*['"]@/auth['"]""")


def test_no_template_imports_auth_from_the_auth_module():
    offenders = [
        str(p.relative_to(TEMPLATES))
        for p in TEMPLATES.rglob('*.jinja2')
        if AUTH_IMPORT.search(p.read_text(encoding='utf-8'))
    ]
    assert offenders == [], f'read the session through getSessionUserId() (lib/authz.ts) instead: {offenders}'


def test_search_route_reads_the_session_through_authz():
    src = (TEMPLATES / 'search_route.ts.jinja2').read_text(encoding='utf-8')
    assert "import { getSessionUserId } from '@/lib/authz';" in src
    assert 'await getSessionUserId()' in src
