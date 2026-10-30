"""Every permission check on a record names the record; every entity-only check says so.

`lib/authz.ts` has two families of permission functions (#1121):

- record-scoped (`resolveRecordPermissions`, `requireRecordPermission`,
  `canAccessRecord`, and `requireApiRecordPermission` in `lib/api-auth.ts`)
  take the record as a required argument and are the only path that resolves
  Creator / Assignee grants;
- entity-only (`resolveEntityPermissions`, `requireEntityPermission`,
  `canAccessEntity`, `requireApiPermission`) take no record and never resolve
  them.

The old names, whose record argument was optional, no longer exist. A call
site that forgets the record therefore fails type-checking, and this test
backs that up from the generator side: it enumerates every source that can put
a call into a generated app (the templates, the Python that emits call text,
the hand-written `lib/` and `app/` files) instead of searching for a guessed
name, and fails when
- an import from `@/lib/authz` or `@/lib/api-auth` names something that is not
  exported there,
- a removed name is still used, or
- a record-scoped call passes a literal `undefined` / `null` as its record.
"""
import pathlib
import re

import pytest

REPO_ROOT = pathlib.Path(__file__).resolve().parents[2]
GENERATOR_DIR = REPO_ROOT / 'code_generator'

_REMOVED = ('resolvePermissions', 'requirePermission', 'canAccess', 'ItemContext')
_RECORD_CALLS = {
    # function name -> index of the record argument
    'resolveRecordPermissions': 1,
    'requireRecordPermission': 2,
    'canAccessRecord': 2,
    'requireApiRecordPermission': 3,
}
_MODULES = {'@/lib/authz': 'lib/authz.ts', '@/lib/api-auth': 'lib/api-auth.ts'}


def _sources() -> dict:
    found = {}
    for path in sorted((GENERATOR_DIR / 'templates').glob('*.jinja2')):
        found[path.relative_to(REPO_ROOT).as_posix()] = path
    for path in sorted(GENERATOR_DIR.glob('*.py')):
        found[path.relative_to(REPO_ROOT).as_posix()] = path
    for root in ('lib', 'app', 'components', 'cypress'):
        for suffix in ('*.ts', '*.tsx'):
            for path in sorted((REPO_ROOT / root).rglob(suffix)):
                if not path.is_file() or path.name.endswith(('.test.ts', '.test.tsx')) or 'node_modules' in path.parts:
                    continue
                found[path.relative_to(REPO_ROOT).as_posix()] = path
    return found


def _exports(rel: str) -> set:
    text = (REPO_ROOT / rel).read_text(encoding='utf-8')
    names = set(re.findall(r'export\s+(?:async\s+)?(?:function|const|class)\s+(\w+)', text))
    names |= set(re.findall(r'export\s+(?:type|interface)\s+(\w+)', text))
    return names


def _calls(text: str, name: str):
    """Yield the argument list (top-level split) of every `name(` call in text."""
    for m in re.finditer(rf'(?<![\w.]){name}\(', text):
        depth, quote, i, args, cur = 1, None, m.end(), [], ''
        while i < len(text) and depth:
            ch = text[i]
            if quote:
                cur += ch
                if ch == quote:
                    quote = None
            elif ch in '\'"`':
                quote = ch
                cur += ch
            elif ch in '([{':
                depth += 1
                cur += ch
            elif ch in ')]}':
                depth -= 1
                if depth:
                    cur += ch
            elif ch == ',' and depth == 1:
                args.append(cur.strip())
                cur = ''
            else:
                cur += ch
            i += 1
        if cur.strip():
            args.append(cur.strip())
        yield args


def test_sources_are_found():
    sources = _sources()
    assert len(sources) > 100, 'source enumeration found suspiciously few files'
    assert 'code_generator/templates/api_detail_route.ts.jinja2' in sources
    assert 'code_generator/build_context.py' in sources
    assert 'lib/audit_log/getters.ts' in sources


def test_authz_exports_both_families():
    exports = _exports('lib/authz.ts')
    for name in ('resolveRecordPermissions', 'resolveEntityPermissions', 'requireRecordPermission',
                 'requireEntityPermission', 'canAccessRecord', 'canAccessEntity', 'RecordContext'):
        assert name in exports
    for name in _REMOVED:
        assert name not in exports
    assert {'requireApiPermission', 'requireApiRecordPermission'} <= _exports('lib/api-auth.ts')


@pytest.mark.parametrize('name', sorted(_sources()))
def test_source_uses_only_current_authz_names(name):
    text = _sources()[name].read_text(encoding='utf-8')
    # The comments in this repo's own docs about the removed names are not code.
    code = re.sub(r'(?m)^\s*(//|#|\*|/\*).*$', '', text)
    for removed in _REMOVED:
        assert not re.search(rf'(?<![\w.]){removed}\b(?!\w)', code), f'{name} still uses removed {removed}'
    for module, rel in _MODULES.items():
        exports = _exports(rel)
        for imported in re.findall(rf"import\s*\{{([^}}]*)\}}\s*from\s*'{re.escape(module)}'", code):
            for item in imported.split(','):
                item = re.sub(r'^\s*type\s+', '', item.strip()).split(' as ')[0].strip()
                if not item or '{' in item or '%' in item:
                    continue  # a Jinja conditional inside the import list
                assert item in exports, f'{name} imports {item}, which {rel} does not export'


@pytest.mark.parametrize('name', sorted(_sources()))
def test_record_scoped_calls_pass_a_record(name):
    text = _sources()[name].read_text(encoding='utf-8')
    for fn, index in _RECORD_CALLS.items():
        for args in _calls(text, fn):
            if len(args) <= index:
                continue  # a signature or a call being documented, not a call site
            assert args[index] not in ('undefined', 'null', 'item ?? undefined'), (
                f'{name}: {fn}({", ".join(args)}) has no record')
            assert not re.search(r'\?\?\s*(undefined|null)\s*$', args[index]), (
                f'{name}: {fn}({", ".join(args)}) can pass no record')
