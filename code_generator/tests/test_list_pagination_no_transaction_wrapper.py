"""
Regression test (P2028 hotfix, subtask_1163): list-page pagination
(`get{Parent}Page()` in getters.ts.jinja2) must run its `findMany` and
`count` queries as two independent queries via `Promise.all`, NOT
serialized inside a single `prisma.$transaction([...])` (the batch/array
form).

Before this fix, both queries were bundled into `prisma.$transaction([...])`
with no explicit `maxWait`/`timeout`, so Prisma's default `maxWait` (2000ms
-- confirmed via `@prisma/client/runtime/client.d.ts`'s
`PrismaClientBaseOptions.transactionOptions` doc comment: "maxWait ?= 2000")
applied. Under concurrent load (PRISMA_POOL_MAX=5, with the cross-entity
search endpoint's own Promise.all-based queries also competing for pooled
connections), the batch transaction could not always acquire both member
queries' connections within 2000ms, producing P2028 ("Unable to start a
transaction in the given time") on every list endpoint with this pattern --
reproduced against real-scale (N=30,000) load testing at PRISMA_POOL_MAX=5.

Uses the same full build_user_schema -> generate pipeline and
`invalidate_gate` fixture as test_invalidate_mechanism_fixture.py, so this
checks real generated output, not a hand-built minimal Jinja2 context.

Run:
    cd code_generator && python3 -m pytest tests/test_list_pagination_no_transaction_wrapper.py -v
"""
from pathlib import Path
import shutil
import tempfile

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


def test_no_batch_transaction_wrapper_in_list_page_getter():
    """Deviation injection: the pre-fix shape wrapped findMany+count in
    `prisma.$transaction([...])` (the batch/array form). Confirm that shape
    is entirely gone from the generated getter for every entity, not just
    that Promise.all appears somewhere nearby (the surrounding function has
    other, unrelated Promise.all/permission-fetch calls elsewhere in the
    file that must not false-positive this check).
    """
    with tempfile.TemporaryDirectory() as tmp:
        out = _run_pipeline(Path(tmp))
        for entity in ('widget', 'gadget', 'sprocket'):
            getters = (out / 'lib' / entity / 'getters.ts').read_text()
            assert 'await prisma.$transaction([' not in getters, (
                f'lib/{entity}/getters.ts still wraps findMany+count in '
                'prisma.$transaction([...]) (batch form) -- this is exactly '
                "the P2028-under-load regression the fix removed (no explicit "
                "maxWait was ever passed, so Prisma's 2000ms default batch-"
                'transaction maxWait applied).'
            )


def test_find_many_and_count_run_independently_via_promise_all():
    with tempfile.TemporaryDirectory() as tmp:
        out = _run_pipeline(Path(tmp))
        getters = (out / 'lib' / 'widget' / 'getters.ts').read_text()
        assert 'const [rowsRaw, total] = await Promise.all([' in getters, getters
        assert 'prisma.widget.findMany({' in getters
        assert 'prisma.widget.count({ where }),' in getters
