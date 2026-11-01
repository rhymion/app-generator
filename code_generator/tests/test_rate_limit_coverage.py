"""Every REST route and Server Action that changes data is rate limited, or is listed here with a reason.

Rate limiting is applied inside the handlers, not by the `proxy.ts` matcher:
the matcher only pulls `/api/auth/*` through the proxy, and every other
`/api` route is excluded from it. A new route or action that forgets the
limiter would therefore be unthrottled without any other signal, so this test
enumerates the sources and fails when one has no limiter call and no entry in
the allowlists below. The allowlists are checked for stale entries.

Limiter calls recognised:
- routes: `getRateLimiter(` (lib/rate-limit) or `enforceApiRateLimit(` (lib/api-auth.ts)
- Server Actions: `enforceActionRateLimit(` (lib/rate-limit/action.ts), which
  spends the same `api:write` bucket as the equivalent REST operation.
"""
import pathlib
import re
import subprocess

import pytest

REPO_ROOT = pathlib.Path(__file__).resolve().parents[2]
TEMPLATES_DIR = REPO_ROOT / 'code_generator' / 'templates'
HAND_WRITTEN_API_DIR = REPO_ROOT / 'app' / 'api'

_ROUTE_LIMIT = re.compile(r'\b(getRateLimiter|enforceApiRateLimit)\(')
_ACTION_LIMIT = re.compile(r'\b(enforceActionRateLimit|getRateLimiter|verifyMfaCode)\(')

# Routes with no limiter call. Value = why that is acceptable.
_ROUTE_UNLIMITED = {
    'templates/api_capabilities_route.ts.jinja2': 'read-only capability lookup for the caller, no data access',
    'templates/api_export_route.ts.jinja2': 'dual-auth read; export size is bounded by MAX_PAGE_SIZE and the export row cap',
    'templates/attachment_serve_route.ts.jinja2': 'file download gated by attachment ownership, not a write',
    'templates/dashboard_aggregate_route.ts.jinja2': 'read-only aggregate behind the dashboard permission',
    'templates/scheduled_task_route.ts.jinja2': 'admin-role gated scheduled task administration',
    'templates/scheduled_task_run_action_route.ts.jinja2': 'admin-role gated scheduled task action',
    'templates/scheduled_task_runs_route.ts.jinja2': 'admin-role gated read of scheduled task runs',
    'templates/search_route.ts.jinja2': 'read-only dual-auth search; result size bounded by MAX_PAGE_SIZE',
    'templates/stripe_webhook_route_stub.ts.jinja2': 'called by Stripe, authenticated by the payload signature, not per user',
    'app/api/audit_log/[id]/route.ts': 'read-only, administrator only',
    'app/api/audit_log/route.ts': 'read-only, administrator only',
    'app/api/auth/[...nextauth]/route.ts': 'sign-in handlers; limited per client IP in proxy.ts',
    'app/api/mobile/auth/refresh/route.ts': 'the refresh token is the credential; each token is single use',
    'app/api/mobile/auth/sessions/route.ts': 'read-only list of the caller own sessions',
    'app/api/mobile/nav/route.ts': 'read-only navigation for the caller',
    'app/api/mobile/permissions/route.ts': 'read-only permissions of the caller',
    'app/api/notifications/mark-read/route.ts': 'flips the caller own read flags; idempotent and cheap',
    'app/api/notifications/route.ts': 'read-only list of the caller own notifications',
    'app/api/openapi.json/route.ts': 'static specification document',
    'app/api/test-utils/reset-caches/route.ts': 'disabled unless a test token is configured',
}

# Server Action sources with no limiter call. Value = why that is acceptable.
_ACTION_UNLIMITED = {
    'templates/anonymize_user.ts.jinja2': 'administrator only, one call per erased user',
    'templates/chart_getters.ts.jinja2': 'read-only data fetch for a page render',
    'templates/getters.ts.jinja2': 'read-only data fetch for a page render',
    'templates/inline_create_actions.ts.jinja2': 'read-only permission probe and form defaults',
    'templates/invalidate_handler_stub.ts.jinja2': 'extension stub called from the invalidate action, which is limited',
    'templates/mention_recipients.ts.jinja2': 'internal helper, not an action entry point',
    'templates/mention_record_org.ts.jinja2': 'internal helper, not an action entry point',
    'templates/mention_search.ts.jinja2': 'read-only user lookup, bounded result size',
    'templates/page_list.tsx.jinja2': 'read-only data fetch for a page render',
    'templates/scheduled_task_admin_actions.ts.jinja2': 'admin-role gated scheduled task actions',
    'templates/search_actions.ts.jinja2': 'read-only search, bounded result size',
    'lib/approval_request/actions.ts': 'role-gated approval actions; the REST equivalents are limited, see follow-up',
    'app/[locale]/setting/accounts/actions.ts': 'acts on the caller own account after password confirmation',
    'app/[locale]/setting/mfa/actions.ts': 'acts on the caller own MFA state after code confirmation',
    'lib/setting/api-key-actions.ts': 'acts on the caller own API keys',
    'lib/audit_log/getters.ts': 'read-only, administrator only',
    'lib/authz.ts': 'permission and session helpers, no data change',
    'lib/dashboard/aggregate-core.ts': 'read-only aggregate behind the dashboard permission',
    'lib/dashboard/aggregate.ts': 'read-only aggregate behind the dashboard permission',
    'lib/dashboard/readable-entities.ts': 'read-only list of entities the caller may read',
    'lib/organization/getters_associated.ts': 'read-only list of the caller own organizations',
    'lib/compliance/anonymize_user.ts': 'administrator only, one call per erased user',
    'lib/setting/password-actions.ts': 'password change verifies the current password, which is limited by the credential bucket',
}


def _strip_comments(text: str) -> str:
    text = re.sub(r'/\*.*?\*/', '', text, flags=re.S)
    return re.sub(r'(?m)^\s*//.*$|(?<=\s)//.*$', '', text)


def _tracked(root: pathlib.Path, pattern: str) -> list:
    """Git-tracked files under root. Generated, git-ignored output is covered by its template."""
    out = subprocess.run(
        ['git', 'ls-files', '--', pattern], cwd=root, check=True, capture_output=True, text=True
    ).stdout.split('\n')
    return sorted(root / name for name in out if name)


def _route_sources() -> dict:
    sources = {}
    for path in sorted(TEMPLATES_DIR.glob('*route*.jinja2')):
        sources[f'templates/{path.name}'] = path
    for path in _tracked(HAND_WRITTEN_API_DIR, '*route.ts'):
        sources[path.relative_to(REPO_ROOT).as_posix()] = path
    return sources


def _action_sources() -> dict:
    sources = {}
    for path in sorted(TEMPLATES_DIR.glob('*.jinja2')):
        if "'use server'" in path.read_text(encoding='utf-8'):
            sources[f'templates/{path.name}'] = path
    for root in ('app', 'lib'):
        for path in _tracked(REPO_ROOT / root, '*.ts'):
            if path.name.endswith('.test.ts'):
                continue
            head = path.read_text(encoding='utf-8')[:400]
            if "'use server'" in head and 'export async function' in path.read_text(encoding='utf-8'):
                sources[path.relative_to(REPO_ROOT).as_posix()] = path
    return sources


def _limited(path: pathlib.Path, pattern) -> bool:
    return bool(pattern.search(_strip_comments(path.read_text(encoding='utf-8'))))


def test_sources_are_found():
    assert len(_route_sources()) > 30
    assert 'templates/api_route.ts.jinja2' in _route_sources()
    assert 'templates/actions.ts.jinja2' in _action_sources()
    assert 'lib/approval_request/actions.ts' in _action_sources()


def test_proxy_matcher_only_pulls_auth_api_through_the_proxy():
    """Pins the premise of this file: business API routes limit themselves."""
    proxy = (REPO_ROOT / 'proxy.ts').read_text(encoding='utf-8')
    matcher = proxy[proxy.index('export const config'):]
    assert "'/api/auth/:path*'" in matcher
    assert '(?!api|' in matcher, 'the app-route matcher must keep excluding /api'


@pytest.mark.parametrize('name', sorted(_route_sources()))
def test_route_is_rate_limited(name):
    if name in _ROUTE_UNLIMITED:
        return
    assert _limited(_route_sources()[name], _ROUTE_LIMIT), (
        f'{name} has no rate limit. Call getRateLimiter().check(...) or enforceApiRateLimit(userId) '
        'after authenticating the caller or, if the route needs none, list it in _ROUTE_UNLIMITED with the reason.'
    )


@pytest.mark.parametrize('name', sorted(_action_sources()))
def test_server_action_is_rate_limited(name):
    if name in _ACTION_UNLIMITED:
        return
    assert _limited(_action_sources()[name], _ACTION_LIMIT), (
        f'{name} exports Server Actions with no rate limit. Call enforceActionRateLimit(userId) '
        '(lib/rate-limit/action.ts) or list the file in _ACTION_UNLIMITED with the reason.'
    )


@pytest.mark.parametrize('listed,sources,pattern', [
    (_ROUTE_UNLIMITED, _route_sources, _ROUTE_LIMIT),
    (_ACTION_UNLIMITED, _action_sources, _ACTION_LIMIT),
], ids=['routes', 'actions'])
def test_allowlists_have_no_stale_entries(listed, sources, pattern):
    found = sources()
    stale = sorted(set(listed) - set(found))
    assert not stale, f'listed sources that no longer exist: {stale}'
    redundant = sorted(n for n in listed if _limited(found[n], pattern))
    assert not redundant, f'sources now call a limiter; drop them from the list: {redundant}'
