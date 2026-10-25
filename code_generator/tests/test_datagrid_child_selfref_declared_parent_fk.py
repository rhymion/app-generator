"""
Regression tests for issue #1068: a DataGrid child that is the same model as
its parent (self-referencing) takes its structural parent FK from the recorded
`x-parent-fk`, not from "every many-to-one FK that targets the model itself".
"""
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / 'code_generator'))

from build_context import _get_child_parent_id_props  # noqa: E402

SELF_RELS = [
    {'prop_name': 'parent_id', 'target': 'node'},
    {'prop_name': 'merged_into_id', 'target': 'node'},
    {'prop_name': 'owner_id', 'target': 'user'},
]


def _props(child_entry):
    return _get_child_parent_id_props('node', 'node', SELF_RELS, {}, child_entry)


def test_declared_parent_fk_wins_over_every_self_fk():
    entry = {'parent_fk': ['parent_id'], 'output_type': 'datagrid'}
    assert _props(entry) == {'parent_id'}


def test_declared_parent_fk_may_name_the_second_self_fk():
    entry = {'parent_fk': ['merged_into_id']}
    assert _props(entry) == {'merged_into_id'}


def test_no_recorded_parent_fk_falls_back_to_all_self_fks():
    assert _props({'output_type': 'datagrid'}) == {'parent_id', 'merged_into_id'}
    assert _props(None) == {'parent_id', 'merged_into_id'}


def test_list_children_keep_the_all_self_fks_fallback():
    entry = {'parent_fk': ['parent_id'], 'output_type': 'list'}
    assert _props(entry) == {'parent_id', 'merged_into_id'}
