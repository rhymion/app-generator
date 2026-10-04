"""
Full-combination tests for an embedded `list` child (issue #801).

A parent declares a child as an array property with `x-outputType: list`. The
parent's `get{Parent}Detail` include (`include_props_detail`) must fetch every
relation of the child that the list reads, including a foreign key on the child
that points at the parent's own model. Only the structural parent link (the
column the parent owns the child through) stays out, to avoid a circular
include.

Axes (seven, as the Lord's condition table states them):
  child page            none      the child has no `x-generate` of its own
                        readonly  own pages, `new`/`edit`/`delete` all false
                        editable  own pages, `new`/`edit`/`delete` all true
  nullable              the child's structural FK to the parent is nullable.
                        Only meaningful for an editable one-to-many child:
                        detaching a child from its parent is a delete of the
                        link, so any other page mode is always required.
  relation              one-to-many / many-to-many
  self-reference        the child entity is the parent entity
  sibling FK            another child of the same parent has its own,
                        non-structural FK to the parent's model
  composite label       the child's own label (`x-relationships.labelField`
                        on the parent) is built from several fields
  dotted label          the child's own label walks a relation of the child
                        (`owner.name`), so the child carries an `owner` FK

Excluded combinations (136 of the 192 in the raw product, all by the Lord's
ruling of 2026-10-04): many-to-many and self-reference children are always an
independent, editable page with a nullable link (child page = editable,
nullable = TRUE only), so every other page / nullable value is not built for
them (120 rows). Separately, nullable TRUE exists only with an editable child
page (16 rows: one-to-many, not self-reference, page none or readonly).

An auxiliary variable, not one of the seven axes, multiplies the table by two:
whether the child also has a second FK to the parent's model (`rel_par_id`),
the shape of issue #801. Without it the table has no control for the plain
shape.

`COMBINATION_TABLE` maps every combination to the entities that exercise it.
"""
import itertools
import re
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / 'code_generator'))

from build_context import build_context  # noqa: E402
from generate_types import _extract_children  # noqa: E402

PAGE_MODES = ('none', 'readonly', 'editable')
BOOLS = (False, True)

X_GENERATE = {
    'readonly': {'list': True, 'view': True, 'new': False, 'edit': False,
                 'delete': False, 'api': False, 'test': False},
    'editable': {'list': True, 'view': True, 'new': True, 'edit': True,
                 'delete': True, 'api': False, 'test': False},
}


def _valid_rows():
    """Every constructible combination of the seven axes, in a stable order."""
    rows = []
    for page, nullable, relation, self_ref, sibling, composite, dotted in itertools.product(
            PAGE_MODES, BOOLS, ('o2m', 'm2m'), BOOLS, BOOLS, BOOLS, BOOLS):
        if relation == 'm2m' or self_ref:
            if not (page == 'editable' and nullable):
                continue
        elif nullable and page != 'editable':
            continue
        rows.append({'page': page, 'nullable': nullable, 'relation': relation,
                     'self_ref': self_ref, 'sibling': sibling,
                     'composite': composite, 'dotted': dotted})
    for i, row in enumerate(rows, 1):
        row['id'] = f'l{i:02d}'
    return rows


ROWS = _valid_rows()
EXCLUDED_COUNT = 192 - len(ROWS)
CASES = [(row, shape) for row in ROWS for shape in (True, False)]


def _case_id(row, shape):
    return f'{row["id"]}-{"rel_par" if shape else "plain"}'


def _names(row, shape):
    base = f'{row["id"]}{"p" if shape else "x"}'
    parent = f'{base}_par'
    kid = parent if row['self_ref'] else f'{base}_kid'
    return parent, kid, f'{base}_sib'


def _label(row):
    if row['composite'] and row['dotted']:
        return ['code', 'owner.name']
    if row['composite']:
        return ['code', 'name']
    if row['dotted']:
        return 'owner.name'
    return 'name'


def _fk(target, nullable=False):
    return {
        'type': ['string', 'null'] if nullable else 'string',
        'x-relationship': {'type': 'many-to-one', 'target': target},
    }


def _model(row, extra_props=None, required_extra=()):
    props = {'id': {'type': 'string'}, 'name': {'type': 'string'}, 'code': {'type': 'string'}}
    required = ['id', 'name', 'code']
    if row['dotted']:
        props['owner_id'] = _fk('owner')
        required.append('owner_id')
    props.update(extra_props or {})
    required.extend(required_extra)
    return {'type': 'object', 'required': required, 'properties': props}


def _add_case(definitions, row, shape):
    parent, kid, sib = _names(row, shape)
    link = f'{parent}_id'
    o2m = row['relation'] == 'o2m'

    kid_extra, kid_required = {}, []
    if o2m:
        kid_extra[link] = _fk(parent, nullable=row['nullable'])
        if not row['nullable']:
            kid_required.append(link)
    if shape:
        kid_extra['rel_par_id'] = _fk(parent)
        kid_required.append('rel_par_id')

    parent_props = {
        'kids': {'type': 'array', 'x-outputType': 'list', 'items': {'$ref': f'#/definitions/{kid}'}},
    }
    if row['sibling']:
        parent_props['sibs'] = {'type': 'array', 'x-outputType': 'list',
                                'items': {'$ref': f'#/definitions/{sib}'}}

    if row['self_ref']:
        parent_def = _model(row, {**kid_extra, **parent_props}, kid_required)
        definitions[parent] = parent_def
    else:
        definitions[parent] = _model(row, parent_props)
        kid_def = _model(row, kid_extra, kid_required)
        if row['page'] != 'none':
            kid_def['x-generate'] = dict(X_GENERATE[row['page']])
        definitions[kid] = kid_def

    parent_def = definitions[parent]
    parent_def['x-generate'] = {'list': True, 'view': True, 'new': True, 'edit': True,
                                'delete': True, 'api': False, 'test': False}
    if row['self_ref']:
        parent_def['x-generate'] = dict(X_GENERATE['editable'])
    parent_def['x-relationships'] = {
        'kids': {'type': 'one-to-many' if o2m else 'many-to-many',
                 'target': kid, 'labelField': _label(row)},
    }
    if row['sibling']:
        definitions[sib] = {
            'type': 'object',
            'required': ['id', 'name', link, 'related_id'],
            'properties': {
                'id': {'type': 'string'}, 'name': {'type': 'string'},
                link: _fk(parent), 'related_id': _fk(parent),
            },
        }


def _build_schema():
    definitions = {'owner': {
        'type': 'object', 'required': ['id', 'name'],
        'properties': {'id': {'type': 'string'}, 'name': {'type': 'string'}},
    }}
    for row, shape in CASES:
        _add_case(definitions, row, shape)
    return {'definitions': definitions}


SCHEMA = _build_schema()
_CACHE: dict = {}


def _entity(parent: str) -> dict:
    """The entity record the generator builds for `parent`; its children come
    from the same extractor the generator uses on a real schema."""
    return {
        'parent': parent,
        'model': parent,
        'definition_key': parent,
        'children': _extract_children(SCHEMA['definitions'][parent], SCHEMA),
        'generate_config': {
            'list': True, 'view': True, 'new': True, 'edit': True,
            'delete': True, 'api': False, 'test': False, 'fields': None,
        },
    }


def _ctx(row, shape):
    parent = _names(row, shape)[0]
    if parent not in _CACHE:
        _CACHE[parent] = build_context(_entity(parent), SCHEMA)
    return _CACHE[parent]


def _entry_text(include_detail: str, prop: str) -> str:
    """The text of `{prop}: ...` inside the parent's detail include."""
    start = include_detail.index(f'{prop}:')
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


# --- combination table -------------------------------------------------------

def _describe(row):
    return (f'page={row["page"]} nullable={row["nullable"]} relation={row["relation"]} '
            f'self_ref={row["self_ref"]} sibling_fk={row["sibling"]} '
            f'composite={row["composite"]} dotted={row["dotted"]}')


def _fk_description(row, shape):
    parent, kid, _ = _names(row, shape)
    parts = []
    if row['relation'] == 'o2m':
        parts.append(f'{kid}.{parent}_id -> {parent} (structural, '
                     f'{"nullable" if row["nullable"] else "required"})')
    else:
        parts.append('no structural FK (many-to-many)')
    if shape:
        parts.append(f'{kid}.rel_par_id -> {parent} (issue #801 shape)')
    return '; '.join(parts)


# One line per combination: what is tested, on which entities, through which
# relations. Rows with a sibling also build `<base>_sib` (own FK `related_id`
# to the parent's model).
COMBINATION_TABLE = [
    (f'{row["id"]} {_describe(row)} second_fk_to_parent={shape}',
     {'parent': _names(row, shape)[0], 'child': _names(row, shape)[1],
      'sibling': _names(row, shape)[2] if row['sibling'] else None,
      'label': _label(row), 'fk': _fk_description(row, shape)})
    for row, shape in CASES
]

# Combinations that are not built, with the reason.
EXCLUSIONS = {
    'many-to-many or self-reference child without page=editable and nullable=TRUE':
        "Lord's ruling: such a child is always an independent, editable page "
        'with a nullable link',
    'nullable=TRUE with page none or readonly (one-to-many, not self-reference)':
        "Lord's note: the link is only nullable for an editable child page, "
        'since detaching a child is the same as deleting it',
}


def test_combination_counts():
    assert len(ROWS) == 56
    assert EXCLUDED_COUNT == 136
    assert len(CASES) == 112 == len(COMBINATION_TABLE)
    # 120 rows lost to the m2m / self-reference ruling, 16 to the nullable note.
    raw = list(itertools.product(PAGE_MODES, BOOLS, ('o2m', 'm2m'), BOOLS, BOOLS, BOOLS, BOOLS))
    assert len(raw) == 192
    keys = lambda r: (r['page'], r['nullable'], r['relation'], r['self_ref'],
                      r['sibling'], r['composite'], r['dotted'])
    built = {keys(r) for r in ROWS}
    ruling = [c for c in raw if c not in built and (c[2] == 'm2m' or c[3])]
    note = [c for c in raw if c not in built and not (c[2] == 'm2m' or c[3])]
    assert (len(ruling), len(note)) == (120, 16)
    assert all(c[1] and c[0] != 'editable' for c in note)
    assert len(EXCLUSIONS) == 2


def test_validator_accepts_every_combination():
    """Composite and dotted labels together are accepted by the schema
    validator, so every row stays in the matrix."""
    from validate import validate_schema
    validate_schema(SCHEMA)


@pytest.mark.parametrize('row,shape', CASES, ids=[_case_id(r, s) for r, s in CASES])
def test_list_child_include(row, shape):
    parent, kid, sib = _names(row, shape)
    ctx = _ctx(row, shape)
    detail = ctx['include_props_detail']
    kid_include = _entry_text(detail, 'kids')
    where = f'{_describe(row)} second_fk_to_parent={shape}\nkids include was: {kid_include}'

    # The child's own FK to the parent's model is fetched (issue #801).
    if shape:
        assert re.search(r'(?<!\w)rel_par\s*:', kid_include), f'rel_par must be fetched.\n{where}'
    else:
        assert not re.search(r'(?<!\w)rel_par\s*:', kid_include), where

    # The structural link is never fetched (circular include).
    assert not re.search(rf'(?<!\w){parent}\s*:', kid_include), (
        f'the structural parent link must stay out.\n{where}')

    # The child's own label: a dotted label needs its relation fetched.
    if row['dotted']:
        assert re.search(r'(?<!\w)owner\s*:', kid_include), f'owner must be fetched.\n{where}'
    else:
        assert not re.search(r'(?<!\w)owner\s*:', kid_include), where

    # Nothing to fetch -> the child stays a flat `true`.
    if not shape and not row['dotted']:
        assert kid_include == 'kids: true', where

    # Every relation the child's own label walks is part of the include.
    from helpers.label_field import build_label_expression
    built = build_label_expression('item', _label(row), kid, SCHEMA)
    for relation in (built.get('prisma_include') or {}):
        assert re.search(rf'(?<!\w){relation}\s*:', kid_include), (
            f'label {_label(row)!r} needs {relation}.\n{where}')

    # The declared label reaches the generator unchanged.
    child_entry = next(c for c in ctx['children_data'] if c['property_name'] == 'kids')
    assert child_entry['relationship']['label_field'] == _label(row)
    assert child_entry['output_type'] == 'list'

    # A sibling child's own FK to the parent's model is fetched too.
    if row['sibling']:
        sib_include = _entry_text(detail, 'sibs')
        assert re.search(r'(?<!\w)related\s*:', sib_include), (
            f'the sibling\'s own FK to the parent model must be fetched.\nwas: {sib_include}')
        assert not re.search(rf'(?<!\w){parent}\s*:', sib_include)
    else:
        assert 'sibs' not in detail


@pytest.mark.parametrize('row,shape', [c for c in CASES if c[0]['relation'] == 'm2m'],
                         ids=[_case_id(r, s) for r, s in CASES if r['relation'] == 'm2m'])
def test_many_to_many_association_add_remove_is_generated(row, shape):
    """Adding an existing child to the parent's list and removing it again are
    association writes (connect on create, set on update). Removing a child from
    the list never deletes the child record."""
    ctx = _ctx(row, shape)
    create, update = ctx['child_nested_create'], ctx['child_nested_update']
    assert re.search(r'kids:\s*\{\s*connect:\s*kidsIds\.map', create), create
    assert re.search(r'kids:\s*\{\s*set:\s*kidsIds\.map', update), update
    for text in (create, update):
        # Only the `kids` block: a sibling child has its own nested writes.
        kids_block = text[text.index('kids:'):].split('sibs:')[0]
        assert 'delete' not in kids_block.lower(), kids_block
    # The parent's own `kids` array is read back by id, not rebuilt.
    assert 'kidsIds' in ctx['child_params_for_update']


def test_include_does_not_depend_on_the_sibling_child():
    """A sibling child changes only its own include entry."""
    by_key = {(r['page'], r['nullable'], r['relation'], r['self_ref'],
               r['composite'], r['dotted'], r['sibling']): r for r in ROWS}
    for (page, nullable, relation, self_ref, composite, dotted, sibling), row in by_key.items():
        if sibling:
            continue
        other = by_key[(page, nullable, relation, self_ref, composite, dotted, True)]
        for shape in (True, False):
            solo = _entry_text(_ctx(row, shape)['include_props_detail'], 'kids')
            with_sib = _entry_text(_ctx(other, shape)['include_props_detail'], 'kids')
            assert solo == with_sib, (row['id'], other['id'], shape)
