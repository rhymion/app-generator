"""
Generated test helper: hand-written dependency values (helper_custom.ts).

helper.ts passes the values of every dependency row it creates, and the
`where` of every find-or-create lookup, through the entity's write-once
`helper_custom.ts` `dependencyValues(key, defaults)`. The runtime that checks
the result is `cypress/support/dependency-values.ts`.
"""
import re
import shutil
import subprocess
import sys
from pathlib import Path

import pytest
from jinja2 import Environment, FileSystemLoader

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / 'code_generator'))

import generate  # noqa: E402
from generators_test import helper_context  # noqa: E402
from helpers.naming import to_camel_case, to_pascal_case  # noqa: E402
from manifest import ManifestRecorder  # noqa: E402
from test_x_exclusive_parents import PRISMA, _schema  # noqa: E402,F401
from test_x_exclusive_parents import models  # noqa: E402,F401

CONFIG = {
    'list': True, 'view': True, 'new': True, 'edit': True,
    'delete': True, 'api': False, 'test': True, 'fields': None,
}
TEMPLATES = REPO_ROOT / 'code_generator' / 'templates'


def _env() -> Environment:
    env = Environment(
        loader=FileSystemLoader(str(TEMPLATES)),
        trim_blocks=True, lstrip_blocks=True, keep_trailing_newline=True,
    )
    env.filters['pascal_case'] = to_pascal_case
    env.filters['camel_case'] = to_camel_case
    return env


def _helper(schema: dict, entity: str = 'placement') -> str:
    ctx = helper_context(entity, [], schema, entity, entity, CONFIG)
    return _env().get_template('test_helper.ts.jinja2').render(**ctx)


def _stub(parent: str = 'placement') -> str:
    return _env().get_template('helper_custom_stub.ts.jinja2').render(parent=parent)


# --- stub ------------------------------------------------------------------

def test_stub_has_no_auto_generated_marker():
    # The orphan sweep removes files that carry the marker.
    assert 'AUTO-GENERATED' not in _stub()


def test_stub_returns_defaults_and_imports_the_key_type_from_the_helper():
    stub = _stub()
    assert "import type { DependencyKey } from './helper';" in stub
    assert 'export function dependencyValues(' in stub
    assert 'return defaults;' in stub


def test_stub_names_the_consumer_location():
    assert 'prj/cypress/support/placement/helper_custom.ts' in _stub()


def test_stub_is_written_once_and_a_hand_edit_survives(tmp_path):
    saved = generate._manifest
    generate._manifest = ManifestRecorder()
    try:
        path = tmp_path / 'cypress' / 'support' / 'placement' / 'helper_custom.ts'
        generate._write_stub(path, _stub())
        assert path.read_text() == _stub()
        edited = _stub() + "\n// hand-written\n"
        path.write_text(edited)
        generate._write_stub(path, _stub())
        assert path.read_text() == edited
    finally:
        generate._manifest = saved


def test_stub_is_wired_into_generate_code_next_to_helper_ts():
    src = (REPO_ROOT / 'code_generator' / 'generate.py').read_text()
    assert re.search(r"_write_stub\(cypress_support / parent / 'helper_custom\.ts'", src)


# --- generated helper ------------------------------------------------------

def test_helper_imports_the_hook_and_the_runtime(models):
    text = _helper(_schema(models))
    assert "from '../dependency-values';" in text
    assert "import { dependencyValues } from './helper_custom';" in text


def test_helper_exports_the_key_type_listing_every_dependency(models):
    text = _helper(_schema(models))
    m = re.search(r'export type DependencyKey = (.+);', text)
    assert m, text
    assert "'alpha.alpha'" in m.group(1) and "'beta.beta'" in m.group(1), m.group(1)


def test_every_dependency_create_goes_through_the_hook(models):
    text = _helper(_schema(models))
    deps_fn = text[text.index('export async function populatePlacementDependencies'):]
    deps_fn = deps_fn[:deps_fn.index('\nexport async function populatePlacementData')]
    for model in ('alpha', 'beta'):
        for m in re.finditer(rf'prisma\.{model}\.create\(\{{\s+data: (.*)', deps_fn):
            assert m.group(1).startswith('_dep('), m.group(0)


def test_per_row_dependency_create_uses_the_same_key(models):
    # placed_alpha is the required FK, so populatePlacementData creates it per row.
    text = _helper(_schema(models))
    keys = set(re.findall(r"_dep\('([^']+)'", text))
    assert 'alpha.placedAlpha' in keys or 'alpha.alpha' in keys, keys


def test_lookup_where_goes_through_the_hook(models):
    text = _helper(_schema(models))
    # every find-or-create lookup is wrapped, none is left as a bare where
    for m in re.finditer(r'findFirst\(\{\n\s+where: (.*)', text):
        assert m.group(1).startswith('_depWhere('), m.group(0)


def test_helper_carries_the_column_sets_for_validation(models):
    text = _helper(_schema(models))
    assert re.search(r'alpha: \{ scalars: \["name"\], protectedColumns: \[.*"id".*\] \}', text), text


def test_no_dependency_helper_exports_an_empty_key_type(models):
    text = _helper(_schema(models), 'alpha')
    assert 'export type DependencyKey = never;' in text


# --- runtime ---------------------------------------------------------------

NODE = shutil.which('node')

_DRIVER = r"""
const { dependencyData, dependencyLookup } = require(process.argv[2]);
const cols = { step: { scalars: ['name', 'step_type'], protectedColumns: ['id', 'creator_id', 'parent_id'] } };
const run = (fn, hook, d) => {
  try { return JSON.stringify(fn(hook, cols, 'step.step', 'step', d)); }
  catch (e) { return 'ERR:' + e.message; }
};
const d = { name: 'Test Step A', creator_id: 'u1', parent_id: 'p1' };
const out = {
  same: run(dependencyData, (k, x) => x, d),
  addPlain: run(dependencyData, (k, x) => ({ ...x, step_type: 'composite' }), d),
  changePlain: run(dependencyData, (k, x) => ({ ...x, name: 'X' }), d),
  unknown: run(dependencyData, (k, x) => ({ ...x, nope: 1 }), d),
  changeFk: run(dependencyData, (k, x) => ({ ...x, parent_id: 'p2' }), d),
  dropFk: run(dependencyData, (k, x) => ({ name: x.name, creator_id: x.creator_id }), d),
  addFk: run(dependencyData, (k, x) => ({ ...x, id: 'z' }), d),
  notObject: run(dependencyData, () => null, d),
  lookupAdds: run(dependencyLookup, (k, x) => ({ ...x, step_type: 'composite' }), { name: 'Test Step A' }),
  lookupUnknown: run(dependencyLookup, (k, x) => ({ ...x, nope: 1 }), { name: 'Test Step A' }),
};
console.log(JSON.stringify(out));
"""


@pytest.fixture(scope='module')
def runtime_results(tmp_path_factory):
    if NODE is None:
        pytest.skip('node is not available')
    tsc = REPO_ROOT / 'node_modules' / '.bin' / 'tsc'
    if not tsc.exists():
        pytest.skip('typescript is not installed')
    out = tmp_path_factory.mktemp('depvals')
    subprocess.run(
        [str(tsc), '--outDir', str(out), '--module', 'commonjs', '--target', 'es2020',
         '--skipLibCheck', str(REPO_ROOT / 'cypress' / 'support' / 'dependency-values.ts')],
        check=True, capture_output=True,
    )
    driver = out / 'driver.js'
    driver.write_text(_DRIVER)
    res = subprocess.run(
        [NODE, str(driver), str(out / 'dependency-values.js')],
        check=True, capture_output=True, text=True,
    )
    import json
    return json.loads(res.stdout)


def test_runtime_passes_defaults_unchanged(runtime_results):
    assert not runtime_results['same'].startswith('ERR')


def test_runtime_allows_adding_and_changing_plain_columns(runtime_results):
    assert '"step_type":"composite"' in runtime_results['addPlain']
    assert '"name":"X"' in runtime_results['changePlain']


@pytest.mark.parametrize('case,needle', [
    ('unknown', 'returned "nope"'),
    ('changeFk', 'changed "parent_id"'),
    ('dropFk', 'dropped "parent_id"'),
    ('addFk', 'changed "id"'),
    ('notObject', 'must return an object'),
    ('lookupUnknown', 'returned "nope"'),
])
def test_runtime_fails_closed_naming_key_and_column(runtime_results, case, needle):
    msg = runtime_results[case]
    assert msg.startswith('ERR:'), msg
    assert needle in msg and 'step.step' in msg, msg


def test_runtime_lookup_receives_the_hook_value(runtime_results):
    assert '"step_type":"composite"' in runtime_results['lookupAdds']
