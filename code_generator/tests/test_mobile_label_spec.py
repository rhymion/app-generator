"""
The generated mobile lib/label-spec.ts: the label of a related record (a composite `labelField` is a list of
paths joined with a space, as on the Web) and the list panel's view of a form field (positional enum labels
become a record keyed by member, which is what lib/_list_query.ts reads).

Runs the real template through Node (types stripped); it has no React or react-native import.
The type side (a FieldSpec list is accepted where the panel wants ListFieldSpec, and an array labelField is a
FieldSpec) is checked by `npm run typecheck` of the generated mobile app, which
scripts/run_mobile_entity_playwright.sh runs in every mode.

Run:
    cd code_generator && python3 -m pytest tests/test_mobile_label_spec.py -v
"""
import json
import shutil
import subprocess
from pathlib import Path

HERE = Path(__file__).resolve().parent
TEMPLATE = HERE.parent / 'templates' / 'mobile' / 'lib' / 'label-spec.ts.jinja2'

SCRIPT = """
const mod = await import(process.argv[2]);
const cases = JSON.parse(process.argv[3]);
const out = cases.map((c) => (c.fn === 'relationLabel' ? mod.relationLabel(c.row, c.labelField) : mod.toListFieldSpec(c.spec)));
console.log(JSON.stringify(out));
"""


def _run(tmp_path: Path, cases: list[dict]) -> list:
    ts = tmp_path / 'label-spec.ts'
    shutil.copy(TEMPLATE, ts)  # the template has no Jinja syntax, so it is the generated file byte for byte
    runner = tmp_path / 'run.mjs'
    runner.write_text(SCRIPT)
    result = subprocess.run(
        ['node', str(runner), ts.as_uri(), json.dumps(cases)], capture_output=True, text=True, check=False,
    )
    assert result.returncode == 0, result.stderr
    return json.loads(result.stdout.strip().splitlines()[-1])


def _label(row: dict, label_field) -> dict:
    return {'fn': 'relationLabel', 'row': row, 'labelField': label_field}


def test_a_single_column_label_is_that_column(tmp_path):
    (label,) = _run(tmp_path, [_label({'id': 'r1', 'name': 'Acme'}, 'name')])
    assert label == 'Acme'


def test_a_composite_label_joins_its_paths_with_a_space_and_follows_dotted_paths(tmp_path):
    row = {'id': 'r1', 'entity_name': 'purchase_order', 'approver_role': {'name': 'Manager'}}
    (label,) = _run(tmp_path, [_label(row, ['entity_name', 'approver_role.name'])])
    assert label == 'purchase_order Manager'


def test_empty_segments_are_left_out_and_an_all_empty_label_falls_back_to_the_id(tmp_path):
    row = {'id': 'r1', 'sku': 'A-1', 'lot_number': None, 'note': '', 'approver_role': None}
    partial, empty, missing_path = _run(tmp_path, [
        _label(row, ['sku', 'lot_number', 'note']),
        _label(row, ['lot_number', 'note']),
        _label(row, 'approver_role.name'),
    ])
    assert partial == 'A-1'
    assert empty == 'r1'
    assert missing_path == 'r1'


def test_positional_enum_labels_become_a_record_keyed_by_member(tmp_path):
    spec = {
        'key': 'status', 'label': 'Status', 'kind': 'enum', 'required': False, 'readonly': False,
        'options': ['open', 'closed', 'on_hold'], 'optionLabels': ['Open', '', 'On hold'], 'numericEnum': False,
    }
    (list_spec,) = _run(tmp_path, [{'fn': 'toListFieldSpec', 'spec': spec}])
    assert list_spec == {
        'key': 'status', 'label': 'Status', 'kind': 'enum', 'options': ['open', 'closed', 'on_hold'],
        'optionLabels': {'open': 'Open', 'on_hold': 'On hold'},
    }


def test_a_field_without_options_has_an_empty_label_record(tmp_path):
    spec = {
        'key': 'name', 'label': 'Name', 'kind': 'text', 'required': True, 'readonly': False,
        'options': [], 'optionLabels': [], 'numericEnum': False,
    }
    (list_spec,) = _run(tmp_path, [{'fn': 'toListFieldSpec', 'spec': spec}])
    assert list_spec['optionLabels'] == {}
    assert list_spec['options'] == []
