"""
Regression test (subtask_1176c): getters.ts.jinja2's detail/list getters
must opt in to Prisma's `relationLoadStrategy: 'join'` (requires
`previewFeatures = ["relationJoins"]`, added to prisma/schema.prisma's
`generator client` block) whenever the query already carries an `include:`
for a relation -- and must NOT emit the option at all when there is no
relation to load (a bare `findMany` with no `include:`).

Why this matters: without an explicit `relationLoadStrategy`, Prisma's
default strategy for a relational connector issues one SEPARATE query per
relation (each on its own pooled connection) instead of folding them into
the main query via a database-level JOIN. Live-DB measurement in
subtask_1176c (isolated worktree, PrismaPg driver adapter, Postgres 18)
confirmed the reduction directly: this repo's own dogfood `dashboard`
entity's `getDashboardDetail` dropped from 5 queries to 1, and
`organization`'s `getOrganizationDetail` from 4 queries to 1, after adding
this option -- see subtask_1176c's report for the full before/after query
log. This test cannot re-run that live-DB comparison (no DB in this
suite), so it instead locks in the generated-source-level precondition for
that behavior: the option must actually be present in the rendered
TypeScript wherever `include:` is, and absent where it is not.

Fixtures:
  - decimal_gate (code_generator/tests/fixtures/decimal_gate): its
    `decimal_gate_wrapper` entity embeds a one-to-many relation (`lines`)
    and a many-to-one FK (`primary_item_id`) with `view: true` -- exercises
    the DETAIL getter's `include_props_detail` branch. Every audited
    entity's detail getter also always embeds creator/updater, so a
    relation-less detail getter does not occur among generated CRUD
    entities -- no negative control is meaningful for this branch.
  - This repo's own dogfood schema (code_generator/json_schema.yaml +
    prisma/schema.prisma) for the LIST getter's `include_props_list`
    branch, which -- unlike the detail getter -- is genuinely empty for
    most entities (creator/updater are not embedded in the plain list
    query): `permission` (`include: { role: true }`, a many-to-one FK
    with a labelField) is the positive case, `organization` (no
    many-to-one FK relation at all) is the negative control.

Run:
    cd code_generator && python3 -m pytest tests/test_relation_joins_load_strategy.py -v
"""
from pathlib import Path
import shutil
import tempfile

from build_user_schema import build_user_schema
from generate import generate

REPO_ROOT = Path(__file__).resolve().parents[2]


def _run_pipeline(schema_yaml: Path, prisma_schema: Path, tmp_path: Path) -> Path:
    prisma_dir = tmp_path / 'prisma'
    prisma_dir.mkdir(parents=True, exist_ok=True)
    shutil.copy(prisma_schema, prisma_dir / 'schema.prisma')

    intermediate = tmp_path / 'generated_json_schema.yaml'
    build_user_schema(schema_yaml, prisma_schema, intermediate)
    generate(str(intermediate), str(tmp_path))
    return tmp_path


def _run_fixture_pipeline(fixture_name: str, tmp_path: Path) -> Path:
    fixture_dir = REPO_ROOT / 'code_generator' / 'tests' / 'fixtures' / fixture_name
    return _run_pipeline(
        fixture_dir / 'json_schema.yaml', fixture_dir / 'schema.prisma', tmp_path,
    )


def _run_dogfood_pipeline(tmp_path: Path) -> Path:
    return _run_pipeline(
        REPO_ROOT / 'code_generator' / 'json_schema.yaml',
        REPO_ROOT / 'prisma' / 'schema.prisma',
        tmp_path,
    )


def test_schema_prisma_declares_relation_joins_preview_feature():
    """The hand-maintained prisma/schema.prisma (this repo's own dogfood
    schema, not a fixture -- the generator itself does not template this
    file, see subtask_1176c's report) must declare the preview feature
    every relationLoadStrategy option below depends on."""
    schema = (REPO_ROOT / 'prisma' / 'schema.prisma').read_text()
    assert 'previewFeatures = ["relationJoins"]' in schema, (
        "prisma/schema.prisma's generator client block is missing "
        'previewFeatures = ["relationJoins"] -- every relationLoadStrategy: '
        "'join' option emitted by getters.ts.jinja2 requires it, or "
        '`prisma generate`/`db:push` fails outright.'
    )


def test_detail_getter_uses_join_strategy_when_relation_is_included():
    with tempfile.TemporaryDirectory() as tmp:
        out = _run_fixture_pipeline('decimal_gate', Path(tmp))
        getters = (out / 'lib' / 'decimal_gate_wrapper' / 'getters.ts').read_text()
        assert 'include: {' in getters, getters
        assert "relationLoadStrategy: 'join'," in getters, (
            "decimal_gate_wrapper's getDetail includes relations (lines, "
            "primary_item) but the generated getters.ts has no "
            "relationLoadStrategy: 'join' option -- each relation will be "
            'fetched as a SEPARATE query instead of folded into the main '
            'query via a database-level JOIN.'
        )


def _list_getter_body(getters_ts: str, model: str) -> str:
    marker = f'prisma.{model}.findMany({{'
    start = getters_ts.index('const [rowsRaw, total] = await Promise.all([')
    end = getters_ts.index(f'prisma.{model}.count({{ where }}),', start)
    return getters_ts[start:end]


def test_list_getter_uses_join_strategy_when_relation_is_included():
    """permission has a many-to-one FK (role, with a labelField) that
    build_context.py's parent_rels mechanism embeds directly into the LIST
    query (unlike creator/updater, which only the detail getter embeds)."""
    with tempfile.TemporaryDirectory() as tmp:
        out = _run_dogfood_pipeline(Path(tmp))
        getters = (out / 'lib' / 'permission' / 'getters.ts').read_text()
        body = _list_getter_body(getters, 'permission')
        assert 'include: { role: true }' in body, body
        assert "relationLoadStrategy: 'join'," in body, (
            "permission's list getter includes the `role` relation but the "
            "generated getters.ts has no relationLoadStrategy: 'join' "
            'option in that call.'
        )


def test_no_relation_load_strategy_emitted_in_list_getter_without_a_relation():
    """Negative control: organization has no many-to-one FK relation of its
    own (only creator/updater, which the LIST getter never embeds -- only
    the detail getter does), so its list getter's `findMany` has no
    `include:` and must not carry a stray relationLoadStrategy option
    either -- a sign the Jinja2 conditional guard broke and started
    emitting unconditionally."""
    with tempfile.TemporaryDirectory() as tmp:
        out = _run_dogfood_pipeline(Path(tmp))
        getters = (out / 'lib' / 'organization' / 'getters.ts').read_text()
        body = _list_getter_body(getters, 'organization')
        assert 'include:' not in body, body
        assert 'relationLoadStrategy' not in body, (
            "organization's list getter has no `include:` (no many-to-one "
            'FK relation of its own) so it must not emit relationLoadStrategy '
            'either -- the option is meaningless without an accompanying '
            '`include:`.'
        )
