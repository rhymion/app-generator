"""
x-exclusive-parents: a parent's generated UI spec never selects a child grid
column that the parent's form hides.

The parent's embedded child grid drops the FK columns of the other listed
parents (build_context._exclusive_parent_fks). The UI spec must skip the same
columns, otherwise "creates with full data" waits for a cell that is not there.
Entities without the declaration render the same spec context as before.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from generators_test import spec_context  # noqa: E402
from generate_types import _extract_children  # noqa: E402
from test_x_exclusive_parents import _schema, models  # noqa: E402,F401

CONFIG = {
    'list': True, 'view': True, 'new': True, 'edit': True,
    'delete': True, 'api': False, 'test': True, 'fields': None,
}


def _ctx(schema: dict, parent: str) -> dict:
    children = _extract_children(schema['definitions'][parent], schema)
    return spec_context(parent, children, schema, parent, parent, CONFIG)


def _fk_columns(ctx: dict, key: str) -> list:
    (child,) = ctx['datagrid_children_data']
    return [f['field'] for f in child[key]]


def test_alpha_screen_skips_the_hidden_beta_column(models):
    ctx = _ctx(_schema(models), 'alpha')
    assert 'beta_id' not in _fk_columns(ctx, 'fk_full_fields')
    assert 'beta_id' not in _fk_columns(ctx, 'fk_create_fields')


def test_beta_screen_skips_the_hidden_alpha_column(models):
    ctx = _ctx(_schema(models), 'beta')
    assert 'alpha_id' not in _fk_columns(ctx, 'fk_full_fields')
    assert 'alpha_id' not in _fk_columns(ctx, 'fk_create_fields')


def test_the_non_owner_fk_is_still_selected(models):
    ctx = _ctx(_schema(models), 'alpha')
    assert 'placed_alpha_id' in _fk_columns(ctx, 'fk_full_fields')
    assert 'placed_alpha_id' in _fk_columns(ctx, 'fk_create_fields')


def test_without_the_key_the_other_column_is_selected(models):
    ctx = _ctx(_schema(models, None), 'alpha')
    assert 'beta_id' in _fk_columns(ctx, 'fk_full_fields')

