"""
Server-side maximum length for string fields (Issue #1273, ASVS V1.3.3).

Every writable string field is checked on the server: the declared `maxLength`,
or DEFAULT_STRING_MAX_LENGTH (65535) when none is declared. The check runs in the
generated service_validation.ts (every create/update path: REST, bulk, Server
Action, CSV import through the service) and per cell in the CSV import route.

Run:
    cd code_generator && python3 -m pytest tests/test_string_max_length.py -v
"""
import copy
import json
import re

from build_context import build_context
from helpers.string_limits import (
    DEFAULT_STRING_MAX_LENGTH,
    is_length_checked_string,
    string_max_length,
)
from validation_context import build_validation_context

from tests.test_validation_message_reason_and_context_filter import (
    _entity_meta,
    _make_env,
    _schema,
)


def _schema_with_limits() -> dict:
    schema = copy.deepcopy(_schema())
    props = schema['definitions']['ticket']['properties']
    props['name']['maxLength'] = 50
    props['note'] = {'type': ['string', 'null']}
    props['amount'] = {'type': 'string', '_prisma_decimal_type': 'Decimal'}
    props['count'] = {'type': 'integer'}
    schema['definitions']['ticket']['x-import-key'] = ['name']
    return schema


def _ctx() -> dict:
    return build_context(_entity_meta(), _schema_with_limits())


def _fields_by_key() -> dict:
    return {f['key']: f for f in build_validation_context(_ctx())['string_length_fields']}


def test_default_is_65535():
    assert DEFAULT_STRING_MAX_LENGTH == 65535


def test_declared_max_length_wins_and_default_applies_otherwise():
    assert string_max_length({'type': 'string', 'maxLength': 50}) == 50
    assert string_max_length({'type': 'string'}) == DEFAULT_STRING_MAX_LENGTH
    # A malformed declaration does not lift the cap.
    assert string_max_length({'type': 'string', 'maxLength': 0}) == DEFAULT_STRING_MAX_LENGTH
    assert string_max_length({'type': 'string', 'maxLength': True}) == DEFAULT_STRING_MAX_LENGTH


def test_only_plain_strings_are_length_checked():
    assert is_length_checked_string({'type': 'string'})
    assert is_length_checked_string({'type': ['string', 'null']})
    assert is_length_checked_string({'type': 'string', 'format': 'date'})
    assert not is_length_checked_string({'type': 'string', '_prisma_decimal_type': 'Decimal'})
    assert not is_length_checked_string({'type': 'integer'})
    assert not is_length_checked_string({'type': 'boolean'})


def test_validation_context_lists_every_writable_string_field():
    fields = _fields_by_key()
    assert fields['name']['max_length'] == 50
    assert fields['note']['max_length'] == DEFAULT_STRING_MAX_LENGTH
    assert fields['policy_id']['max_length'] == DEFAULT_STRING_MAX_LENGTH
    assert 'amount' not in fields, 'decimal strings have their own format check'
    assert 'count' not in fields
    assert 'id' not in fields, 'system fields are never user-supplied'


def test_service_validation_rejects_too_long_strings_with_400_shape():
    ctx = _ctx()
    rendered = _make_env().get_template('service_validation.ts.jinja2').render(
        **{**ctx, **build_validation_context(ctx)}
    )
    assert "{ key: 'name', label: 'Name', maxLength: 50 }" in rendered
    assert f"{{ key: 'note', label: 'Note', maxLength: {DEFAULT_STRING_MAX_LENGTH} }}" in rendered
    loop = rendered.split('for (const field of STRING_LENGTH_FIELDS)')[1][:300]
    assert 'exceedsMaxLength(data[field.key], field.maxLength)' in loop
    assert "throw new AppError('VALIDATION'" in loop and "field.key, 'invalid'" in loop
    # Counted in code points, like JSON Schema's maxLength.
    assert 'Array.from(value).length > maxLength' in rendered
    # Runs before the hand-written rules, with the other generated rules.
    body = rendered.split('async function validateSchemaRules')[1]
    assert body.index('STRING_LENGTH_FIELDS') < body.index('validateCustomRules')


def test_import_field_specs_carry_the_same_limit():
    specs = {s['name']: s for s in _ctx()['import_field_specs']}
    assert specs['name']['max_length'] == 50
    if 'note' in specs:
        assert specs['note']['max_length'] == DEFAULT_STRING_MAX_LENGTH
    if 'amount' in specs:
        assert specs['amount']['max_length'] is None
    if 'count' in specs:
        assert specs['count']['max_length'] is None


def test_import_route_refuses_a_too_long_cell():
    ctx = _ctx()
    rendered = _make_env().get_template('api_import_route.ts.jinja2').render(**ctx)
    m = re.search(r'const FIELD_SPECS: FieldSpec\[\] = (\[.*?\]);\n', rendered)
    assert m, 'FIELD_SPECS literal not found'
    specs = {s['name']: s for s in json.loads(m.group(1))}
    assert specs['name']['max_length'] == 50
    coerce = rendered.split('function coerceValue')[1].split('\nexport async function POST')[0]
    assert 'spec.max_length !== null' in coerce
    assert 'Array.from(v).length > spec.max_length' in coerce
