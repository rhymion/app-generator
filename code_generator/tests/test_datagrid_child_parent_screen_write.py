"""
Parent-screen writes for embedded DataGrid children (issue #800).

A child whose own pages cannot write it (no `x-generate`, or `new`/`edit`/
`delete` all false) is created and edited from the parent's new and edit
screens, which share `FormUpsert`. For every column combination of
`test_datagrid_child_display_combinations.py` this file checks:

  (a) the column is part of the write path: the submitted row, the parsed
      row, the nested create (new screen) and the nested update (edit screen)
      of the parent service, and the blank row a new grid row starts from;
  (c) a required (non-nullable) column is checked before saving and a
      nullable column is not, so leaving it empty only blocks the former.

A child with its own writable pages (`editable`) stays read-only on the parent
screens: no add control, no editable columns, no write path.

(b) the FK label display and selection is browser-only and lives in the
consumer-side Cypress spec, not here.
"""
import re
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / 'code_generator'))

from generators import form_upsert_context  # noqa: E402
from test_datagrid_child_display_combinations import (  # noqa: E402
    FK_CASES, NON_FK_CASES, NON_FK_TYPES, PAGE_MODES, LABEL_FORMS, SIBLING,
    SCHEMA, _child_name, _entity, _parent_name,
)
from build_context import build_context  # noqa: E402

WRITABLE_MODES = ('none', 'readonly')

_CACHE: dict = {}


def _generated(form: str, sibling: str):
    key = (form, sibling)
    if key not in _CACHE:
        ctx = build_context(_entity(form, sibling), SCHEMA)
        _CACHE[key] = (ctx, form_upsert_context(ctx, SCHEMA))
    return _CACHE[key]


def _block(text: str, anchor: str, all_anchors: list[str]) -> str:
    """The part of `text` that belongs to `anchor`: from it to the next child's anchor."""
    start = text.index(anchor)
    later = [text.index(a, start + len(anchor)) for a in all_anchors
             if a != anchor and a in text[start + len(anchor):]]
    return text[start:min(later)] if later else text[start:]


def _anchors(form_name: str, sibling: str, suffix: str) -> list[str]:
    return [f'{_child_name(form_name, sibling, m)}{suffix}' for m in PAGE_MODES]


def _new_row_block(form: dict, child: str) -> str:
    pascal = ''.join(p.title() for p in f'{child}s'.split('_'))
    setup = form['child_grid_setup']
    i = setup.index(f'createNew{pascal}')
    j = setup.index('});', i)
    return setup[i:j]


def _validation_required(form: dict, child: str) -> list[str]:
    pascal = ''.join(p.title() for p in f'{child}s'.split('_'))
    code = form['child_validation_code']
    m = re.search(rf'invalid{pascal}\b.*?\[(.*?)\]\.some', code, re.S)
    assert m, f'no required-field check generated for {child}'
    return re.findall(r"'([^']+)'", m.group(1))


def _assert_write_path(ctx: dict, form: dict, form_name: str, sibling: str, child: str, col: str):
    handling = _block(form['child_form_data_handling'], f'{child}[]', _anchors(form_name, sibling, '[]'))
    assert f'{col}: field.{col}' in handling, f'{child}.{col} is not submitted from the grid row'
    extraction = _block(ctx['child_form_data_extractions'], f"'{child}[]'", [f"'{n}[]'" for n in
                        [_child_name(form_name, sibling, m) for m in PAGE_MODES]])
    assert re.search(rf'\b{col}\??: ', extraction), f'{child}.{col} is not parsed from the submitted row'
    props = _anchors(form_name, sibling, 's: {')
    create = _block(ctx['child_nested_create'], f'{child}s: {{', props)
    assert f'{col}: f.{col}' in create, f'{child}.{col} is not written on create (new parent screen)'
    update = _block(ctx['child_nested_update'], f'{child}s: {{', props)
    assert f'{col}: f.{col}' in update, f'{child}.{col} is not written on update (edit parent screen)'
    assert re.search(rf'\b{col}:', _new_row_block(form, child)), f'{child}.{col} is missing from a new grid row'


@pytest.mark.parametrize('mode,type_name,nullability', [c for c in NON_FK_CASES if c[0] in WRITABLE_MODES])
def test_non_fk_column_write_path_and_required_check(mode, type_name, nullability):
    ctx, form = _generated('plain', 'solo')
    child = _child_name('plain', 'solo', mode)
    col = f'{type_name}_{nullability}'
    _assert_write_path(ctx, form, 'plain', 'solo', child, col)
    required = _validation_required(form, child)
    assert (col in required) == (nullability == 'req'), (
        f'{child}.{col}: required check list was {required}')


@pytest.mark.parametrize('mode,kind,nullability,form_name,sibling',
                         [c for c in FK_CASES if c[0] in WRITABLE_MODES])
def test_fk_column_write_path_and_required_check(mode, kind, nullability, form_name, sibling):
    ctx, form = _generated(form_name, sibling)
    child = _child_name(form_name, sibling, mode)
    col = f'{kind}_{nullability}_id'
    _assert_write_path(ctx, form, form_name, sibling, child, col)
    required = _validation_required(form, child)
    assert (col in required) == (nullability == 'req'), (
        f'{child}.{col}: required check list was {required}')
    # The autocomplete config for the grid column is wired for the picker.
    assert f'{kind}{nullability.title()}IdConfig' in form['child_grid_setup'], form['child_grid_setup'][:400]


def test_case_counts():
    assert len([c for c in NON_FK_CASES if c[0] in WRITABLE_MODES]) == 28
    assert len([c for c in FK_CASES if c[0] in WRITABLE_MODES]) == 64


@pytest.mark.parametrize('form_name,sibling', [(f, s) for f in LABEL_FORMS for s in SIBLING])
def test_editable_child_has_no_write_controls_on_the_parent_screen(form_name, sibling):
    """A child with its own writable pages is shown read-only on the parent's
    new and edit screens: no add control, no editable columns, no write path."""
    ctx, form = _generated(form_name, sibling)
    child = _child_name(form_name, sibling, 'editable')
    pascal = ''.join(p.title() for p in f'{child}s'.split('_'))
    assert f'addButtonLabel="Add {" ".join(p.title() for p in f"{child}s".split("_"))}"' not in form['child_grid_components']
    assert f'use{pascal}Columns(true' not in form['child_grid_setup']
    assert f'createNew{pascal}' not in form['child_grid_setup']
    assert f'{child}s' not in ctx['child_nested_create']
    assert f'{child}s' not in ctx['child_nested_update']
    assert f"'{child}[]'" not in form['child_form_data_handling']
    assert f'invalid{pascal}' not in form['child_validation_code']


@pytest.mark.parametrize('mode', WRITABLE_MODES)
@pytest.mark.parametrize('type_name', ['date', 'time', 'date_time'])
def test_new_row_seeds_a_nullable_date_column_empty_and_a_required_one_with_a_value(mode, type_name):
    """A new grid row must not fill in a nullable date/time column: leaving it
    empty has to be the default, as it already is for nullable numbers, decimals
    and enums. A required date/time column still starts with a value."""
    _, form = _generated('plain', 'solo')
    block = _new_row_block(form, _child_name('plain', 'solo', mode))
    nullable = re.search(rf'\b{type_name}_null: (.+),', block).group(1)
    required = re.search(rf'\b{type_name}_req: (.+),', block).group(1)
    assert nullable == 'null', f'{type_name}_null starts as {nullable}'
    assert required != 'null' and 'dayjs()' in required, f'{type_name}_req starts as {required}'
