"""
cmd_711f: Decimal-column test-value generation.

Before this fix, a Decimal-backed field (`_prisma_decimal_type: True`,
exposed as JSON type "string" per cmd_705) fell into get_field_metas()'s
generic 'text' category and got a human-readable, non-numeric placeholder
("Test Unit Price 1") from prisma_value / cypress_create_value /
cypress_edit_value / api_value, and the same shape from the two
dependency-field generators (_get_dep_populate_fields,
_get_dep_extra_required_fields). Prisma's Decimal column rejects that
outright at runtime ("invalid digit found in string. Expected decimal
String."), which is NOT a TypeScript type error — the placeholder is still
a valid `string` — so the tsc-based decimal_gate fixture cannot catch this
class of bug; only exercising the actual value generators (this test) or a
live Prisma database (proj_g's own e2e, where this was discovered via
subtask_711b's Int-cents→Decimal migration) can.

This test asserts every value generator produces a numeric-parseable
string for a Decimal field, and non-Decimal string fields are unaffected.
"""
import re

from generators_test import (
    get_field_metas,
    prisma_value,
    cypress_create_value,
    cypress_edit_value,
    api_value,
    gen_fill_command,
    gen_clear_command,
    _get_dep_populate_fields,
    _get_dep_extra_required_fields,
)

_NUMERIC_RE = re.compile(r'^-?\d+(\.\d+)?$')


def _decimal_field() -> dict:
    return {
        'type': 'string',
        '_prisma_decimal_type': True,
        'x-decimal-scale': 2,
    }


def _strip_js_quotes(expr: str) -> str:
    """Evaluate a *literal* (no runtime interpolation) JS string/template
    literal down to its bare content, for the val/val_second cases (which
    are always literals, unlike val_unique's `${i * 10}.00` form)."""
    e = expr.strip()
    if e.startswith("'") and e.endswith("'"):
        return e[1:-1]
    if e.startswith('`') and e.endswith('`'):
        return e[1:-1]
    return e


def test_get_field_metas_categorizes_decimal_field():
    props = {'unit_price': _decimal_field()}
    metas = get_field_metas(props, required_fields=['unit_price'], relationships=[])
    assert len(metas) == 1
    assert metas[0]['category'] == 'decimal'
    assert metas[0]['prop_name'] == 'unit_price'


def test_get_field_metas_leaves_plain_string_as_text():
    props = {'name': {'type': 'string'}}
    metas = get_field_metas(props, required_fields=['name'], relationships=[])
    assert metas[0]['category'] == 'text'


def test_prisma_value_decimal_is_numeric():
    # prisma_value always renders a `${<index> * 10}.00` template literal for
    # 'decimal' (both the '1'-fixed and 'i'-runtime index forms) — assert the
    # shape rather than a bare numeric literal, since `index` is JS source
    # text evaluated at runtime, not a value this test can compute directly.
    field = {'category': 'decimal', 'prop_name': 'unit_price', 'label': 'Unit Price'}
    fixed = prisma_value(field, '1', 'Item')
    assert fixed == '`${1 * 10}.00`', f'expected a decimal template literal, got {fixed!r}'
    unique = prisma_value(field, 'i', 'Item')
    assert unique.startswith('`') and 'i * 10' in unique and unique.endswith('.00`')


def test_cypress_create_and_edit_value_decimal_are_numeric_and_distinct():
    field = {'category': 'decimal', 'prop_name': 'unit_price', 'label': 'Unit Price'}
    created = cypress_create_value(field, 'Item')
    edited = cypress_edit_value(field, 'Item')
    assert _NUMERIC_RE.match(created), f'expected numeric string, got {created!r}'
    assert _NUMERIC_RE.match(edited), f'expected numeric string, got {edited!r}'
    assert created != edited


def test_api_value_decimal_is_quoted_numeric_string():
    field = {'category': 'decimal', 'prop_name': 'unit_price', 'label': 'Unit Price'}
    val = api_value(field, 'Item')
    assert val.startswith("'") and val.endswith("'")
    assert _NUMERIC_RE.match(val[1:-1]), f'expected numeric string, got {val!r}'


def test_gen_fill_command_decimal_uses_fill_field_not_autocomplete():
    # cmd_713 follow-up: get_field_metas() categorizes a Decimal field as
    # 'decimal' (not 'number'), but gen_fill_command/gen_clear_command's
    # dispatch tuples only checked for ('text', 'number') and fell through
    # to the `else` branch, which emits cy.selectAutocomplete(). A Decimal
    # scalar field has no MuiAutocomplete-root input to find, so the
    # generated cypress spec times out on `cy.get('label').filter(...)`
    # ("Expected to find element: `filter`, but never found it") — this
    # broke purchase_order_line/sales_order/sales_order_line's generated
    # UI specs in PR#29's CI (test:e2e:cy:start), even though the
    # tsc-based decimal_gate fixture and the API-only mandatory gate
    # (test:e2e:cy:api) both stayed green, since neither exercises the
    # generated Cypress command text.
    field = {'category': 'decimal', 'prop_name': 'unit_price', 'label': 'Unit Price'}
    fill = gen_fill_command(field, '150.00', '        ')
    clear = gen_clear_command(field, '        ')
    assert "cy.fillField('Unit Price', '150.00');" in fill, f'expected fillField, got {fill!r}'
    assert "cy.clearField('Unit Price');" in clear, f'expected clearField, got {clear!r}'
    assert 'selectAutocomplete' not in fill
    assert 'clearAutocomplete' not in clear


def _dep_target_schema(required_extra: bool = True) -> dict:
    props = {
        'id': {'type': 'string'},
        'name': {'type': 'string'},
        'unit_price': _decimal_field(),
        'created_at': {'type': 'string', 'format': 'date-time'},
        'updated_at': {'type': 'string', 'format': 'date-time'},
        'creator_id': {'type': 'string'},
        'updater_id': {'type': 'string'},
    }
    required = ['id', 'name', 'created_at', 'updated_at', 'creator_id', 'updater_id']
    if required_extra:
        required.append('unit_price')
    return {
        'definitions': {
            'dep_item': {
                'type': 'object',
                'required': required,
                'properties': props,
            },
        },
    }


def test_get_dep_populate_fields_decimal_is_numeric():
    schema = _dep_target_schema()
    fields = _get_dep_populate_fields('dep_item', 'depItem', 'Dep Item', schema)
    price_field = next(f for f in fields if f['prop_name'] == 'unit_price')
    assert _NUMERIC_RE.match(_strip_js_quotes(price_field['prisma_val']))
    assert _NUMERIC_RE.match(_strip_js_quotes(price_field['prisma_val_second']))
    # prisma_val_unique is a `${i * 10}.00` runtime expression, not a literal.
    assert 'i * 10' in price_field['prisma_val_unique']


def test_get_dep_extra_required_fields_decimal_is_numeric():
    schema = _dep_target_schema()
    fields = _get_dep_extra_required_fields('dep_item', schema)
    price_field = next(f for f in fields if f['prop_name'] == 'unit_price')
    assert _NUMERIC_RE.match(_strip_js_quotes(price_field['prisma_val']))
    assert _NUMERIC_RE.match(_strip_js_quotes(price_field['prisma_val_second']))
    assert 'i * 10' in price_field['prisma_val_unique']
