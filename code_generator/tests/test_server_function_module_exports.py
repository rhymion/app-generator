"""
Modules that start with a module-level server-function directive register
every export as an independently callable endpoint, whatever the intended
callers are. Helpers that take the acting user (or already-loaded
permissions) as a parameter and trust it must therefore live in a plain
internal module with no directive, and only functions that derive the actor
from the session may stay in the directive module.

Checks both the hand-maintained lib modules and real generated output, so a
new parameter-trusting export in a directive module fails here.

The name-based checks (TRUSTING) only recognise known helper names. The
structural checks further down do not depend on names: every export of a
directive module must either carry no identity-trusting parameter AND show a
permission check before its first data access, or appear in ALLOWLIST with a
justification. That also catches an export that takes no identity at all but
performs no check either.

Run:
    cd code_generator && python3 -m pytest tests/test_server_function_module_exports.py -v
"""
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile

import pytest

from build_user_schema import build_user_schema
from generate import generate

REPO_ROOT = Path(__file__).resolve().parents[2]
FIXTURE_DIR = REPO_ROOT / 'code_generator' / 'tests' / 'fixtures' / 'invalidate_gate'

DIRECTIVE = re.compile(r"""\A(?:\s*//[^\n]*\n|\s*/\*[^*]*\*+(?:[^/*][^*]*\*+)*/)*\s*['"]use server['"]""")
EXPORT = re.compile(r'^export\s+(?:async\s+)?function\s+(\w+)', re.M)

# Exports that trust a caller-supplied identity / permissions.
TRUSTING = re.compile(
    r'^(?:getAssociatedOrganizations|getAssociatedOrganizationDetail'
    r'|get\w+Detail|get\w+Page|get\w+ChunkForExport|build\w+AccessWhere)$'
)
# Session-deriving entry points that legitimately keep the directive.
SAFE_ALLOW = re.compile(r'^get\w+(?:DetailPageData|PagedData)$')


def _offenders(path: Path) -> list[str]:
    text = path.read_text()
    if not DIRECTIVE.search(text):
        return []
    return [
        n for n in EXPORT.findall(text)
        if TRUSTING.match(n) and not SAFE_ALLOW.match(n)
    ]


def test_hand_maintained_modules_keep_trusting_helpers_out_of_directive_modules():
    for rel in ('lib/organization/getters_associated.ts', 'lib/audit_log/getters.ts'):
        assert _offenders(REPO_ROOT / rel) == [], rel
    for rel in ('lib/organization/associated_internal.ts', 'lib/audit_log/getters_internal.ts'):
        assert not DIRECTIVE.search((REPO_ROOT / rel).read_text()), rel


def test_generated_getters_split_by_call_safety():
    with tempfile.TemporaryDirectory() as tmp:
        out = Path(tmp)
        (out / 'prisma').mkdir()
        shutil.copy(FIXTURE_DIR / 'schema.prisma', out / 'prisma' / 'schema.prisma')
        intermediate = out / 'generated_json_schema.yaml'
        build_user_schema(FIXTURE_DIR / 'json_schema.yaml', FIXTURE_DIR / 'schema.prisma', intermediate)
        generate(str(intermediate), str(out))

        checked = 0
        for path in sorted((out / 'lib').rglob('*.ts')):
            assert _offenders(path) == [], str(path.relative_to(out))
        for entity in ('widget', 'gadget', 'sprocket'):
            public = out / 'lib' / entity / 'getters.ts'
            internal = out / 'lib' / entity / 'getters_internal.ts'
            assert DIRECTIVE.search(public.read_text())
            assert not DIRECTIVE.search(internal.read_text())
            names = EXPORT.findall(internal.read_text())
            assert any(n.endswith('Detail') for n in names)
            assert any(n.endswith('Page') for n in names)
            checked += 1
        assert checked == 3


# ---------------------------------------------------------------------------
# Structural check: no registered export without a visible check
# ---------------------------------------------------------------------------

COMPOSE = REPO_ROOT / 'scripts' / 'compose_child_datagrid_e2e_fixture.py'
VERSION_OF_FIXTURE_DIR = REPO_ROOT / 'code_generator' / 'tests' / 'fixtures' / 'version_of_e2e_gate'
SCHEMA_PRISMA_FIXTURES = (
    'invalidate_gate', 'mention_gate', 'direct_attachment_gate', 'chart_decimal_gate',
    'payment_gate', 'create_inline_gate', 'approval_lockdown_gate',
)

INLINE_DIRECTIVE = re.compile(r"""^[ \t]+['"]use server['"]""", re.M)
EXPORT_FN = re.compile(r'^export\s+(?:async\s+)?function\s+(\w+)\s*(?:<[^>]*>)?\s*\(', re.M)
EXPORT_CONST_FN = re.compile(
    r'^export\s+const\s+(\w+)\s*=\s*(?:cache\(\s*)?(?:async\s*)?(?:function\s*)?\(', re.M)

# Parameter names that carry the acting identity or already-loaded permissions
# into an export; a caller can pass any value for them.
TRUSTING_PARAM = re.compile(
    r'^(?:userId|actorId|actorUserId|callerId|currentUserId|sessionUserId|requestorId'
    r'|resolvedUserId|perms|permissions)\??$'
)
# Calls that derive the actor from the session / check a permission. A session
# lookup alone is deliberately not enough: it only says who is calling.
PERMISSION_CHECK = re.compile(
    r'\b(?:require(?:Entity|Record)Permission|assertPermission|resolve(?:Entity|Record)Permissions'
    r'|assert\w*(?:Permission|Role|Approver|Access|Edit|Order)\w*'
    r'|readable\w+Where|get\w+NewPageAccessCheck|getScheduledTaskOperatorId)\s*\('
    r'|\bgetModelPermissions\s*\(\s*[^,)]*\)'
)
SESSION_LOOKUP = re.compile(r'\b(?:getSessionUserIdOrThrow|getSessionUserId|auth)\s*\(')
# First point where the export writes or hands data back. A read that only
# feeds the check (the item lookup before requireRecordPermission(..., existing)) may
# come earlier, as may a bare `return;` or an `{ ok: false ... }` failure result,
# which carry no data.
SINK = re.compile(
    r'\.(?:create|createMany|update|updateMany|upsert|delete|deleteMany)\s*\('
    r'|\$executeRaw|\$transaction|\breturn\b(?!\s*(?:;|\{\s*ok:\s*false))'
)


def _matching(text: str, start: int, open_c: str, close_c: str) -> int:
    depth = 0
    for i in range(start, len(text)):
        if text[i] == open_c:
            depth += 1
        elif text[i] == close_c:
            depth -= 1
            if depth == 0:
                return i
    return len(text) - 1


def _split_params(src: str) -> list[str]:
    names, depth, cur = [], 0, ''
    for ch in src + ',':
        if ch in '<({[':
            depth += 1
        elif ch in '>)}]':
            depth -= 1
        if ch == ',' and depth == 0:
            m = re.match(r'\s*(?:\.\.\.)?(\w+\??)', cur)
            if m:
                names.append(m.group(1))
            cur = ''
        else:
            cur += ch
    return names


def _body_start(text: str, after_params: int) -> int:
    """First '{' (or the arrow) outside any <> / () nesting: skips a return type
    such as Promise<{ a: string }>."""
    depth = 0
    for i in range(after_params, len(text)):
        c = text[i]
        if c in '<(':
            depth += 1
        elif c in '>)' and text[i - 1] != '=':
            depth -= 1
        elif c == '{' and depth == 0:
            return i
    return len(text) - 1


def exported_functions(text: str) -> list[tuple[str, list[str], str]]:
    """(name, parameter names, body text) for every exported function / const arrow."""
    found = []
    for rx in (EXPORT_FN, EXPORT_CONST_FN):
        for m in rx.finditer(text):
            p_open = m.end() - 1
            p_close = _matching(text, p_open, '(', ')')
            params = _split_params(text[p_open + 1:p_close])
            if rx is EXPORT_CONST_FN:
                arrow = text.find('=>', p_close)
                start = _body_start(text, arrow) if arrow != -1 else p_close
                nxt = re.search(r'^export\s', text[start:], re.M)
                body = text[start:start + nxt.start()] if nxt else text[start:]
            else:
                start = _body_start(text, p_close + 1)
                body = text[start:_matching(text, start, '{', '}') + 1]
            found.append((m.group(1), params, body))
    return found


def findings_for(text: str) -> dict[str, list[str]]:
    """Exports of a directive module that are neither safe by parameters nor by a visible check."""
    if not DIRECTIVE.search(text):
        return {}
    flagged: dict[str, list[str]] = {}
    for name, params, body in exported_functions(text):
        reasons = []
        bad = [p for p in params if TRUSTING_PARAM.match(p)]
        if bad:
            reasons.append('identity-trusting parameter: ' + ', '.join(bad))
        sink = SINK.search(body)
        before_sink = body[:sink.start()] if sink else body
        if not PERMISSION_CHECK.search(before_sink):
            reasons.append(
                'no permission check before the first write or return'
                + (' (session lookup only)' if SESSION_LOOKUP.search(body) else ' (no session lookup either)')
            )
        if reasons:
            flagged[name] = reasons
    return flagged


# (path regex, export-name regex) -> justification. A PENDING entry is a known
# gap awaiting a ruling, not an approval: it must not be copied as a pattern.
ALLOWLIST: list[tuple[str, str, str]] = [
    # --- session-only exports that act on the caller's own record only ---
    (r'app/\[locale\]/mfa-challenge/actions\.ts', r'completeMfaChallenge',
     'Subject is the pending-challenge session; completes the caller\'s own MFA step.'),
    (r'app/\[locale\]/setting/(?:mfa|accounts)/actions\.ts', r'\w+Action',
     'Every action derives the subject from the session and touches only that user\'s own MFA / account rows.'),
    (r'lib/setting/password-actions\.ts', r'verifyAndHashPassword',
     'Hashes the session user\'s own password input; reads no one else\'s data.'),
    (r'lib/setting/api-key-actions\.ts', r'(?:getApiKeyStatus|issueApiKey|setApiKeyExpiry)',
     'Subject is the session user; reads or replaces only that user\'s own API key hash and expiry; the new key is returned once.'),
    (r'lib/attachment/direct_actions\.ts', r'createDirectAttachment',
     'Actor comes from the session and the update is scoped to rows that actor uploaded and not yet linked.'),
    # --- delegating wrappers: the check lives in the delegate ---
    (r'lib/approval_request/actions\.ts', r'(?:approve|reject|withdraw)ApprovalRequest',
     'Thin wrappers over actions_core.ts, which resolves the session user and asserts approver role / '
     'order / requestor ownership and organization before any write.'),
    (r'app/\[locale\]/search/actions\.ts', r'searchEntities',
     'Session actor; buildSearchQuery re-derives that actor\'s per-entity read permission rows.'),
    (r'lib/dashboard/aggregate\.ts', r'aggregateForWidget',
     'Session actor handed to aggregateForWidgetCore, which raises PERMISSION_DENIED per entity.'),
    (r'lib/dashboard/readable-entities\.ts', r'getReadableDashboardEntityNames',
     'Session actor; returns only entity names the actor may read.'),
    (r'lib/mention/search\.ts', r'searchMentionUserOptions',
     'Session actor; getModelPermissions(\'user\', sessionUserId) and organization scope before the query.'),
    # --- lib/authz.ts: pure or session-own helpers ---
    (r'lib/authz\.ts', r'getSessionUserId(?:OrThrow)?|toPermissions|deriveRichPermissionsFromRows|assertPermission',
     'Pure functions or the caller\'s own session identity; no data access.'),
    # --- PENDING: known gaps ---
    (r'lib/authz\.ts',
     r'getPermissionRowsForUser|getModelPermissions|getUserRoleIds|canAccess(?:Entity|Record)'
     r'|require(?:Entity|Record)Permission|resolve(?:Entity|Record)Permissions'
     r'|invalidatePermissionCache',
     'PENDING (tracked publicly as #1214): accept an arbitrary subject / unauthenticated cache flush; '
     'not part of this change.'),
]
PENDING_ALLOWLIST_PATHS = {r'lib/authz\.ts'}

# Function-level (inline) directives in page files: each is an opts-only closure
# over a fetch*Page helper that itself checks session + read permission.
INLINE_DIRECTIVE_ALLOWLIST = {
    'app/[locale]/audit_log/page.tsx',
}
INLINE_DIRECTIVE_TEMPLATE_ALLOWLIST = {
    'code_generator/templates/page_list.tsx.jinja2',
}


def allowed(rel: str, name: str, used: set[int]) -> bool:
    for i, (path_rx, name_rx, why) in enumerate(ALLOWLIST):
        assert why.strip(), f'allow-list entry {i} has no justification'
        if re.fullmatch(path_rx, rel) and re.fullmatch(name_rx, name):
            used.add(i)
            return True
    return False


def _scan(root: Path, files, used: set[int]) -> list[str]:
    problems = []
    for path in files:
        rel = path.relative_to(root).as_posix()
        for name, reasons in findings_for(path.read_text()).items():
            if not allowed(rel, name, used):
                problems.append(f'{rel}: {name} -> {"; ".join(reasons)}')
    return problems


def _generate_schema_prisma_fixture(name: str, out: Path) -> None:
    fx = REPO_ROOT / 'code_generator' / 'tests' / 'fixtures' / name
    (out / 'prisma').mkdir(parents=True)
    shutil.copy(fx / 'schema.prisma', out / 'prisma' / 'schema.prisma')
    intermediate = out / 'generated_json_schema.yaml'
    build_user_schema(fx / 'json_schema.yaml', fx / 'schema.prisma', intermediate)
    generate(str(intermediate), str(out))


def _generate_version_of_fixture(out: Path) -> None:
    app = out / '_app'
    (app / 'code_generator').mkdir(parents=True)
    (app / 'prisma').mkdir()
    for f in ('json_schema.yaml', 'json_schema_internal.yaml'):
        shutil.copy(REPO_ROOT / 'code_generator' / f, app / 'code_generator')
    shutil.copy(REPO_ROOT / 'prisma' / 'schema.prisma', app / 'prisma')
    shutil.copytree(REPO_ROOT / 'messages', app / 'messages')
    result = subprocess.run([sys.executable, str(COMPOSE), str(VERSION_OF_FIXTURE_DIR), str(app)],
                            capture_output=True, text=True)
    assert result.returncode == 0, result.stderr
    gen = out / 'gen'
    (gen / 'prisma').mkdir(parents=True)
    shutil.copy(app / 'prisma' / 'schema.prisma', gen / 'prisma' / 'schema.prisma')
    # Write-once stubs the fixture places before generate-code.
    for p in (app / 'lib').rglob('*'):
        if p.is_file():
            dest = gen / p.relative_to(app)
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy(p, dest)
    intermediate = gen / 'generated_json_schema.yaml'
    build_user_schema(app / 'code_generator' / 'json_schema.yaml', app / 'prisma' / 'schema.prisma', intermediate)
    generate(str(intermediate), str(gen))


@pytest.fixture(scope='module')
def generated_roots(tmp_path_factory):
    roots = []
    for name in SCHEMA_PRISMA_FIXTURES:
        out = tmp_path_factory.mktemp(name)
        _generate_schema_prisma_fixture(name, out)
        roots.append(out)
    vo = tmp_path_factory.mktemp('version_of')
    _generate_version_of_fixture(vo)
    roots.append(vo / 'gen')
    return roots


def _source_files(root: Path):
    for sub in ('lib', 'app'):
        for p in sorted((root / sub).rglob('*')):
            if p.suffix in ('.ts', '.tsx') and not re.search(r'\.test\.tsx?$', p.name):
                yield p


def _tracked_paths(root: Path):
    """Paths git tracks under lib/ and app/, or None when git cannot say."""
    try:
        out = subprocess.run(['git', 'ls-files', '-z', '--', 'lib', 'app'], cwd=root,
                             capture_output=True, text=True, check=True).stdout
    except (OSError, subprocess.CalledProcessError):
        return None
    return {root / name for name in out.split('\0') if name}


# ---- the classifier itself (synthetic shapes) ----

_PREAMBLE = "'use server';\nimport prisma from '@/lib/prisma';\n"


def test_classifier_flags_a_lookup_with_no_check_at_all():
    text = _PREAMBLE + (
        'export async function getThingRecipient(id: string): Promise<{ a: string | null }> {\n'
        '  const row = await prisma.thing.findUnique({ where: { id } });\n'
        '  return { a: row?.owner_id ?? null };\n'
        '}\n'
    )
    assert list(findings_for(text)) == ['getThingRecipient']


def test_classifier_flags_a_session_bound_export_with_no_permission_check():
    text = _PREAMBLE + (
        "import { getSessionUserIdOrThrow } from '@/lib/authz';\n"
        'export async function submitThing(id: string): Promise<void> {\n'
        '  const actorId = await getSessionUserIdOrThrow();\n'
        '  await prisma.thing.update({ where: { id }, data: { status: 1, by: actorId } });\n'
        '}\n'
    )
    assert findings_for(text) == {
        'submitThing': ['no permission check before the first write or return (session lookup only)'],
    }


def test_classifier_flags_identity_parameter_even_when_a_check_runs():
    text = _PREAMBLE + (
        'export const getThingPage = cache(async (userId: string) => {\n'
        "  await requireEntityPermission('thing', 'read', userId);\n"
        '  return prisma.thing.findMany();\n'
        '});\n'
    )
    assert list(findings_for(text)) == ['getThingPage']


def test_classifier_accepts_a_session_derived_permission_check():
    text = _PREAMBLE + (
        'export async function listThings(): Promise<unknown[]> {\n'
        "  const perms = await getModelPermissions('thing');\n"
        "  await assertPermission(perms, 'read', 'thing');\n"
        '  return prisma.thing.findMany();\n'
        '}\n'
    )
    assert findings_for(text) == {}


def test_directive_matcher_handles_comments_and_runs_in_linear_time():
    import time

    assert DIRECTIVE.match("'use server'")
    assert DIRECTIVE.match('// note\n/* a */\n"use server"')
    assert DIRECTIVE.match('/* a ** b */ \'use server\'')
    assert not DIRECTIVE.match("export const x = 1\n'use server'")
    assert not DIRECTIVE.match('/* never closed\n\'use server\'')
    # An unterminated block comment followed by many comment openers must fail fast.
    start = time.perf_counter()
    assert not DIRECTIVE.match('/*' * 20000)
    assert time.perf_counter() - start < 0.5


def test_classifier_ignores_modules_without_the_directive():
    text = (
        'export async function getThingRecipient(id: string) {\n'
        '  return prisma.thing.findUnique({ where: { id } });\n'
        '}\n'
    )
    assert findings_for(text) == {}


# ---- the real tree and real generated output ----

def test_hand_maintained_directive_modules_have_no_unchecked_exports():
    used: set[int] = set()
    files = [p for p in _source_files(REPO_ROOT)
             if not re.search(r'/(?:api)/', p.relative_to(REPO_ROOT).as_posix())]
    problems = _scan(REPO_ROOT, files, used)
    assert problems == []


def test_generated_directive_modules_have_no_unchecked_exports(generated_roots):
    used: set[int] = set()
    problems = []
    scanned = 0
    for root in generated_roots:
        files = list(_source_files(root))
        scanned += len(files)
        problems += _scan(root, files, used)
    assert scanned > 0
    assert problems == []


def test_allow_list_has_no_stale_entries_and_pending_ones_are_exactly_the_known_gaps(generated_roots):
    used: set[int] = set()
    _scan(REPO_ROOT, [p for p in _source_files(REPO_ROOT)
                      if not re.search(r'/api/', p.relative_to(REPO_ROOT).as_posix())], used)
    for root in generated_roots:
        _scan(root, list(_source_files(root)), used)
    stale = [ALLOWLIST[i][:2] for i in range(len(ALLOWLIST)) if i not in used]
    assert stale == [], 'allow-list entries that matched nothing: remove them'
    pending = {path_rx for path_rx, _n, why in ALLOWLIST if why.startswith('PENDING')}
    assert pending == PENDING_ALLOWLIST_PATHS


def test_inline_function_level_directives_are_a_known_closed_set():
    # The module-level scan cannot see a directive inside a function body; list
    # every file that has one so a new one is a deliberate decision.
    # Only tracked files count: git-ignored generate-code output (app/[locale]/<entity>/)
    # appears in a worktree that ran generate-code and must not change the result.
    tracked = _tracked_paths(REPO_ROOT)
    sources = [p for p in _source_files(REPO_ROOT)
               if (tracked is None or p in tracked) and INLINE_DIRECTIVE.search(p.read_text()) and not DIRECTIVE.search(p.read_text())]
    found = {p.relative_to(REPO_ROOT).as_posix() for p in sources}
    templates = {
        p.relative_to(REPO_ROOT).as_posix()
        for p in (REPO_ROOT / 'code_generator' / 'templates').rglob('*.jinja2')
        if INLINE_DIRECTIVE.search(p.read_text()) and not DIRECTIVE.search(p.read_text())
    }
    assert found == INLINE_DIRECTIVE_ALLOWLIST
    assert templates == INLINE_DIRECTIVE_TEMPLATE_ALLOWLIST


# ---- the generated submit action authorizes before it judges ----

def test_generated_submit_action_checks_update_permission_before_the_transaction(generated_roots):
    vo_root = generated_roots[-1]
    files = sorted((vo_root / 'lib').glob('*/submit_actions.ts'))
    assert files, 'the version-of fixture must emit submit actions'
    for f in files:
        text = f.read_text()
        check = text.index("requireRecordPermission(")
        assert "'update'" in text[check:check + 120]
        lookup = text.index('_existing = await prisma.')
        assert lookup < check < text.index('prisma.$transaction')
        # a row that is not visible to the actor is answered like a missing row
        assert "throw new AppError('NOT_FOUND'" in text[lookup:check]
        if 'organization_id' in text[lookup:check]:
            assert 'getAssociatedOrganizations(actorId)' in text[:lookup + 200]


def test_submit_action_permission_op_follows_the_entity_x_generate_flags():
    # An entity whose schema disabled edit can never be granted 'update', so the
    # submit check falls back (update -> create -> read) like the split route.
    from generators import _seed_entity_grant_flags, _build_submit_for_approval_authz_code

    def op_for(gen):
        defs = {'thing': {'x-generate': gen}}
        grants = _seed_entity_grant_flags('thing', defs, True)
        return next((op for op in ('update', 'create', 'read') if grants[op]), 'read')

    assert op_for({}) == 'update'
    assert op_for({'edit': False}) == 'create'
    assert op_for({'edit': False, 'new': False}) == 'read'
    code = _build_submit_for_approval_authz_code('thing', 'thing', False, False, '{ id: true }', 'create')
    assert "requireRecordPermission('thing', 'create', _existing, actorId)" in code
