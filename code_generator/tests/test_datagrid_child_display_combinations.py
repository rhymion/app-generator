"""
Full-combination tests for what an embedded DataGrid child displays (issue #800).

For every combination of the axes below, the parent's `get{Parent}Detail`
include (`include_props_detail`) must fetch the data the child's grid column
reads, and the child's `use{Prop}Columns` hook must declare that column. The
structural parent FK is the one thing that stays out of both.

Axes (the child is always an embedded DataGrid):
  page mode          none      the child has no `x-generate` of its own
                     readonly  own pages, `new`/`edit`/`delete` all false
                     editable  own pages, `new`/`edit`/`delete` all true
  non-FK column      string / integer / decimal / date / time / date-time /
                     enum, each required or nullable          (7 x 2 x 3 = 42)
  FK column          target = the parent's own model, or another model
                     nullable or required
                     label form: plain / composite / dotted / composite+dotted
                     sibling: whether another child of the same parent has a
                     non-parent FK to the parent model    (2 x 2 x 4 x 2 x 3 = 96)

Layout: one parent per (label form, sibling) pair; each parent embeds one child
per page mode. `COMBINATION_TABLE` maps every combination to the entity and
column that exercises it.
"""
import itertools
import re
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / 'code_generator'))

from build_context import build_context  # noqa: E402
from generators import column_def_context  # noqa: E402

PAGE_MODES = ('none', 'readonly', 'editable')
NULLABILITY = ('req', 'null')
SIBLING = ('solo', 'sib')

# Label forms of the FK target (the child's `x-relationship.labelField`).
LABEL_FORMS = {
    'plain': 'name',
    'composite': ['code', 'name'],
    'dotted': 'owner.name',
    'composite_dotted': ['code', 'owner.name'],
}

NON_FK_TYPES = {
    'string': {'type': 'string'},
    'integer': {'type': 'integer'},
    'decimal': {'type': 'string', 'x-decimal-scale': 2},
    'date': {'type': 'string', 'format': 'date'},
    'time': {'type': 'string', 'format': 'time'},
    'date_time': {'type': 'string', 'format': 'date-time'},
    'enum': {'type': 'string', 'enum': ['alpha', 'beta']},
}

X_GENERATE = {
    'readonly': {'list': True, 'view': True, 'new': False, 'edit': False,
                 'delete': False, 'api': False, 'test': False},
    'editable': {'list': True, 'view': True, 'new': True, 'edit': True,
                 'delete': True, 'api': False, 'test': False},
}


def _parent_name(form: str, sibling: str) -> str:
    return f'par_{form}_{sibling}'


def _child_name(form: str, sibling: str, mode: str) -> str:
    return f'kid_{form}_{sibling}_{mode}'


def _fk(target: str, nullable: bool, label_field) -> dict:
    return {
        'type': ['string', 'null'] if nullable else 'string',
        'x-relationship': {'type': 'many-to-one', 'target': target, 'labelField': label_field},
    }


def _labelled_model() -> dict:
    """A model usable as an FK target under every label form."""
    return {
        'type': 'object',
        'required': ['id', 'name', 'code', 'owner_id'],
        'properties': {
            'id': {'type': 'string'},
            'name': {'type': 'string'},
            'code': {'type': 'string'},
            'owner_id': _fk('owner', False, 'name'),
        },
    }


def _build_schema() -> dict:
    definitions = {
        'owner': {
            'type': 'object',
            'required': ['id', 'name'],
            'properties': {'id': {'type': 'string'}, 'name': {'type': 'string'}},
        },
        'other': _labelled_model(),
    }
    for form, label in LABEL_FORMS.items():
        for sibling in SIBLING:
            parent = _parent_name(form, sibling)
            definitions[parent] = _labelled_model()
            for mode in PAGE_MODES:
                props = {
                    'id': {'type': 'string'},
                    f'{parent}_id': {
                        'type': 'string',
                        'x-relationship': {'type': 'many-to-one', 'target': parent},
                    },
                }
                required = ['id', f'{parent}_id']
                for type_name, type_def in NON_FK_TYPES.items():
                    for nullability in NULLABILITY:
                        col = f'{type_name}_{nullability}'
                        props[col] = (
                            {**type_def, 'type': [type_def['type'], 'null']}
                            if nullability == 'null' else dict(type_def)
                        )
                        if nullability == 'req':
                            required.append(col)
                for kind, target in (('same', parent), ('other', 'other')):
                    for nullability in NULLABILITY:
                        col = f'{kind}_{nullability}_id'
                        props[col] = _fk(target, nullability == 'null', label)
                        if nullability == 'req':
                            required.append(col)
                kid = {'type': 'object', 'required': required, 'properties': props}
                if mode != 'none':
                    kid['x-generate'] = dict(X_GENERATE[mode])
                definitions[_child_name(form, sibling, mode)] = kid
            if sibling == 'sib':
                # Another child of the same parent whose own non-parent FK
                # also points at the parent's model.
                definitions[f'{parent}_sibling'] = {
                    'type': 'object',
                    'required': ['id', f'{parent}_id', 'related_id'],
                    'properties': {
                        'id': {'type': 'string'},
                        f'{parent}_id': {
                            'type': 'string',
                            'x-relationship': {'type': 'many-to-one', 'target': parent},
                        },
                        'related_id': _fk(parent, False, label),
                    },
                }
    return {'definitions': definitions}


SCHEMA = _build_schema()


def _entity(form: str, sibling: str) -> dict:
    parent = _parent_name(form, sibling)
    names = [_child_name(form, sibling, m) for m in PAGE_MODES]
    if sibling == 'sib':
        names.append(f'{parent}_sibling')
    return {
        'parent': parent,
        'model': parent,
        'definition_key': parent,
        'children': [
            {'name': n, 'property_name': f'{n}s', 'output_type': None,
             'file_type': None, 'relationship': None}
            for n in names
        ],
        'generate_config': {
            'list': True, 'view': True, 'new': True, 'edit': True,
            'delete': True, 'api': False, 'test': False, 'fields': None,
        },
    }


_CACHE: dict = {}


def _generated(form: str, sibling: str):
    key = (form, sibling)
    if key not in _CACHE:
        ctx = build_context(_entity(form, sibling), SCHEMA)
        _CACHE[key] = (ctx, column_def_context(ctx, SCHEMA))
    return _CACHE[key]


def _child_include(include_detail: str, child: str) -> str:
    """The text of `{child}s: ...` inside the parent's detail include."""
    start = include_detail.index(f'{child}s:')
    depth = 0
    for i in range(start, len(include_detail)):
        ch = include_detail[i]
        if ch == '{':
            depth += 1
        elif ch == '}':
            depth -= 1
            if depth == 0:
                return include_detail[start:i + 1]
        elif ch == ',' and depth == 0:
            return include_detail[start:i]
    return include_detail[start:]


def _columns_fn(col_ctx: dict, child: str) -> str:
    hook = f'use{"".join(p.title() for p in (child + "s").split("_"))}Columns'
    for entry in col_ctx['column_children']:
        if hook in entry['fn_code']:
            return entry['fn_code']
    raise AssertionError(f'{hook} not generated')


# --- combination table -------------------------------------------------------

NON_FK_CASES = [
    (mode, type_name, nullability)
    for mode, type_name, nullability in itertools.product(PAGE_MODES, NON_FK_TYPES, NULLABILITY)
]
FK_CASES = [
    (mode, kind, nullability, form, sibling)
    for mode, kind, nullability, form, sibling in itertools.product(
        PAGE_MODES, ('same', 'other'), NULLABILITY, LABEL_FORMS, SIBLING)
]

# Each non-FK combination is exercised on every child; the table names the
# canonical one (label form `plain`, no sibling).
COMBINATION_TABLE = (
    [(f'page={m} type={t} nullable={n == "null"}',
      _child_name('plain', 'solo', m), f'{t}_{n}')
     for m, t, n in NON_FK_CASES]
    + [(f'page={m} fk={k} nullable={n == "null"} label={f} sibling_fk={s == "sib"}',
        _child_name(f, s, m), f'{k}_{n}_id')
       for m, k, n, f, s in FK_CASES]
)


def test_combination_counts():
    assert len(NON_FK_CASES) == 42
    assert len(FK_CASES) == 96
    assert len(COMBINATION_TABLE) == 138


@pytest.mark.parametrize('mode,type_name,nullability', NON_FK_CASES)
def test_non_fk_column_is_fetched_and_declared(mode, type_name, nullability):
    ctx, col_ctx = _generated('plain', 'solo')
    child = _child_name('plain', 'solo', mode)
    col = f'{type_name}_{nullability}'
    # A scalar column rides along with the child rows; the child itself must
    # still be fetched.
    assert f'{child}s:' in ctx['include_props_detail']
    assert f"field: '{col}'" in _columns_fn(col_ctx, child), (
        f'{child}.{col} must be declared as a grid column')


@pytest.mark.parametrize('mode,kind,nullability,form,sibling', FK_CASES)
def test_fk_column_is_fetched_and_declared(mode, kind, nullability, form, sibling):
    ctx, col_ctx = _generated(form, sibling)
    parent = _parent_name(form, sibling)
    child = _child_name(form, sibling, mode)
    col = f'{kind}_{nullability}_id'
    relation = f'{kind}_{nullability}'

    child_include = _child_include(ctx['include_props_detail'], child)
    assert re.search(rf'(?<!\w){relation}\s*:', child_include), (
        f'{child}.{col} -> {relation} must be in the parent detail include.\n'
        f'child include was: {child_include}')
    # The structural parent link is never fetched (circular include).
    assert not re.search(rf'(?<!\w){parent}\s*:', child_include), (
        f'the structural parent FK must stay out of the include.\n'
        f'child include was: {child_include}')

    fn_code = _columns_fn(col_ctx, child)
    assert f"field: '{col}'" in fn_code
    assert f"field: '{parent}_id'" not in fn_code

    # A dotted label segment is only readable when its relation is fetched.
    if form in ('dotted', 'composite_dotted'):
        assert re.search(rf'{relation}\s*:\s*\{{\s*include:\s*\{{[^}}]*owner', child_include), (
            f'{relation} has a dotted label, so `owner` must be nested under it.\n'
            f'child include was: {child_include}')
    else:
        assert f'{relation}: true' in child_include, (
            f'{relation} has no dotted label, so it stays a flat include.\n'
            f'child include was: {child_include}')


@pytest.mark.parametrize('form', list(LABEL_FORMS))
def test_sibling_child_does_not_change_the_other_children(form):
    """A sibling child with its own FK to the parent's model must not alter
    what the other children fetch."""
    solo_ctx, _ = _generated(form, 'solo')
    sib_ctx, _ = _generated(form, 'sib')
    for mode in PAGE_MODES:
        solo = _child_include(solo_ctx['include_props_detail'], _child_name(form, 'solo', mode))
        sib = _child_include(sib_ctx['include_props_detail'], _child_name(form, 'sib', mode))
        assert solo.replace('solo', 'X') == sib.replace('sib', 'X')
    sibling = _child_include(sib_ctx['include_props_detail'], f'{_parent_name(form, "sib")}_sibling')
    assert re.search(r'(?<!\w)related\s*:', sibling), (
        f'the sibling\'s own FK to the parent model must be fetched.\nwas: {sibling}')


def test_validator_accepts_every_label_form():
    """The composite+dotted label form is accepted by the schema validator, so
    it stays in the matrix; a dotted segment that does not exist is still
    rejected (the check is real, not skipped)."""
    import copy
    from validate import SchemaValidationError, validate_schema

    validate_schema(SCHEMA)

    bad = copy.deepcopy(SCHEMA)
    rel = bad['definitions']['kid_composite_dotted_solo_none']['properties']['same_req_id']['x-relationship']
    rel['labelField'] = ['code', 'owner.nope']
    with pytest.raises(SchemaValidationError):
        validate_schema(bad)
