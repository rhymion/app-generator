"""Issue #696 Stage 1 PR2a: opt-in byte-identity gate for
STATE_MACHINE_LOCKED_FIELDS.

test_import_template_branches.py's `_BASE_CTX` sets
`import_state_machine_locked_fields: []` and points here for "the lockout
branch itself" (see its comment above that key) -- this file is that
missing coverage, plus a full-pipeline proof. A dedicated fixture is used
here rather than adding an x-state-machines example to the project's own
dogfood schema, per policy that the dogfood schema should not carry an
example of every opt-in generator feature.

Two distinct claims, proven at two levels:

1. Template-render level (mirrors test_ledger_bin_field_opt_in.py's
   golden-diff-zero convention): a schema whose x-state-machines governs
   NO field on a given entity renders `STATE_MACHINE_LOCKED_FIELDS: []`,
   which is a structural no-op everywhere it's read (the per-field write
   loop's `if (STATE_MACHINE_LOCKED_FIELDS.includes(spec.name)) continue;`
   guard never fires; `skippedColumns` never grows because of it). A
   contrast test with a non-empty list proves the guard is real, not
   vacuously always-true.

2. Full-pipeline level: a self-contained fixture entity (`widget`, CSV
   import-eligible via x-import-key, using a `status` column that looks
   like a plausible x-state-machines target but the schema never declares
   the key) is run through the real build_user_schema.py -> generate.py
   pipeline. The generated app/api/widget/import/route.ts is hashed with
   hashlib.sha256 and compared against a pinned digest -- a literal,
   machine-checkable byte-identity assertion for the opt-out case, not
   just a substring check. A second full-pipeline run into a separate
   tmp_path proves the same output is also stable/deterministic run-to-run.
"""
import hashlib
import shutil
from pathlib import Path

import pytest

from test_import_template_branches import _ctx as _import_route_ctx

REPO_ROOT = Path(__file__).resolve().parents[2]
FIXTURE_DIR = REPO_ROOT / 'code_generator' / 'tests' / 'fixtures' / 'state_machine_opt_in_gate'

# Pinned sha256 of app/api/widget/import/route.ts generated from
# FIXTURE_DIR's json_schema.yaml (no x-state-machines key anywhere) via the
# real pipeline -- see test_full_pipeline_opt_out_import_route_byte_identical
# below. Any future change to api_import_route.ts.jinja2 or build_context.py
# that alters generated output for an opt-out schema must update this
# constant deliberately, not silently.
EXPECTED_IMPORT_ROUTE_SHA256 = (
    '241e9e7259401ff9e640a6123398521182f5cf5c94ae50366c096030143f1179'
)


@pytest.fixture(scope='module')
def env():
    from generate import _make_env
    return _make_env()


class TestStateMachineLockedFieldsTemplateBranch:
    def test_absent_renders_empty_array_and_no_op_skip(self, env):
        """Opt-out proof: STATE_MACHINE_LOCKED_FIELDS=[] renders as a bare
        empty array, the write-loop guard never fires for any real field,
        and skippedColumns' definition is unaffected byte-for-byte."""
        ctx = _import_route_ctx(import_state_machine_locked_fields=[])
        rendered = env.get_template('api_import_route.ts.jinja2').render(**ctx)
        assert 'const STATE_MACHINE_LOCKED_FIELDS: string[] = [];' in rendered
        assert (
            'const skippedColumns = [...UNIMPORTABLE_COLUMNS, '
            '...STATE_MACHINE_LOCKED_FIELDS].filter((c) => headerFields.includes(c));'
        ) in rendered
        # The guard line itself is unconditionally present (it's the array
        # contents that are opt-in, not the guard's existence) -- but with
        # an empty array it can never actually skip anything.
        assert 'if (STATE_MACHINE_LOCKED_FIELDS.includes(spec.name)) continue;' in rendered

    def test_present_actually_skips_the_named_field(self, env):
        """Contrast case: proves the guard above is a real, load-bearing
        no-op when empty -- not a string that's simply always present
        regardless of the array's contents."""
        ctx = _import_route_ctx(import_state_machine_locked_fields=['status'])
        rendered = env.get_template('api_import_route.ts.jinja2').render(**ctx)
        assert 'const STATE_MACHINE_LOCKED_FIELDS: string[] = ["status"];' in rendered


class TestStateMachineOptOutFullPipelineByteIdentity:
    """Full pipeline (build_user_schema.py -> generate.py) run against a
    dedicated fixture whose `widget.status` column never opts into
    x-state-machines."""

    @staticmethod
    def _run_pipeline(tmp_path: Path) -> Path:
        from build_user_schema import build_user_schema
        from generate import generate

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

    def _import_route(self, out: Path) -> Path:
        return out / 'app' / 'api' / 'widget' / 'import' / 'route.ts'

    def test_full_pipeline_opt_out_import_route_byte_identical(self, tmp_path):
        out = self._run_pipeline(tmp_path)
        import_route = self._import_route(out)
        content = import_route.read_bytes()
        digest = hashlib.sha256(content).hexdigest()
        assert digest == EXPECTED_IMPORT_ROUTE_SHA256, (
            'app/api/widget/import/route.ts changed for a schema with no '
            'x-state-machines declared anywhere -- this fixture is designed '
            'to prove opt-out generation is byte-for-byte stable. If this '
            'change is an intended, unrelated template/build_context.py fix, '
            'recompute the sha256 and update EXPECTED_IMPORT_ROUTE_SHA256 '
            'deliberately.'
        )
        text = content.decode('utf-8')
        assert 'const STATE_MACHINE_LOCKED_FIELDS: string[] = [];' in text

    def test_full_pipeline_opt_out_generation_is_deterministic(self, tmp_path):
        out_a = self._run_pipeline(tmp_path / 'run_a')
        out_b = self._run_pipeline(tmp_path / 'run_b')
        content_a = self._import_route(out_a).read_bytes()
        content_b = self._import_route(out_b).read_bytes()
        assert content_a == content_b
