"""
The audit_log storage factory and jobs are opt-in: x-generator.audit-log-storage.enabled (default false).

Runs the real build_user_schema.py -> generate.py pipeline on tests/fixtures/decimal_gate with the flag true,
false and absent. With the flag off nothing under lib/audit-log-ops/ is generated and no generated file
mentions a storage adapter or storage SDK, so an app that does not opt in sees no effect from the feature.

Run:
    cd code_generator && python3 -m pytest tests/test_audit_log_storage_flag.py -v
"""
import re
import shutil
from pathlib import Path

import pytest
import yaml

from build_user_schema import build_user_schema
from generate import generate
from validate import SchemaValidationError, audit_log_storage_enabled, validate_generator_config

FIXTURE = Path(__file__).resolve().parent / 'fixtures' / 'decimal_gate'
REPO_ROOT = Path(__file__).resolve().parents[2]
ADAPTER_MARKERS = ('storage-gcs', 'storage-s3', '@google-cloud/storage', '@aws-sdk/client-s3')


def _build(tmp_path: Path, value) -> Path:
    """Generate the fixture into tmp_path; `value` is the x-generator.audit-log-storage value, or 'absent'."""
    prisma_dir = tmp_path / 'prisma'
    prisma_dir.mkdir(parents=True)
    shutil.copy(FIXTURE / 'schema.prisma', prisma_dir / 'schema.prisma')
    intermediate = tmp_path / 'generated_json_schema.yaml'
    build_user_schema(FIXTURE / 'json_schema.yaml', FIXTURE / 'schema.prisma', intermediate)
    schema = yaml.safe_load(intermediate.read_text())
    gen = schema.setdefault('x-generator', {})
    if value == 'absent':
        gen.pop('audit-log-storage', None)
    else:
        gen['audit-log-storage'] = value
    intermediate.write_text(yaml.safe_dump(schema))
    generate(str(intermediate), str(tmp_path))
    return tmp_path


def _generated_files(out: Path):
    return [p for p in out.rglob('*') if p.is_file() and 'node_modules' not in p.parts and p.suffix in {'.ts', '.tsx', '.json'}]


@pytest.fixture(scope='module')
def out_true(tmp_path_factory):
    return _build(tmp_path_factory.mktemp('als_true'), {'enabled': True})


@pytest.fixture(scope='module')
def out_false(tmp_path_factory):
    return _build(tmp_path_factory.mktemp('als_false'), {'enabled': False})


@pytest.fixture(scope='module')
def out_absent(tmp_path_factory):
    return _build(tmp_path_factory.mktemp('als_absent'), 'absent')


def test_flag_true_generates_factory_and_jobs(out_true):
    factory = (out_true / 'lib' / 'audit-log-ops' / 'storage-factory.ts').read_text()
    assert 'createAuditLogStorageFromEnv' in factory
    assert 'Audit log storage is not configured' in factory
    assert (out_true / 'lib' / 'audit-log-ops' / 'jobs.ts').exists()


@pytest.mark.parametrize('out_name', ['out_false', 'out_absent'])
def test_flag_false_or_absent_generates_nothing_and_references_no_adapter(out_name, request):
    out = request.getfixturevalue(out_name)
    assert not (out / 'lib' / 'audit-log-ops').exists()
    for path in _generated_files(out):
        text = path.read_text(errors='ignore')
        for marker in ADAPTER_MARKERS:
            assert marker not in text, f'{path.relative_to(out)} mentions {marker} with the flag off'


@pytest.mark.parametrize('schema, expected', [
    ({}, False),
    ({'x-generator': {}}, False),
    ({'x-generator': {'audit-log-storage': {}}}, False),
    ({'x-generator': {'audit-log-storage': {'enabled': False}}}, False),
    ({'x-generator': {'audit-log-storage': {'enabled': True}}}, True),
])
def test_audit_log_storage_enabled(schema, expected):
    assert audit_log_storage_enabled(schema) is expected
    validate_generator_config(schema)


@pytest.mark.parametrize('block', ['yes', {'enabled': 'true'}, {'enabled': True, 'bucket': 'b'}])
def test_validator_rejects_malformed_blocks(block):
    with pytest.raises(SchemaValidationError):
        validate_generator_config({'x-generator': {'audit-log-storage': block}})


def test_only_the_generated_factory_imports_the_adapters():
    """No tracked source outside the adapters themselves, their tests and the factory template reaches them."""
    allowed = {
        'lib/audit-log-integrity/storage-gcs.ts', 'lib/audit-log-integrity/storage-s3.ts',
        'lib/audit-log-integrity/storage-gcs.test.ts', 'lib/audit-log-integrity/storage-s3.test.ts',
        'code_generator/templates/audit_log_storage_factory.ts.jinja2',
    }
    pattern = re.compile(r"audit-log-integrity/storage-(gcs|s3)|from '\./storage-(gcs|s3)'")
    offenders = []
    for root in ('app', 'lib', 'components', 'scripts', 'code_generator/templates', 'test'):
        for path in (REPO_ROOT / root).rglob('*'):
            if not path.is_file() or path.suffix not in {'.ts', '.tsx', '.jinja2', '.mjs', '.js'} or 'node_modules' in path.parts:
                continue
            rel = path.relative_to(REPO_ROOT).as_posix()
            if rel not in allowed and pattern.search(path.read_text(errors='ignore')):
                offenders.append(rel)
    assert offenders == []


def test_sdks_are_loaded_by_literal_dynamic_import_without_webpack_ignore():
    gcs = (REPO_ROOT / 'lib/audit-log-integrity/storage-gcs.ts').read_text()
    s3 = (REPO_ROOT / 'lib/audit-log-integrity/storage-s3.ts').read_text()
    assert "await import('@google-cloud/storage')" in gcs
    assert "await import('@aws-sdk/client-s3')" in s3
    for text in (gcs, s3):
        assert not re.search(r'import\(\s*/\*\s*webpackIgnore', text)
        assert not re.search(r'^\s*import\s+[^;]*from\s+[\'"](@google-cloud/storage|@aws-sdk/client-s3)[\'"]', text, re.M)
