"""
The list-child-e2e-gate fixture (code_generator/tests/fixtures/
list_child_e2e_gate/) is merged into a disposable copy of the app by
scripts/compose_child_datagrid_e2e_fixture.py (the composer takes any fixture
directory). These tests check, without docker or a browser, that the merge
works, never edits the repository's own files, and yields a schema the generator
accepts end to end, with the list-child include carrying the second FK to the
parent's own model that the gate's specs read.
"""
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
FIXTURE_DIR = REPO_ROOT / 'code_generator' / 'tests' / 'fixtures' / 'list_child_e2e_gate'
COMPOSE = REPO_ROOT / 'scripts' / 'compose_child_datagrid_e2e_fixture.py'
ENTITIES = ('lc_plain_parent', 'lc_plain_child', 'lc_edit_parent', 'lc_edit_child',
            'lc_edit_sibling', 'lc_m2m_parent', 'lc_m2m_child', 'lc_node')


@pytest.fixture()
def app_copy(tmp_path):
    (tmp_path / 'code_generator').mkdir()
    (tmp_path / 'prisma').mkdir()
    shutil.copy(REPO_ROOT / 'code_generator' / 'json_schema.yaml', tmp_path / 'code_generator')
    shutil.copy(REPO_ROOT / 'code_generator' / 'json_schema_internal.yaml', tmp_path / 'code_generator')
    shutil.copy(REPO_ROOT / 'prisma' / 'schema.prisma', tmp_path / 'prisma')
    return tmp_path


def _compose(app_dir: Path):
    return subprocess.run([sys.executable, str(COMPOSE), str(FIXTURE_DIR), str(app_dir)],
                          capture_output=True, text=True)


def test_compose_adds_the_fixture_entities_and_models(app_copy):
    result = _compose(app_copy)
    assert result.returncode == 0, result.stderr
    schema = (app_copy / 'code_generator' / 'json_schema.yaml').read_text()
    prisma = (app_copy / 'prisma' / 'schema.prisma').read_text()
    for entity in ENTITIES:
        assert f'\n  {entity}:\n' in schema
        assert f'model {entity} {{' in prisma
    assert 'created_lc_nodes lc_node[] @relation("LcNodeCreator")' in prisma


def test_compose_leaves_the_repositorys_own_files_alone(app_copy):
    before = {p: p.read_bytes() for p in (REPO_ROOT / 'code_generator' / 'json_schema.yaml',
                                          REPO_ROOT / 'prisma' / 'schema.prisma')}
    assert _compose(app_copy).returncode == 0
    assert all(p.read_bytes() == data for p, data in before.items())
    assert 'lc_node' not in before[REPO_ROOT / 'prisma' / 'schema.prisma'].decode()


def test_composed_schema_derives_validates_and_builds_the_include(app_copy):
    assert _compose(app_copy).returncode == 0
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
    sys.path.insert(0, str(REPO_ROOT / 'code_generator'))
    from build_context import build_context
    from generate_types import extract_entities
    from validate import validate_schema

    schema = yaml.safe_load(schema_out.read_text())
    validate_schema(schema)
    entity = next(e for e in extract_entities(schema) if e['model'] == 'lc_edit_parent')
    detail = build_context(entity, schema)['include_props_detail']
    assert 'kids: { include: { rel_par: true } }' in detail
    assert 'sibs: { include: { related: true } }' in detail


@pytest.mark.parametrize('parent,child', [('lc_edit_parent', 'lc_edit_child'), ('lc_node', 'lc_node')])
def test_nullable_link_list_child_is_an_option_target(app_copy, parent, child):
    """A list child whose own link to the parent is nullable is picked from the
    parent's form, so `FormUpsertProps` must declare its option props (issue
    #805). The schema is a derived one: views are `allOf` over a raw entity."""
    assert _compose(app_copy).returncode == 0
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
    sys.path.insert(0, str(REPO_ROOT / 'code_generator'))
    from context import build_entity_context
    from generate_types import extract_entities

    schema = yaml.safe_load(schema_out.read_text())
    entity = next(e for e in extract_entities(schema) if e['model'] == parent)
    assert child in build_entity_context(entity, schema).all_option_targets
