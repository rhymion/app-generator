"""cmd_893: an allOf proxy entity with no Prisma model of its own (model !=
parent, e.g. the real schema's `setting` -> `user`) must never get a
lib/<parent>/service_validation_custom.ts stub written for it.

service_validation.ts.jinja2 always imports validateCustomRules from
'@/lib/{{ model }}/service_validation_custom' -- the resolved Prisma
model's dir, not the entity's own dir. For a non-proxy entity model ==
parent, so this is the same directory the stub is written into. For a
proxy entity model != parent, so a stub written under the proxy's own
lib dir is never imported by anything -- a dead file every generate-code
run.

Uses a small, self-contained fixture pair (widget: real model, control;
widget_proxy: allOf proxy of widget, no Prisma model), modeled on
code_generator/tests/fixtures/invalidate_gate's pattern, run through the
real build_user_schema.py -> generate.py pipeline (not just at the
extract_entities()-unit-test level).
"""
from pathlib import Path
import shutil

from build_user_schema import build_user_schema
from generate import generate

REPO_ROOT = Path(__file__).resolve().parents[2]
FIXTURE_DIR = REPO_ROOT / 'code_generator' / 'tests' / 'fixtures' / 'proxy_stub_gate'


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


def test_proxy_entity_gets_no_dead_service_validation_custom_stub(tmp_path):
    out = _run_pipeline(tmp_path)
    stub = out / 'lib' / 'widget_proxy' / 'service_validation_custom.ts'
    assert not stub.exists(), (
        'widget_proxy is an allOf proxy of widget (model != parent) -- '
        'its service_validation.ts imports validateCustomRules from '
        "'@/lib/widget/service_validation_custom', never from its own "
        'lib dir, so no stub should be written here'
    )


def test_proxy_entity_service_validation_imports_base_model_dir(tmp_path):
    out = _run_pipeline(tmp_path)
    content = (out / 'lib' / 'widget_proxy' / 'service_validation.ts').read_text()
    assert "from '@/lib/widget/service_validation_custom'" in content


def test_base_model_entity_still_gets_its_stub(tmp_path):
    """Negative control: a non-proxy entity (model == parent) must keep
    getting its service_validation_custom.ts stub -- this fix must not
    regress the normal case."""
    out = _run_pipeline(tmp_path)
    stub = out / 'lib' / 'widget' / 'service_validation_custom.ts'
    assert stub.exists()
    assert 'export async function validateCustomRules' in stub.read_text()
