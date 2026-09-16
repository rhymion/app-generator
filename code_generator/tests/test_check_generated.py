"""Tests for code_generator/check_generated.py.

Each test stands up a synthetic project tree (a minimal schema YAML plus
hand-crafted `lib/`, `app/`, `components/` files) so we can exercise the
banned-pattern detection without depending on the real json_schema.yaml.
"""
from __future__ import annotations

from pathlib import Path
from textwrap import dedent

import pytest

from check_generated import check


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

_MIN_SCHEMA = dedent("""
    $schema: "http://json-schema.org/draft-07/schema#"
    definitions:
      __widget:
        type: object
        required: [id, name]
        properties:
          id:
            type: string
            pattern: "^c[a-z0-9]{24,}$"
          name:
            type: string
        x-generate:
          list: true
          view: true
          new: true
          edit: true
          delete: true
          api: true
""").lstrip()


def _make_tree(tmp_path: Path) -> Path:
    """Lay out a project root with the schema + empty target dirs."""
    schema_path = tmp_path / 'json_schema.yaml'
    schema_path.write_text(_MIN_SCHEMA)
    for sub in (
        'lib/widget',
        'components/widget',
        'app/[locale]/widget',
        'app/[locale]/widget/new',
        'app/[locale]/widget/edit/[id]',
        'app/[locale]/widget/view/[id]',
        'app/api/widget',
        'app/api/widget/[id]',
        'app/api/widget/bulk',
    ):
        (tmp_path / sub).mkdir(parents=True, exist_ok=True)
    return schema_path


def _empty_allowlist(tmp_path: Path) -> Path:
    path = tmp_path / 'allowlist.yaml'
    path.write_text('exemptions: []\n')
    return path


# ---------------------------------------------------------------------------
# Raw-query rule
# ---------------------------------------------------------------------------

def test_queryraw_in_service_is_flagged(tmp_path: Path) -> None:
    schema = _make_tree(tmp_path)
    (tmp_path / 'lib/widget/service.ts').write_text(
        "import prisma from '@/lib/prisma';\n"
        "export async function bad() {\n"
        "  return await prisma.$queryRaw`SELECT 1`;\n"
        "}\n"
    )
    vs = check(schema, tmp_path, _empty_allowlist(tmp_path))
    assert len(vs) == 1
    assert vs[0].rule == 'raw:queryRaw'
    assert vs[0].path == 'lib/widget/service.ts'
    assert vs[0].line == 3


def test_executeraw_unsafe_in_action_is_flagged(tmp_path: Path) -> None:
    schema = _make_tree(tmp_path)
    (tmp_path / 'lib/widget/actions.ts').write_text(
        "import prisma from '@/lib/prisma';\n"
        "export async function bad() {\n"
        "  await prisma.$executeRawUnsafe('DELETE FROM widget');\n"
        "}\n"
    )
    vs = check(schema, tmp_path, _empty_allowlist(tmp_path))
    rules = {v.rule for v in vs}
    assert rules == {'raw:executeRawUnsafe'}


def test_raw_in_api_route_is_flagged(tmp_path: Path) -> None:
    schema = _make_tree(tmp_path)
    (tmp_path / 'app/api/widget/route.ts').write_text(
        "import prisma from '@/lib/prisma';\n"
        "export async function GET() {\n"
        "  await prisma.$queryRawUnsafe('SELECT 1');\n"
        "}\n"
    )
    vs = check(schema, tmp_path, _empty_allowlist(tmp_path))
    assert any(v.rule == 'raw:queryRawUnsafe' for v in vs)


# ---------------------------------------------------------------------------
# Direct-write rule
# ---------------------------------------------------------------------------

def test_direct_write_in_api_route_is_flagged(tmp_path: Path) -> None:
    schema = _make_tree(tmp_path)
    (tmp_path / 'app/api/widget/route.ts').write_text(
        "import prisma from '@/lib/prisma';\n"
        "export async function POST() {\n"
        "  await prisma.widget.create({ data: { name: 'x' } });\n"
        "}\n"
    )
    vs = check(schema, tmp_path, _empty_allowlist(tmp_path))
    assert len(vs) == 1
    assert vs[0].rule == 'write:direct'
    assert vs[0].path == 'app/api/widget/route.ts'


def test_direct_write_in_action_is_flagged(tmp_path: Path) -> None:
    schema = _make_tree(tmp_path)
    (tmp_path / 'lib/widget/actions.ts').write_text(
        "import prisma from '@/lib/prisma';\n"
        "export async function remove(ids: string[]) {\n"
        "  await prisma.widget.deleteMany({ where: { id: { in: ids } } });\n"
        "}\n"
    )
    vs = check(schema, tmp_path, _empty_allowlist(tmp_path))
    assert any(v.rule == 'write:direct' for v in vs)


def test_direct_write_in_page_is_flagged(tmp_path: Path) -> None:
    schema = _make_tree(tmp_path)
    (tmp_path / 'app/[locale]/widget/new/page.tsx').write_text(
        "import prisma from '@/lib/prisma';\n"
        "export default async function NewWidget() {\n"
        "  await prisma.widget.upsert({ where: { id: 'x' }, create: {}, update: {} });\n"
        "  return null;\n"
        "}\n"
    )
    vs = check(schema, tmp_path, _empty_allowlist(tmp_path))
    assert any(v.rule == 'write:direct' for v in vs)


def test_direct_write_in_service_is_allowed(tmp_path: Path) -> None:
    schema = _make_tree(tmp_path)
    (tmp_path / 'lib/widget/service.ts').write_text(
        "import prisma from '@/lib/prisma';\n"
        "export async function addWidget() {\n"
        "  await prisma.widget.create({ data: { name: 'x' } });\n"
        "  await prisma.widget.update({ where: { id: 'x' }, data: { name: 'y' } });\n"
        "  await prisma.widget.delete({ where: { id: 'x' } });\n"
        "}\n"
    )
    assert check(schema, tmp_path, _empty_allowlist(tmp_path)) == []


def test_direct_write_in_service_validation_is_allowed(tmp_path: Path) -> None:
    schema = _make_tree(tmp_path)
    (tmp_path / 'lib/widget/service_validation.ts').write_text(
        "import prisma from '@/lib/prisma';\n"
        "export async function validate() {\n"
        "  await prisma.widget.update({ where: { id: 'x' }, data: {} });\n"
        "}\n"
    )
    assert check(schema, tmp_path, _empty_allowlist(tmp_path)) == []


def test_direct_write_in_service_after_create_is_allowed(tmp_path: Path) -> None:
    schema = _make_tree(tmp_path)
    (tmp_path / 'lib/widget/service_after_create.ts').write_text(
        "import prisma from '@/lib/prisma';\n"
        "export async function afterCreate() {\n"
        "  await prisma.widget.update({ where: { id: 'x' }, data: {} });\n"
        "}\n"
    )
    assert check(schema, tmp_path, _empty_allowlist(tmp_path)) == []


# ---------------------------------------------------------------------------
# Reads remain unaffected
# ---------------------------------------------------------------------------

def test_reads_in_api_route_are_allowed(tmp_path: Path) -> None:
    schema = _make_tree(tmp_path)
    (tmp_path / 'app/api/widget/[id]/route.ts').write_text(
        "import prisma from '@/lib/prisma';\n"
        "export async function GET() {\n"
        "  await prisma.widget.findUnique({ where: { id: 'x' } });\n"
        "  await prisma.widget.findMany({});\n"
        "  await prisma.widget.findFirst({});\n"
        "  await prisma.widget.count({});\n"
        "}\n"
    )
    assert check(schema, tmp_path, _empty_allowlist(tmp_path)) == []


def test_reads_in_action_are_allowed(tmp_path: Path) -> None:
    schema = _make_tree(tmp_path)
    (tmp_path / 'lib/widget/actions.ts').write_text(
        "import prisma from '@/lib/prisma';\n"
        "export async function remove(ids: string[]) {\n"
        "  const widgets = await prisma.widget.findMany({\n"
        "    where: { id: { in: ids } },\n"
        "    select: { id: true, creator_id: true },\n"
        "  });\n"
        "  return widgets;\n"
        "}\n"
    )
    assert check(schema, tmp_path, _empty_allowlist(tmp_path)) == []


# ---------------------------------------------------------------------------
# Allowlist
# ---------------------------------------------------------------------------

def test_allowlist_exempts_specific_line(tmp_path: Path) -> None:
    schema = _make_tree(tmp_path)
    (tmp_path / 'app/api/widget/route.ts').write_text(
        "import prisma from '@/lib/prisma';\n"
        "export async function POST() {\n"
        "  await prisma.widget.create({ data: { name: 'allowed' } });\n"
        "}\n"
    )
    allow = tmp_path / 'allowlist.yaml'
    allow.write_text(
        "exemptions:\n"
        "  - path: app/api/widget/route.ts\n"
        "    pattern: write:direct\n"
        "    substring: \"prisma.widget.create\"\n"
        "    reason: 'covered in PR #123'\n"
    )
    assert check(schema, tmp_path, allow) == []


def test_allowlist_substring_must_match_line(tmp_path: Path) -> None:
    schema = _make_tree(tmp_path)
    (tmp_path / 'app/api/widget/route.ts').write_text(
        "import prisma from '@/lib/prisma';\n"
        "export async function POST() {\n"
        "  await prisma.widget.create({ data: { name: 'x' } });\n"
        "}\n"
    )
    allow = tmp_path / 'allowlist.yaml'
    allow.write_text(
        "exemptions:\n"
        "  - path: app/api/widget/route.ts\n"
        "    pattern: write:direct\n"
        "    substring: \"prisma.gadget.create\"\n"
        "    reason: 'wrong model name; should not exempt'\n"
    )
    vs = check(schema, tmp_path, allow)
    assert len(vs) == 1


def test_allowlist_missing_field_errors_out(tmp_path: Path) -> None:
    schema = _make_tree(tmp_path)
    allow = tmp_path / 'allowlist.yaml'
    allow.write_text(
        "exemptions:\n"
        "  - path: app/api/widget/route.ts\n"
        "    pattern: write:direct\n"
        "    substring: foo\n"
    )
    with pytest.raises(SystemExit):
        check(schema, tmp_path, allow)


# ---------------------------------------------------------------------------
# Out-of-scope dirs
# ---------------------------------------------------------------------------

def test_app_generated_is_ignored(tmp_path: Path) -> None:
    schema = _make_tree(tmp_path)
    # app/generated/ holds Prisma's own client code; the check must never
    # walk into it. The enumeration is schema-driven, so simulate a stray
    # file there and confirm it isn't picked up.
    generated = tmp_path / 'app' / 'generated' / 'prisma' / 'internal'
    generated.mkdir(parents=True)
    (generated / 'class.ts').write_text(
        "export class Anything { $queryRaw() {} $executeRaw() {} }\n"
    )
    assert check(schema, tmp_path, _empty_allowlist(tmp_path)) == []


def test_hand_written_files_outside_generated_set_are_ignored(tmp_path: Path) -> None:
    schema = _make_tree(tmp_path)
    # A file the generator never produces (e.g. a custom lib helper) is
    # left to ESLint / code review, not this check.
    (tmp_path / 'lib').mkdir(exist_ok=True)
    (tmp_path / 'lib' / 'custom-helper.ts').write_text(
        "import prisma from '@/lib/prisma';\n"
        "await prisma.$queryRaw`SELECT 1`;\n"
    )
    assert check(schema, tmp_path, _empty_allowlist(tmp_path)) == []


# ---------------------------------------------------------------------------
# Unexplained-login rule (cmd_658)
# ---------------------------------------------------------------------------

def _api_test_dir(tmp_path: Path) -> Path:
    d = tmp_path / 'cypress' / 'e2e' / 'api'
    d.mkdir(parents=True, exist_ok=True)
    return d


def test_unmarked_login_in_generated_api_spec_is_flagged(tmp_path: Path) -> None:
    schema = _make_tree(tmp_path)
    (_api_test_dir(tmp_path) / 'widget.cy.ts').write_text(
        "describe('API: Widget', () => {\n"
        "  it('does something', () => {\n"
        "    cy.login('a@example.com', 'pw');\n"
        "  });\n"
        "});\n"
    )
    vs = check(schema, tmp_path, _empty_allowlist(tmp_path))
    assert len(vs) == 1
    assert vs[0].rule == 'test:unexplained-login'
    assert vs[0].path == 'cypress/e2e/api/widget.cy.ts'
    assert vs[0].line == 3


def test_login_with_nearby_marker_is_allowed(tmp_path: Path) -> None:
    schema = _make_tree(tmp_path)
    (_api_test_dir(tmp_path) / 'widget.cy.ts').write_text(
        "describe('API: Widget', () => {\n"
        "  // dual-auth-session-canary: proves the session-cookie path too\n"
        "  it('also authenticates via session cookie', () => {\n"
        "    cy.login('a@example.com', 'pw');\n"
        "  });\n"
        "});\n"
    )
    assert check(schema, tmp_path, _empty_allowlist(tmp_path)) == []


def test_marker_more_than_lookback_away_does_not_exempt(tmp_path: Path) -> None:
    schema = _make_tree(tmp_path)
    filler = ''.join(f'  // filler line {i}\n' for i in range(10))
    (_api_test_dir(tmp_path) / 'widget.cy.ts').write_text(
        "describe('API: Widget', () => {\n"
        "  // dual-auth-session-canary: too far above to count\n"
        f"{filler}"
        "  it('does something', () => {\n"
        "    cy.login('a@example.com', 'pw');\n"
        "  });\n"
        "});\n"
    )
    vs = check(schema, tmp_path, _empty_allowlist(tmp_path))
    assert len(vs) == 1
    assert vs[0].rule == 'test:unexplained-login'


def test_login_mentioned_only_in_a_comment_is_not_a_call(tmp_path: Path) -> None:
    schema = _make_tree(tmp_path)
    (_api_test_dir(tmp_path) / 'widget.cy.ts').write_text(
        "describe('API: Widget', () => {\n"
        "  // this route used to require cy.login(), not anymore\n"
        "  it('does something', () => {\n"
        "    cy.request({ url: '/api/widget' });\n"
        "  });\n"
        "});\n"
    )
    assert check(schema, tmp_path, _empty_allowlist(tmp_path)) == []


def test_login_rule_is_not_allowlist_exemptable(tmp_path: Path) -> None:
    schema = _make_tree(tmp_path)
    (_api_test_dir(tmp_path) / 'widget.cy.ts').write_text(
        "describe('API: Widget', () => {\n"
        "  it('does something', () => {\n"
        "    cy.login('a@example.com', 'pw');\n"
        "  });\n"
        "});\n"
    )
    allow = tmp_path / 'allowlist.yaml'
    allow.write_text(
        "exemptions:\n"
        "  - path: cypress/e2e/api/widget.cy.ts\n"
        "    pattern: test:unexplained-login\n"
        "    substring: \"cy.login\"\n"
        "    reason: 'trying to exempt via YAML instead of the in-file marker'\n"
    )
    vs = check(schema, tmp_path, allow)
    assert len(vs) == 1
    assert vs[0].rule == 'test:unexplained-login'


def test_login_in_non_api_test_dir_is_out_of_scope(tmp_path: Path) -> None:
    schema = _make_tree(tmp_path)
    # UI specs (cypress/e2e/widget.cy.ts, not .../api/widget.cy.ts) are a
    # different file entirely — this rule only walks generated API specs.
    (tmp_path / 'cypress' / 'e2e').mkdir(parents=True, exist_ok=True)
    (tmp_path / 'cypress' / 'e2e' / 'widget.cy.ts').write_text(
        "describe('Widget UI', () => {\n"
        "  it('logs in through the screen', () => {\n"
        "    cy.login('a@example.com', 'pw');\n"
        "  });\n"
        "});\n"
    )
    assert check(schema, tmp_path, _empty_allowlist(tmp_path)) == []


def test_api_disabled_entity_has_no_login_spec_to_scan(tmp_path: Path) -> None:
    # api: false entities never get a cypress/e2e/api/<parent>.cy.ts file —
    # confirm the enumeration doesn't invent one to scan.
    schema_path = tmp_path / 'json_schema.yaml'
    schema_path.write_text(_MIN_SCHEMA.replace('api: true', 'api: false'))
    for sub in ('lib/widget', 'components/widget', 'app/[locale]/widget'):
        (tmp_path / sub).mkdir(parents=True, exist_ok=True)
    _api_test_dir(tmp_path)  # dir exists, but no widget.cy.ts written into it
    assert check(schema_path, tmp_path, _empty_allowlist(tmp_path)) == []
