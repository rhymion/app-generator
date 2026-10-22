"""
Regression tests for issue #802: one child must not remove the form props
another child needs.

`form_upsert_context` drops a relation target's `initial{Target}s` /
`search{Target}Options` props when the only things that use the target are
read-only (an independent child shown as a read-only grid, a read-only
parent FK, or an FK left out of `x-display.form`). The drop test did not
look at the editable inline DataGrid children, so a sibling inline child
whose own FK points at the same target kept referencing props the form no
longer declared, and the generated app failed to compile.

Behavior covered here: the editable child's autocomplete config and the
form's props signature always agree, whatever its siblings are.
"""
import copy
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / 'code_generator'))

from build_context import build_context  # noqa: E402
from generators import form_upsert_context  # noqa: E402

WRITABLE = {'list': True, 'view': True, 'new': True, 'edit': True,
            'delete': True, 'api': False, 'test': False}
READONLY = {'list': True, 'view': True, 'new': False, 'edit': False,
            'delete': False, 'api': False, 'test': False}
NO_PAGES = {'list': False, 'view': False, 'new': False, 'edit': False,
            'delete': False, 'api': False, 'test': False}


def _fk(target):
    return {'type': 'string',
            'x-relationship': {'type': 'many-to-one', 'target': target, 'labelField': 'name'}}


def _schema(kid_a_generate=None, kid_b_generate=None, parent_extra=None):
    name = {'id': {'type': 'string'}, 'name': {'type': 'string'}}

    def kid(generate):
        d = {'type': 'object', 'required': ['id', 'par_id', 'target_t_id'],
             'properties': {**name, 'par_id': _fk('par'), 'target_t_id': _fk('target_t')}}
        if generate is not None:
            d['x-generate'] = dict(generate)
        return d

    par = {'type': 'object', 'required': ['id', 'name'], 'properties': dict(name)}
    par.update(parent_extra or {})
    return {'definitions': {
        'target_t': {'type': 'object', 'required': ['id', 'name'], 'properties': dict(name)},
        'par': par,
        'kid_a': kid(kid_a_generate),
        'kid_b': kid(kid_b_generate),
    }}


def _form(schema, kids):
    entity = {
        'parent': 'par', 'model': 'par', 'definition_key': 'par',
        'children': [{'name': k, 'property_name': f'{k}s', 'output_type': None,
                      'file_type': None, 'relationship': None} for k in kids],
        'generate_config': {'list': True, 'view': True, 'new': True, 'edit': True,
                            'delete': True, 'api': False, 'test': False, 'fields': None},
    }
    return form_upsert_context(build_context(entity, schema), schema)


def _assert_consistent(form):
    params = form['form_upsert_params']
    used = form['child_entity_rel_opt']
    assert 'initialTargetTs' in used and 'searchTargetTOptions' in used, used
    assert 'initialTargetTs' in params and 'searchTargetTOptions' in params, (
        f'the editable child uses the target props but the form does not declare them.\n'
        f'params: {params}')


def test_independent_sibling_does_not_remove_the_inline_childs_props():
    """kid_a is independent (own writable pages: shown read-only in the
    parent); kid_b is an inline editable grid. Both point at target_t."""
    form = _form(_schema(kid_a_generate=WRITABLE), ['kid_a', 'kid_b'])
    assert 'useKidBsColumns(true' in form['child_grid_setup']
    _assert_consistent(form)


def test_inline_child_alone_declares_its_props():
    _assert_consistent(_form(_schema(), ['kid_b']))


def test_readonly_parent_fk_does_not_remove_the_inline_childs_props():
    parent_extra = {'x-readonly-fields': ['target_t_id']}
    schema = _schema(parent_extra=parent_extra)
    schema['definitions']['par']['properties']['target_t_id'] = _fk('target_t')
    schema['definitions']['par']['required'] = ['id', 'name', 'target_t_id']
    _assert_consistent(_form(schema, ['kid_b']))


def test_undisplayed_parent_fk_does_not_remove_the_inline_childs_props():
    schema = _schema(parent_extra={'x-display': {'form': ['name']}})
    schema['definitions']['par']['properties']['target_t_id'] = _fk('target_t')
    schema['definitions']['par']['required'] = ['id', 'name', 'target_t_id']
    _assert_consistent(_form(schema, ['kid_b']))


def test_target_used_only_by_a_readonly_independent_child_stays_dropped():
    """The drop itself is still right when nothing editable needs the target."""
    form = _form(_schema(kid_a_generate=WRITABLE), ['kid_a'])
    assert 'initialTargetTs' not in form['form_upsert_params']


# --- read-only children are editable from the parent (behavior 3) -----------

@pytest.mark.parametrize('generate,label', [
    (None, 'no x-generate'),
    (READONLY, 'own list/view pages, new/edit/delete false'),
    (NO_PAGES, 'no pages at all'),
])
def test_readonly_child_is_written_from_the_parent(generate, label):
    """A child that cannot write itself is added/edited/deleted from the
    parent: the grid is editable and the parent's create/update body carries
    its rows, whether or not it has pages of its own."""
    schema = _schema(kid_a_generate=generate)
    entity = {
        'parent': 'par', 'model': 'par', 'definition_key': 'par',
        'children': [{'name': 'kid_a', 'property_name': 'kid_as', 'output_type': None,
                      'file_type': None, 'relationship': None}],
        'generate_config': {'list': True, 'view': True, 'new': True, 'edit': True,
                            'delete': True, 'api': False, 'test': False, 'fields': None},
    }
    ctx = build_context(entity, schema)
    form = form_upsert_context(ctx, schema)
    assert 'useKidAsColumns(true' in form['child_grid_setup'], label
    assert 'kid_as' in ctx['child_nested_create'], label
    assert 'kid_as' in ctx['child_nested_update'], label
