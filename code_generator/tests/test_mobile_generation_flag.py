"""
The Expo app under mobile/ is opt-in: x-generator.mobile.enabled (default false).

Runs the real build_user_schema.py -> generate.py pipeline on tests/fixtures/mobile_entity_gate (which sets the
flag to true) with the flag true, false and absent, and checks the validator and the true -> false cleanup.

Run:
    cd code_generator && python3 -m pytest tests/test_mobile_generation_flag.py -v
"""
import shutil
from pathlib import Path

import pytest
import yaml

import cleanup
from build_user_schema import build_user_schema
from generate import generate
from manifest import MANIFEST_FILENAME
from validate import SchemaValidationError, mobile_generation_enabled, validate_generator_config

FIXTURE = Path(__file__).resolve().parent / 'fixtures' / 'mobile_entity_gate'


def _build(tmp_path: Path, mobile) -> Path:
    """Generate the fixture into tmp_path; `mobile` is the x-generator.mobile value, or 'absent' to drop the block."""
    prisma_dir = tmp_path / 'prisma'
    prisma_dir.mkdir(parents=True)
    shutil.copy(FIXTURE / 'schema.prisma', prisma_dir / 'schema.prisma')
    intermediate = tmp_path / 'generated_json_schema.yaml'
    build_user_schema(FIXTURE / 'json_schema.yaml', FIXTURE / 'schema.prisma', intermediate)
    schema = yaml.safe_load(intermediate.read_text())
    if mobile == 'absent':
        schema.get('x-generator', {}).pop('mobile', None)
    else:
        schema.setdefault('x-generator', {})['mobile'] = mobile
    intermediate.write_text(yaml.safe_dump(schema))
    generate(str(intermediate), str(tmp_path))
    return tmp_path


@pytest.fixture(scope='module')
def out_true(tmp_path_factory):
    return _build(tmp_path_factory.mktemp('mobile_flag_true'), {'enabled': True})


@pytest.fixture(scope='module')
def out_false(tmp_path_factory):
    return _build(tmp_path_factory.mktemp('mobile_flag_false'), {'enabled': False})


@pytest.fixture(scope='module')
def out_absent(tmp_path_factory):
    return _build(tmp_path_factory.mktemp('mobile_flag_absent'), 'absent')


def test_flag_true_generates_the_expo_app(out_true):
    assert (out_true / 'mobile' / 'lib' / 'entity-registry.ts').exists()
    assert (out_true / 'mobile' / 'lib' / 'mobile_note' / 'mobile_client.ts').exists()


def _files(out: Path) -> set[str]:
    return {str(p.relative_to(out)) for p in out.rglob('*') if p.is_file() and 'node_modules' not in p.parts}


@pytest.mark.parametrize('out_name', ['out_false', 'out_absent'])
def test_flag_false_or_absent_generates_no_mobile_directory(out_name, request, out_true):
    out = request.getfixturevalue(out_name)
    assert not (out / 'mobile').exists()
    assert (out / 'lib' / 'mobile_note').is_dir()
    # Only mobile/ differs: every other generated file is the same in both modes.
    web_only = {f for f in _files(out_true) if not f.startswith('mobile/')}
    assert web_only <= _files(out)
    assert {f for f in _files(out) if f not in web_only and not f.startswith('.')} == set()


def test_cleanup_after_true_to_false_removes_generated_mobile_files(tmp_path, monkeypatch):
    out = _build(tmp_path, {'enabled': True})
    assert (out / 'mobile' / 'lib' / 'entity-registry.ts').exists()
    monkeypatch.setattr(cleanup, '_MANIFEST_FRESH_THRESHOLD_S', 0)
    assert cleanup._clean_from_manifest(out) is True
    assert not (out / 'mobile' / 'lib').exists()
    assert not (out / 'mobile' / 'app').exists()
    assert not (out / MANIFEST_FILENAME).exists()
    # Regenerating with the flag off now leaves no mobile app behind.
    prisma_dir = out / 'prisma'
    assert prisma_dir.exists()
    intermediate = out / 'generated_json_schema.yaml'
    schema = yaml.safe_load(intermediate.read_text())
    schema['x-generator']['mobile'] = {'enabled': False}
    intermediate.write_text(yaml.safe_dump(schema))
    generate(str(intermediate), str(out))
    assert not (out / 'mobile' / 'lib').exists()


@pytest.mark.parametrize('schema, expected', [
    ({}, False),
    ({'x-generator': {}}, False),
    ({'x-generator': {'search': {'default_scope': 'all'}}}, False),
    ({'x-generator': {'mobile': {}}}, False),
    ({'x-generator': {'mobile': {'enabled': False}}}, False),
    ({'x-generator': {'mobile': {'enabled': True}}}, True),
])
def test_mobile_generation_enabled(schema, expected):
    validate_generator_config(schema)
    assert mobile_generation_enabled(schema) is expected


@pytest.mark.parametrize('mobile, fragment', [
    ({'enabled': 'yes'}, 'must be a boolean'),
    ({'enabled': 1}, 'must be a boolean'),
    ({'enabled': None}, 'must be a boolean'),
    ({'enabled': True, 'platform': 'ios'}, 'unknown key'),
    ({'enable': True}, 'unknown key'),
    (True, 'must be a mapping'),
    ('on', 'must be a mapping'),
])
def test_invalid_mobile_block_is_rejected(mobile, fragment):
    with pytest.raises(SchemaValidationError, match=fragment):
        validate_generator_config({'x-generator': {'mobile': mobile}})


def test_generate_rejects_invalid_mobile_block(tmp_path):
    prisma_dir = tmp_path / 'prisma'
    prisma_dir.mkdir()
    shutil.copy(FIXTURE / 'schema.prisma', prisma_dir / 'schema.prisma')
    intermediate = tmp_path / 'generated_json_schema.yaml'
    build_user_schema(FIXTURE / 'json_schema.yaml', FIXTURE / 'schema.prisma', intermediate)
    schema = yaml.safe_load(intermediate.read_text())
    schema['x-generator']['mobile'] = {'enabled': 'true'}
    intermediate.write_text(yaml.safe_dump(schema))
    with pytest.raises((SchemaValidationError, SystemExit)):
        generate(str(intermediate), str(tmp_path))
    assert not (tmp_path / 'mobile').exists()
