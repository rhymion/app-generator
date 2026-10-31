"""The security matrix: the data, the checker, and that new axes need no checker change."""
import copy
import json
import pathlib
import re

import pytest
import yaml

import security_matrix as sm

REPO_ROOT = pathlib.Path(__file__).resolve().parents[2]
TEMPLATES = REPO_ROOT / 'code_generator' / 'templates'
ALL_FLAGS = dict.fromkeys(
    ['can_api', 'can_list', 'can_view', 'can_new', 'can_edit', 'can_delete', 'can_export',
     'can_invalidate', 'import_eligible', 'should_filter_by_org'], True)
FK_FLAGS = ['fk_many_to_one_required', 'fk_many_to_one_optional', 'fk_one_to_one_required',
            'fk_one_to_one_optional', 'fk_inline_required', 'fk_inline_optional']
# An entity that holds no reference to an organization-scoped entity: the fk_shape axis adds nothing.
ALL_FLAGS.update(dict.fromkeys(FK_FLAGS, False))


@pytest.fixture
def matrix():
    return sm.load_matrix()


def _ids(cells, axes):
    return {tuple(c[a] for a in axes) for c in cells}


def test_cross_org_cells_are_dropped_without_an_organization_column(matrix):
    with_org = _ids(sm.applicable_cells(matrix, ALL_FLAGS), ['operation', 'case'])
    without = _ids(sm.applicable_cells(matrix, {**ALL_FLAGS, 'should_filter_by_org': False}), ['operation', 'case'])
    assert ('update', 'cross_org') in with_org
    assert not any(case == 'cross_org' for _, case in without)
    assert ('update', 'permission_denied') in without


def test_operations_follow_the_entity_flags(matrix):
    flags = {**ALL_FLAGS, 'can_delete': False, 'can_invalidate': False}
    ops = {c['operation'] for c in sm.applicable_cells(matrix, flags)}
    assert {'delete', 'bulk_delete', 'action_delete', 'invalidate', 'action_invalidate'}.isdisjoint(ops)
    assert {'update', 'action_update'} <= ops


def test_unknown_flag_fails_closed(matrix):
    flags = dict(ALL_FLAGS)
    del flags['can_export']
    with pytest.raises(KeyError, match='can_export'):
        sm.applicable_cells(matrix, flags)


def _write_manifest(tmp_path, matrix, flags=None):
    path = tmp_path / 'manifest.json'
    path.write_text(json.dumps(sm.build_manifest(matrix, {'widget': flags or ALL_FLAGS})))
    return path


def _spec_with_all_cells(tmp_path, matrix, skip=()):
    lines = []
    for c in sm.applicable_cells(matrix, ALL_FLAGS):
        if (c['operation'], c['case']) not in skip:
            lines.append(f"// security-cell: entity=widget operation={c['operation']} case={c['case']} fk_shape={c['fk_shape']}")
    spec = tmp_path / 'tests' / 'widget.cy.ts'
    spec.parent.mkdir(exist_ok=True)
    spec.write_text('\n'.join(lines))
    return spec.parent


def test_complete_markers_pass(tmp_path, matrix):
    tests = _spec_with_all_cells(tmp_path, matrix)
    assert sm.run_check(_write_manifest(tmp_path, matrix), [tests], tmp_path / 'none.yaml') == 0


def test_a_cell_without_a_test_fails_and_is_named(tmp_path, matrix, capsys):
    tests = _spec_with_all_cells(tmp_path, matrix, skip={('bulk_delete', 'cross_org')})
    assert sm.run_check(_write_manifest(tmp_path, matrix), [tests], tmp_path / 'none.yaml') == 1
    err = capsys.readouterr().err
    assert 'widget case=cross_org fk_shape=none operation=bulk_delete' in err


def test_allowlist_exempts_with_a_reason_and_rejects_stale_entries(tmp_path, matrix, capsys):
    tests = _spec_with_all_cells(tmp_path, matrix, skip={('bulk_delete', 'cross_org')})
    manifest = _write_manifest(tmp_path, matrix)
    allow = tmp_path / 'allow.yaml'
    allow.write_text(yaml.safe_dump({'exempt': [
        {'entity': 'widget', 'operation': 'bulk_delete', 'case': 'cross_org', 'reason': 'covered elsewhere'}]}))
    assert sm.run_check(manifest, [tests], allow) == 0
    allow.write_text(yaml.safe_dump({'exempt': [
        {'entity': 'widget', 'operation': 'bulk_delete', 'case': 'cross_org', 'reason': 'x'},
        {'entity': 'gone', 'operation': 'delete', 'case': 'cross_org', 'reason': 'x'}]}))
    assert sm.run_check(manifest, [tests], allow) == 1
    assert 'matches no cell' in capsys.readouterr().err


def test_allowlist_entry_needs_a_reason_and_goes_redundant_once_tested(tmp_path, matrix, capsys):
    tests = _spec_with_all_cells(tmp_path, matrix)
    manifest = _write_manifest(tmp_path, matrix)
    allow = tmp_path / 'allow.yaml'
    allow.write_text(yaml.safe_dump({'exempt': [{'operation': 'delete', 'case': 'cross_org', 'reason': ' '}]}))
    with pytest.raises(ValueError, match='no reason'):
        sm.run_check(manifest, [tests], allow)
    allow.write_text(yaml.safe_dump({'exempt': [{'operation': 'delete', 'case': 'cross_org', 'reason': 'was missing'}]}))
    assert sm.run_check(manifest, [tests], allow) == 1
    assert 'redundant' in capsys.readouterr().err


def test_marker_for_a_cell_that_does_not_exist_fails(tmp_path, matrix, capsys):
    tests = _spec_with_all_cells(tmp_path, matrix)
    (tests / 'extra.cy.ts').write_text('// security-cell: entity=widget operation=nonsense case=cross_org\n')
    assert sm.run_check(_write_manifest(tmp_path, matrix), [tests], tmp_path / 'none.yaml') == 1
    assert 'does not exist' in capsys.readouterr().err


def test_a_new_axis_is_a_data_change_only(tmp_path, matrix, capsys):
    """Add an axis (and a combination rule) to the matrix data; the checker code is untouched."""
    wider = copy.deepcopy(matrix)
    wider['axes']['input'] = {
        'default': 'valid',
        'values': {
            'valid': {},
            # Only a write operation takes a body that can be invalid.
            'invalid': {'combine': {'operation': ['create', 'update', 'bulk_update']}},
        },
    }
    matrix_file = tmp_path / 'matrix.yaml'
    matrix_file.write_text(yaml.safe_dump(wider))
    tests = _spec_with_all_cells(tmp_path, matrix)  # markers written before the axis existed
    manifest = tmp_path / 'manifest.json'
    manifest.write_text(json.dumps(sm.build_manifest(wider, {'widget': ALL_FLAGS})))
    # The old markers still claim their cells through the axis default; only the new
    # invalid-input cells, which no test claims yet, are reported.
    assert sm.run_check(manifest, [tests], tmp_path / 'none.yaml', matrix_file) == 1
    err = capsys.readouterr().err
    missing = re.findall(r'widget (.*)', err)
    assert missing and all('input=invalid' in line for line in missing)
    assert {t for l in missing for t in l.split() if t.startswith('operation=')} <= {
        'operation=create', 'operation=update', 'operation=bulk_update'}


def test_matrix_data_is_well_formed(matrix):
    assert set(matrix['axes']) == {'operation', 'case', 'fk_shape'}
    for op, spec in matrix['axes']['operation']['values'].items():
        assert spec['entry_point'] in ('route', 'action'), op


def test_every_per_entity_route_template_is_in_the_matrix(matrix):
    """A route kind added later cannot skip the matrix: it is an operation or listed with a reason."""
    generate = (REPO_ROOT / 'code_generator' / 'generate.py').read_text(encoding='utf-8')
    api_dir_block = generate.split('# --- API routes ---', 1)[1].split('# --- column_def.tsx ---', 1)[0]
    rendered = set(re.findall(r"_render\(env, '([a-z_]+route[a-z_.]*\.jinja2)'", api_dir_block))
    assert rendered, 'no per-entity route renders found in generate.py'
    modelled = {s['template'] for s in matrix['axes']['operation']['values'].values() if 'template' in s}
    unmodelled = set(matrix.get('unmodelled_templates') or {})
    assert rendered <= modelled | unmodelled, sorted(rendered - modelled - unmodelled)
    anywhere = set(re.findall(r"_render\(\s*env,\s*'([a-z_.]+\.jinja2)'", generate))
    assert (modelled | unmodelled) <= anywhere, sorted((modelled | unmodelled) - anywhere)
    assert all(str(r).strip() for r in matrix['unmodelled_templates'].values())


def test_markers_in_the_api_spec_template_name_real_operations(matrix):
    text = (TEMPLATES / 'test_api_spec.cy.ts.jinja2').read_text(encoding='utf-8')
    markers = re.findall(r'security-cell: entity=\{\{ parent \}\} operation=(\w+) case=(\w+)', text)
    assert markers
    ops, cases = matrix['axes']['operation']['values'], matrix['axes']['case']['values']
    for op, case in markers:
        assert op in ops and case in cases, (op, case)


def test_repository_allowlist_entries_all_have_reasons(matrix):
    entries = sm.load_allowlist(sm.ALLOWLIST_PATH, matrix)
    assert entries and all(e['reason'].strip() for e in entries)


def _fk_cells(matrix, **flags):
    return sm.applicable_cells(matrix, {**ALL_FLAGS, **flags})


def test_an_entity_without_references_has_no_fk_cells(matrix):
    cells = _fk_cells(matrix)
    assert {c['fk_shape'] for c in cells} == {'none'}
    assert not any(c['case'].startswith('fk_') for c in cells)


def test_each_reference_shape_adds_cells_only_for_its_own_flag(matrix):
    cells = _fk_cells(matrix, fk_one_to_one_required=True)
    assert {c['fk_shape'] for c in cells} == {'none', 'one_to_one_required'}
    fk_cells = [c for c in cells if c['fk_shape'] != 'none']
    assert {c['case'] for c in fk_cells} == {
        'fk_to_unreachable', 'fk_away_unreachable', 'fk_delete_unreachable'}


def test_clearing_a_reference_only_applies_to_an_optional_shape(matrix):
    required = _fk_cells(matrix, fk_many_to_one_required=True, fk_inline_required=True)
    assert not any(c['case'] == 'fk_null_unreachable' for c in required)
    optional = _fk_cells(matrix, fk_many_to_one_optional=True)
    assert {(c['operation'], c['fk_shape']) for c in optional if c['case'] == 'fk_null_unreachable'} == {
        ('update', 'many_to_one_optional'), ('bulk_update', 'many_to_one_optional'),
        ('action_update', 'many_to_one_optional')}


def test_reference_cells_follow_the_operation_flags(matrix):
    cells = _fk_cells(matrix, fk_many_to_one_required=True, can_delete=False, can_new=False, import_eligible=False)
    ops = {c['operation'] for c in cells if c['case'].startswith('fk_')}
    assert ops == {'update', 'bulk_update', 'action_update'}


def test_reference_cells_need_an_organization_column(matrix):
    cells = _fk_cells(matrix, fk_many_to_one_required=True, should_filter_by_org=False)
    assert not any(c['case'].startswith('fk_') for c in cells)


def test_manifest_carries_the_denied_status_the_helpers_assert(matrix):
    manifest = sm.build_manifest(matrix, {'widget': ALL_FLAGS})
    assert manifest['denied_status'] == {'case': {'permission_denied': 403, 'cross_org': 404}}


def test_denied_status_must_be_an_explicit_denial_status(tmp_path, matrix):
    bad = copy.deepcopy(matrix)
    bad['axes']['case']['values']['permission_denied']['denied_status'] = 400
    path = tmp_path / 'matrix.yaml'
    path.write_text(yaml.safe_dump(bad))
    with pytest.raises(ValueError, match='denied_status'):
        sm.load_matrix(path)


def test_a_file_calling_expect_denied_for_must_carry_a_marker(tmp_path, matrix, capsys):
    tests = _spec_with_all_cells(tmp_path, matrix)
    (tests / 'hand_written.cy.ts').write_text("expectDeniedFor({ status: 403 });\n")
    assert sm.run_check(_write_manifest(tmp_path, matrix), [tests], tmp_path / 'none.yaml') == 1
    assert 'calls expectDeniedFor but carries no security-cell marker' in capsys.readouterr().err
    (tests / 'hand_written.cy.ts').write_text(
        "// security-cell: entity=widget operation=update case=permission_denied\nexpectDeniedFor({ status: 403 });\n")
    assert sm.run_check(_write_manifest(tmp_path, matrix), [tests], tmp_path / 'none.yaml') == 0
