"""
Shared list components no longer default `primaryField` to 'name' (Issue #837).

A parent-embedded bridge grid passes the child's own declared primary column
and passes nothing when the child declares none, so the grid never relies on
an implicit 'name' column.
"""
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / 'code_generator'))

from generate import _make_env, _render  # noqa: E402


def _bridge_grid(primary_field: str) -> str:
    return _render(_make_env(), 'bridge_grid.tsx.jinja2', {
        'child': 'work_item',
        'child_pascal': 'WorkItem',
        'bridge_fk': 'work_bridge_id',
        'display_fields': "{ field: 'title', headerName: tf('title') }",
        'primary_field': primary_field,
    })


def test_bridge_grid_passes_declared_primary_field():
    assert 'primaryField="title"' in _bridge_grid('title')


def test_bridge_grid_omits_primary_field_when_child_declares_none():
    assert 'primaryField' not in _bridge_grid('')


def test_shared_list_components_have_no_name_default():
    for name in ('DataGridClient', 'CardListClient'):
        src = (REPO_ROOT / 'components' / '_standard' / f'{name}.tsx').read_text()
        assert "primaryField = 'name'" not in src, name
