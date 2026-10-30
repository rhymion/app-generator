"""
Modules that start with a module-level server-function directive register
every export as an independently callable endpoint, whatever the intended
callers are. Helpers that take the acting user (or already-loaded
permissions) as a parameter and trust it must therefore live in a plain
internal module with no directive, and only functions that derive the actor
from the session may stay in the directive module.

Checks both the hand-maintained lib modules and real generated output, so a
new parameter-trusting export in a directive module fails here.

Run:
    cd code_generator && python3 -m pytest tests/test_server_function_module_exports.py -v
"""
from pathlib import Path
import re
import shutil
import tempfile

from build_user_schema import build_user_schema
from generate import generate

REPO_ROOT = Path(__file__).resolve().parents[2]
FIXTURE_DIR = REPO_ROOT / 'code_generator' / 'tests' / 'fixtures' / 'invalidate_gate'

DIRECTIVE = re.compile(r"""\A(?:\s*//[^\n]*\n|\s*/\*.*?\*/)*\s*['"]use server['"]""", re.S)
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
