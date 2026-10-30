"""Every `/api/` route must authenticate its caller, or be listed here by name.

`test_route_authorization_scoping.py` pins specific templates. This test is the
general safeguard: it enumerates every route source the generator can put
under `app/api/` (the `*route*.jinja2` templates and the hand-written
`app/api/**/route.ts` files) and fails if one has no recognised
authentication call. A route type added later that forgets to authenticate is
therefore caught here instead of depending on review.

A route that is deliberately reachable without a user session or API key
(public asset serving, sign-up, a token-authenticated refresh, a signed
webhook, a token-gated test hook) must be listed in `_ALTERNATE_CREDENTIAL`
with the marker that proves what it checks instead, and the reason. The
lists are checked for stale entries, so they cannot drift from the tree.
"""
import pathlib
import re

import pytest

REPO_ROOT = pathlib.Path(__file__).resolve().parents[2]
TEMPLATES_DIR = REPO_ROOT / 'code_generator' / 'templates'
HAND_WRITTEN_API_DIR = REPO_ROOT / 'app' / 'api'
GENERATE_PY = REPO_ROOT / 'code_generator' / 'generate.py'

# Calls from `lib/api-auth.ts` (plus the session helper) that resolve the
# caller from an API key, mobile access token or session cookie.
_AUTH_CALL = re.compile(
    r'\b(authenticate|authenticateApiKey|requireCaller|requireDualAuth|'
    r'requireMobileAuth|requireSession|requireScheduledTaskRole|requireScheduledTaskOperator|'
    r'resolveActorId|getSessionUserId|auth)\('
)

# Routes that do not call the helpers above. Value = (regex the source must
# still contain, why the route is reachable without a user credential).
# `None` as the marker means the route is intentionally public.
_ALTERNATE_CREDENTIAL = {
    'templates/stripe_webhook_route_stub.ts.jinja2': (
        r'constructEvent', 'payload signature verified against the webhook secret'),
    'app/api/auth/[...nextauth]/route.ts': (
        r'handlers', 'the sign-in handler itself (Auth.js)'),
    'app/api/auth/register/route.ts': (
        None, 'public sign-up, rate limited per IP'),
    'app/api/mobile/auth/refresh/route.ts': (
        r'refresh_token_hash', 'the refresh token is the credential'),
    'app/api/test-utils/reset-caches/route.ts': (
        r'TEST_RESET_TOKEN', 'disabled unless a test token is configured'),
}


def _route_sources() -> dict:
    sources = {}
    for path in sorted(TEMPLATES_DIR.glob('*route*.jinja2')):
        sources[f'templates/{path.name}'] = path
    for path in sorted(HAND_WRITTEN_API_DIR.rglob('route.ts')):
        sources[path.relative_to(REPO_ROOT).as_posix()] = path
    return sources


def _strip_comments(text: str) -> str:
    text = re.sub(r'/\*.*?\*/', '', text, flags=re.S)
    return re.sub(r'(?m)^\s*//.*$|(?<=\s)//.*$', '', text)


def test_route_sources_are_found():
    sources = _route_sources()
    assert len(sources) > 20, 'route enumeration found suspiciously few files'
    assert 'templates/api_route.ts.jinja2' in sources
    assert 'app/api/notifications/route.ts' in sources


@pytest.mark.parametrize('name', sorted(_route_sources()))
def test_route_requires_authentication(name):
    code = _strip_comments(_route_sources()[name].read_text(encoding='utf-8'))
    if name in _ALTERNATE_CREDENTIAL:
        marker, _reason = _ALTERNATE_CREDENTIAL[name]
        if marker is not None:
            assert re.search(marker, code), (
                f'{name} is listed with credential marker {marker!r}, '
                'which is no longer in the source'
            )
        return
    assert _AUTH_CALL.search(code), (
        f'{name} has no authentication call. Authenticate the caller '
        '(see lib/api-auth.ts) or, if the route is deliberately reachable '
        'without a user credential, list it in _ALTERNATE_CREDENTIAL.'
    )


def test_alternate_credential_list_has_no_stale_entries():
    sources = _route_sources()
    stale = sorted(set(_ALTERNATE_CREDENTIAL) - set(sources))
    assert not stale, f'listed routes that no longer exist: {stale}'
    redundant = sorted(
        n for n in _ALTERNATE_CREDENTIAL
        if _AUTH_CALL.search(_strip_comments(sources[n].read_text(encoding='utf-8')))
    )
    assert not redundant, (
        f'routes now call an authentication helper; drop them from the list: {redundant}'
    )


def test_every_route_file_the_generator_writes_is_enumerated():
    """A route template whose name lacks "route" must not escape the glob."""
    text = GENERATE_PY.read_text(encoding='utf-8')
    rendered = set(re.findall(
        r"'route\.ts'[^;]{0,200}?_render\(\s*env,\s*'([^']+\.jinja2)'", text))
    assert rendered, 'no route.ts render calls found in generate.py'
    enumerated = {k.split('/', 1)[1] for k in _route_sources() if k.startswith('templates/')}
    missing = sorted(rendered - enumerated)
    assert not missing, f'route templates not covered by the enumeration: {missing}'


# ---------------------------------------------------------------------------
# Authorization: update, delete and action handlers check the target record
# ---------------------------------------------------------------------------
# Authentication says who is calling. For a handler that changes one record, the
# permission also has to be judged against that record (Creator / Assignee grants,
# x-self-only ownership), not only at entity level. Enumerates every handler in
# the route templates that updates, deletes or acts on records and fails when its
# body has no record-level check.
_WRITE_HANDLER = re.compile(r'export\s+async\s+function\s+(PUT|PATCH|DELETE|POST)\b')

# Record-level checks: the record-scoped functions from lib/authz.ts and
# lib/api-auth.ts, or the inline form the bulk route uses (the rich permission
# breakdown tested against each record's creator / assignee).
_RECORD_CHECK = re.compile(
    r'\b(resolveRecordPermissions|requireRecordPermission|canAccessRecord|requireApiRecordPermission)\('
    r'|richPerms\.(creator|assignee)\b'
    r'|existing\.creator_id\s*===\s*actorId'
)

# Handlers that are not judged against a single target record, with the reason.
# Key = (template, HTTP method).
_RECORD_CHECK_EXEMPT = {
    ('api_comment_item_route.ts.jinja2', 'PATCH'): 'a comment is edited by its author; the route checks the comment, not the parent',
    ('api_comment_item_route.ts.jinja2', 'DELETE'): 'a comment is deleted by its author; the route checks the comment, not the parent',
    ('comment_reactions_api_route.ts.jinja2', 'POST'): 'toggles the caller own reaction; no record is changed',
    ('scheduled_task_run_action_route.ts.jinja2', 'POST'): 'role-gated admin action on a scheduled task, not a data record',
}


def _handlers(text: str):
    """Yield (method, body) for each exported route handler."""
    matches = list(_WRITE_HANDLER.finditer(text))
    for i, m in enumerate(matches):
        end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
        yield m.group(1), text[m.end():end]


def _record_handler_cases() -> list:
    cases = []
    for path in sorted(TEMPLATES_DIR.glob('*route*.jinja2')):
        action_route = 'action' in path.name or 'reactions' in path.name
        code = _strip_comments(path.read_text(encoding='utf-8'))
        for method, body in _handlers(code):
            if method == 'POST' and not action_route:
                continue  # create / import / export: no target record
            cases.append((path.name, method, body))
    return cases


def test_record_handlers_are_found():
    names = {(n, m) for n, m, _ in _record_handler_cases()}
    for expected in (('api_detail_route.ts.jinja2', 'PUT'), ('api_detail_route.ts.jinja2', 'DELETE'),
                     ('api_bulk_route.ts.jinja2', 'PUT'), ('api_bulk_route.ts.jinja2', 'DELETE'),
                     ('invalidate_action_route.ts.jinja2', 'POST'), ('split_action_route.ts.jinja2', 'POST')):
        assert expected in names, f'{expected} not enumerated'


@pytest.mark.parametrize('name,method,body', _record_handler_cases(), ids=lambda v: v if isinstance(v, str) and len(v) < 60 else '')
def test_record_handler_checks_permission_against_the_record(name, method, body):
    if (name, method) in _RECORD_CHECK_EXEMPT:
        return
    assert _RECORD_CHECK.search(body), (
        f'{name} {method} has no record-level permission check. Judge the permission against the '
        'target record (resolveRecordPermissions / requireApiRecordPermission in lib/authz.ts) or, if '
        'the handler changes no single record, list it in _RECORD_CHECK_EXEMPT with the reason.'
    )


def test_record_check_exemptions_have_no_stale_entries():
    found = {(n, m) for n, m, _ in _record_handler_cases()}
    stale = sorted(set(_RECORD_CHECK_EXEMPT) - found)
    assert not stale, f'exempt handlers that no longer exist: {stale}'
    redundant = sorted((n, m) for n, m, body in _record_handler_cases()
                       if (n, m) in _RECORD_CHECK_EXEMPT and _RECORD_CHECK.search(body))
    assert not redundant, f'handlers now check the record; drop them from the list: {redundant}'
