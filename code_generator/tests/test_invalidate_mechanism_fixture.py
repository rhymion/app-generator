"""
cmd_564: proves the generic `{ invalidated_at: null }` WHERE-clause mechanism
actually fires end-to-end through the real build_user_schema.py -> generate.py
pipeline (not just at the build_context()-unit-test level).

This repo's own json_schema.yaml has no `location` entity (it's a
proj_c/proj_g-only concept -- cmd_562's own report notes the same gap), so
the mechanism proof uses a small, self-contained fixture pair instead,
modeled on code_generator/tests/fixtures/mention_gate's pattern
(subtask_535a/cmd_535): `widget` (x-generate.invalidate.enabled: true) must
gain the filter, `gadget` (no invalidate config) must not.
"""
from pathlib import Path
import shutil

from build_user_schema import build_user_schema
from generate import generate

REPO_ROOT = Path(__file__).resolve().parents[2]
FIXTURE_DIR = REPO_ROOT / 'code_generator' / 'tests' / 'fixtures' / 'invalidate_gate'


def _run_pipeline(tmp_path: Path) -> Path:
    prisma_dir = tmp_path / 'prisma'
    prisma_dir.mkdir(parents=True, exist_ok=True)
    shutil.copy(FIXTURE_DIR / 'schema.prisma', prisma_dir / 'schema.prisma')

    intermediate = tmp_path / 'generated_json_schema.yaml'
    build_user_schema(
        FIXTURE_DIR / 'json_schema.yaml',
        FIXTURE_DIR / 'schema.prisma',
        intermediate,
    )
    generate(str(intermediate), str(tmp_path))
    return tmp_path


def test_can_invalidate_true_adds_where_filter(tmp_path):
    out = _run_pipeline(tmp_path)
    getters = (out / 'lib' / 'widget' / 'getters.ts').read_text()
    assert '{ invalidated_at: null },' in getters


def test_can_invalidate_false_omits_where_filter(tmp_path):
    out = _run_pipeline(tmp_path)
    getters = (out / 'lib' / 'gadget' / 'getters.ts').read_text()
    assert 'invalidated_at' not in getters
