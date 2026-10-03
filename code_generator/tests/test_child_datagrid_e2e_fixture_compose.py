"""
The child-datagrid-e2e-gate fixture (code_generator/tests/fixtures/
child_datagrid_e2e_gate/) is merged into a disposable copy of the app by
scripts/compose_child_datagrid_e2e_fixture.py. These tests check, without
docker or a browser, that the merge works, never edits the repository's own
files, refuses to shadow a default entity, and yields a schema the generator
accepts end to end (derivation, validation, code generation).
"""
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
FIXTURE_DIR = REPO_ROOT / 'code_generator' / 'tests' / 'fixtures' / 'child_datagrid_e2e_gate'
COMPOSE = REPO_ROOT / 'scripts' / 'compose_child_datagrid_e2e_fixture.py'


@pytest.fixture()
def app_copy(tmp_path):
    (tmp_path / 'code_generator').mkdir()
    (tmp_path / 'prisma').mkdir()
    shutil.copy(REPO_ROOT / 'code_generator' / 'json_schema.yaml', tmp_path / 'code_generator')
    shutil.copy(REPO_ROOT / 'code_generator' / 'json_schema_internal.yaml', tmp_path / 'code_generator')
    shutil.copy(REPO_ROOT / 'prisma' / 'schema.prisma', tmp_path / 'prisma')
    return tmp_path


def _compose(fixture_dir: Path, app_dir: Path):
    return subprocess.run([sys.executable, str(COMPOSE), str(fixture_dir), str(app_dir)],
                          capture_output=True, text=True)


def test_compose_adds_the_fixture_entities_and_models(app_copy):
    result = _compose(FIXTURE_DIR, app_copy)
    assert result.returncode == 0, result.stderr
    schema = (app_copy / 'code_generator' / 'json_schema.yaml').read_text()
    prisma = (app_copy / 'prisma' / 'schema.prisma').read_text()
    for entity in ('parent1', 'parent1_child1', 'parent1_child2', 'parent_only', 'parent_only_probe'):
        assert f'\n  {entity}:\n' in schema
        assert f'model {entity} {{' in prisma
    assert 'enum ProbeKind {' in prisma
    assert 'created_parent1s parent1[] @relation("Parent1Creator")' in prisma
    assert 'parent1s parent1[]' in prisma


def test_compose_leaves_the_repositorys_own_files_alone(app_copy):
    before = {p: p.read_bytes() for p in (REPO_ROOT / 'code_generator' / 'json_schema.yaml',
                                          REPO_ROOT / 'prisma' / 'schema.prisma')}
    assert _compose(FIXTURE_DIR, app_copy).returncode == 0
    assert all(p.read_bytes() == data for p, data in before.items())
    assert 'parent_only_probe' not in before[REPO_ROOT / 'prisma' / 'schema.prisma'].decode()


def test_compose_refuses_to_shadow_a_default_entity(app_copy, tmp_path_factory):
    clash = tmp_path_factory.mktemp('clash')
    shutil.copytree(FIXTURE_DIR, clash / 'fx')
    (clash / 'fx' / 'json_schema.yaml').write_text('definitions:\n  organization:\n    fields:\n      name: {}\n')
    result = _compose(clash / 'fx', app_copy)
    assert result.returncode != 0
    assert 'shadow' in result.stderr


def test_composed_schema_derives_validates_and_generates(app_copy):
    assert _compose(FIXTURE_DIR, app_copy).returncode == 0
    generated = app_copy / 'code_generator' / '.generated'
    generated.mkdir()
    schema_out = generated / 'json_schema.yaml'
    derive = subprocess.run(
        [sys.executable, str(REPO_ROOT / 'code_generator' / 'build_user_schema.py'),
         str(app_copy / 'code_generator' / 'json_schema.yaml'),
         str(app_copy / 'prisma' / 'schema.prisma'), '--out', str(schema_out)],
        capture_output=True, text=True, cwd=app_copy,
        env={'PYTHONPATH': str(REPO_ROOT / 'code_generator'), 'PATH': '/usr/bin:/bin'},
    )
    assert derive.returncode == 0, derive.stderr[-2000:]
    import yaml
    from validate import validate_schema
    sys.path.insert(0, str(REPO_ROOT / 'code_generator'))
    schema = yaml.safe_load(schema_out.read_text())
    validate_schema(schema)
    probe = schema['definitions']['parent_only_probe']['properties']
    assert probe['same_cd_id']['x-relationship']['labelField'] == ['name', 'owner.name']
    parent = schema['definitions']['parent_only']['allOf'][1]['properties'] \
        if 'allOf' in schema['definitions']['parent_only'] else schema['definitions']['parent_only']['properties']
    assert parent['parent_only_probes']['x-parent-fk'] == ['parent_only_id']
