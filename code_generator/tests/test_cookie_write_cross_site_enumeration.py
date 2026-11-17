"""A route that reads the session cookie directly must refuse cross-site writes.

`lib/api-auth.ts` resolves the caller from the session cookie in three helpers
(`requireCaller`, `resolveActorId`, `requireDualAuth`), and each of them calls
`assertSameSiteCookieWrite()` first (Issue #1275). A route that skips those
helpers and reads the cookie itself (`getSessionUserId`, `getSessionUserIdOrThrow`,
`requireSession` or `auth()`) in a state-changing handler would bypass that check,
so it has to call `assertSameSiteCookieWrite()` itself.

The test enumerates every route source the generator can put under `app/api/`
(the `*route*.jinja2` templates and the hand-written `app/api/**/route.ts`
files), so a route type added later cannot read the cookie unguarded.
"""
import pathlib
import re

REPO_ROOT = pathlib.Path(__file__).resolve().parents[2]
TEMPLATES_DIR = REPO_ROOT / 'code_generator' / 'templates'
HAND_WRITTEN_API_DIR = REPO_ROOT / 'app' / 'api'
API_AUTH = REPO_ROOT / 'lib' / 'api-auth.ts'

_MUTATING_HANDLER = re.compile(r'export\s+async\s+function\s+(POST|PUT|PATCH|DELETE)\b')
_DIRECT_COOKIE_READ = re.compile(r'\b(getSessionUserIdOrThrow|getSessionUserId|requireSession|auth)\(')
_GUARD = 'assertSameSiteCookieWrite('


def _route_sources():
    for path in sorted(TEMPLATES_DIR.glob('*route*.jinja2')):
        yield path
    for path in sorted(HAND_WRITTEN_API_DIR.rglob('route.ts')):
        yield path


def _function_body(source: str, helper: str) -> str:
    start = source.index(f'export async function {helper}(')
    end = source.find('\nexport ', start + 1)
    return source[start:end if end != -1 else len(source)]


def test_cookie_resolving_helpers_check_the_request_first():
    source = API_AUTH.read_text()
    for helper in ('requireCaller', 'resolveActorId'):
        body = _function_body(source, helper)
        assert _GUARD in body, f'{helper} must call assertSameSiteCookieWrite() before reading the cookie'
        assert body.index(_GUARD) < body.index('getSessionUserId('), (
            f'{helper} must check the request before it reads the session cookie')
    # requireDualAuth reaches the cookie through resolveActorId.
    assert 'resolveActorId(request)' in _function_body(source, 'requireDualAuth')


def test_routes_reading_the_cookie_directly_guard_their_writes():
    unguarded = []
    for path in _route_sources():
        text = path.read_text()
        if not _MUTATING_HANDLER.search(text):
            continue
        if _DIRECT_COOKIE_READ.search(text) and _GUARD not in text:
            unguarded.append(str(path.relative_to(REPO_ROOT)))
    assert not unguarded, (
        'state-changing routes that read the session cookie without assertSameSiteCookieWrite(): '
        + ', '.join(unguarded)
    )


def test_the_enumeration_sees_the_known_guarded_route():
    route = (HAND_WRITTEN_API_DIR / 'notifications' / 'mark-read' / 'route.ts').read_text()
    assert _MUTATING_HANDLER.search(route)
    assert _DIRECT_COOKIE_READ.search(route)
    assert _GUARD in route
