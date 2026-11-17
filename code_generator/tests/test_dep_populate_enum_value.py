"""
Regression test: a dependency row that populateXxxDependencies creates in a
generated Cypress helper gets a member of a required enum column, not the
generic "Test <Field> A" placeholder, which Prisma refuses for a native enum
("Invalid value for argument `status`. Expected <Enum>"). Found when the
security fixture gave sx_profile an optional one-to-one reference to sx_split,
whose `status` is a required enum (Issue #1324).

Run:
    cd code_generator && python3 -m pytest tests/test_dep_populate_enum_value.py -v
"""
from generators_test import _get_dep_populate_fields

_ID = {'type': 'string', 'pattern': '^c[a-z0-9]{24,}$'}


def _schema(enum: list) -> dict:
    return {'definitions': {
        '__split': {
            'type': 'object', 'required': ['id', 'title', 'status'],
            'properties': {'id': _ID, 'title': {'type': 'string'}, 'status': {'type': 'string', 'enum': enum}},
        },
        'split': {'x-generate': {'list': True}, 'allOf': [{'$ref': '#/definitions/__split'}]},
    }}


def _status(enum: list) -> dict:
    fields = _get_dep_populate_fields('split', 'split', 'Split', _schema(enum))
    return next(f for f in fields if f['prop_name'] == 'status')


def test_a_required_enum_column_gets_its_first_member():
    status = _status(['pending', 'split', 'rejected'])
    assert status['prisma_val'] == "'pending'"
    assert status['prisma_val_unique'] == "'pending'"
    assert status['prisma_val_second'] == "'split'"


def test_a_single_member_enum_is_reused_for_the_second_row_and_null_is_skipped():
    status = _status([None, 'only'])
    assert status['prisma_val'] == status['prisma_val_second'] == "'only'"


def test_a_plain_string_column_keeps_the_placeholder():
    fields = _get_dep_populate_fields('split', 'split', 'Split', _schema(['pending']))
    title = next(f for f in fields if f['prop_name'] == 'title')
    assert title['prisma_val'] == "'Test Title A'"
