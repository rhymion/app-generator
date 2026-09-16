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
an earlier Int-cents→Decimal migration) can.

This test asserts every value generator produces a numeric-parseable
string for a Decimal field, and non-Decimal string fields are unaffected.

cmd_754: numeric-parseable was not enough — every generator planted the same
fixed literal (e.g. '10.00') regardless of the column's declared
`@db.Decimal(precision, scale)`, so a narrow column such as Decimal(5, 4)
(one integer digit, four fractional digits) rejected it with a real
Postgres "numeric field overflow", taking every test in the same spec file
down with it. The value is now derived from x-decimal-scale/
x-decimal-precision (schema_deriver, auto-reflected from the Prisma
column) instead of a fixed literal; see the "precision-floor" tests below.
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
    # prisma_value (cmd_754: derived from the field's decimal_scale /
    # decimal_force_zero_int meta, not a fixed literal) renders a
    # precomputed quoted literal for the '1'-fixed index form, and a runtime
    # template literal that cycles 1-9 for the 'i'-runtime form.
    field = {'category': 'decimal', 'prop_name': 'unit_price', 'label': 'Unit Price', 'decimal_scale': 2}
    fixed = prisma_value(field, '1', 'Item')
    assert fixed == "'1.00'", f'expected a decimal literal, got {fixed!r}'
    unique = prisma_value(field, 'i', 'Item')
    assert unique.startswith('`') and 'i % 9' in unique and unique.endswith('.00`')


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
    # prisma_val_unique (cmd_754) is a `${((i % 9) + 1)}.00` runtime
    # expression, not a literal — cycling 1-9 keeps it precision-safe.
    assert 'i % 9' in price_field['prisma_val_unique']


def test_get_dep_extra_required_fields_decimal_is_numeric():
    schema = _dep_target_schema()
    fields = _get_dep_extra_required_fields('dep_item', schema)
    price_field = next(f for f in fields if f['prop_name'] == 'unit_price')
    assert _NUMERIC_RE.match(_strip_js_quotes(price_field['prisma_val']))
    assert _NUMERIC_RE.match(_strip_js_quotes(price_field['prisma_val_second']))
    assert 'i % 9' in price_field['prisma_val_unique']


# ---------------------------------------------------------------------------
# cmd_754: precision-floor regression — every Decimal value generator must
# fit the column's declared `@db.Decimal(precision, scale)`, not just be
# numeric-parseable. A fixed literal like '10.00' is numeric, but overflows
# a narrow column such as Decimal(5, 4) (confirmed against a real Postgres
# numeric(5,4) column: "numeric field overflow / must round to an absolute
# value less than 10^1" for '10.00', success for the derived '1.0000').
# ---------------------------------------------------------------------------

def _assert_fits_decimal(value: str, precision: int, scale: int) -> None:
    """Assert a bare (unquoted, non-templated) decimal string fits
    `@db.Decimal(precision, scale)` under Postgres numeric(p, s) rules: at
    most `scale` fractional digits, and at most `precision - scale` integer
    digits."""
    assert _NUMERIC_RE.match(value), f'expected numeric string, got {value!r}'
    int_part, _, frac_part = value.lstrip('-').partition('.')
    assert len(frac_part) <= scale, f'{value!r} has {len(frac_part)} fractional digits > scale {scale}'
    max_int_digits = max(0, precision - scale)
    assert len(int_part.lstrip('0') or '0') <= max_int_digits or int_part.lstrip('0') == '', (
        f'{value!r} has more than {max_int_digits} integer digits for Decimal({precision}, {scale})'
    )


def _tight_decimal_field(precision: int, scale: int) -> dict:
    return {'type': 'string', '_prisma_decimal_type': True, 'x-decimal-scale': scale, 'x-decimal-precision': precision}


def test_decimal_5_4_field_values_fit_declared_precision():
    # Reproduces cmd_754's reported case: coinsurance_rate Decimal(5, 4).
    props = {'coinsurance_rate': _tight_decimal_field(5, 4)}
    metas = get_field_metas(props, required_fields=['coinsurance_rate'], relationships=[])
    field = metas[0]
    assert field['decimal_scale'] == 4
    assert field['decimal_force_zero_int'] is False

    _assert_fits_decimal(_strip_js_quotes(prisma_value(field, '1', 'Policy')), 5, 4)
    _assert_fits_decimal(cypress_create_value(field, 'Policy'), 5, 4)
    _assert_fits_decimal(cypress_edit_value(field, 'Policy'), 5, 4)
    _assert_fits_decimal(_strip_js_quotes(api_value(field, 'Policy')), 5, 4)
    assert cypress_create_value(field, 'Policy') != cypress_edit_value(field, 'Policy')

    schema = {
        'definitions': {
            'dep_item': {
                'type': 'object',
                'required': ['id', 'name', 'coinsurance_rate', 'created_at', 'updated_at', 'creator_id', 'updater_id'],
                'properties': {
                    'id': {'type': 'string'},
                    'name': {'type': 'string'},
                    'coinsurance_rate': _tight_decimal_field(5, 4),
                    'created_at': {'type': 'string', 'format': 'date-time'},
                    'updated_at': {'type': 'string', 'format': 'date-time'},
                    'creator_id': {'type': 'string'},
                    'updater_id': {'type': 'string'},
                },
            },
        },
    }
    for fields in (
        _get_dep_populate_fields('dep_item', 'depItem', 'Dep Item', schema),
        _get_dep_extra_required_fields('dep_item', schema),
    ):
        price_field = next(f for f in fields if f['prop_name'] == 'coinsurance_rate')
        _assert_fits_decimal(_strip_js_quotes(price_field['prisma_val']), 5, 4)
        _assert_fits_decimal(_strip_js_quotes(price_field['prisma_val_second']), 5, 4)
        assert 'i % 9' in price_field['prisma_val_unique']


def test_decimal_4_4_all_fractional_field_forces_zero_integer_part():
    # precision - scale == 0: the value must be strictly < 1 (Postgres
    # numeric(4, 4) rejects any nonzero leading digit, e.g. '1.0000').
    props = {'discount_fraction': _tight_decimal_field(4, 4)}
    metas = get_field_metas(props, required_fields=['discount_fraction'], relationships=[])
    field = metas[0]
    assert field['decimal_force_zero_int'] is True

    for value in (
        _strip_js_quotes(prisma_value(field, '1', 'Item')),
        cypress_create_value(field, 'Item'),
        cypress_edit_value(field, 'Item'),
        _strip_js_quotes(api_value(field, 'Item')),
    ):
        _assert_fits_decimal(value, 4, 4)
        assert value.startswith('0.'), f'expected a zero integer part, got {value!r}'
    assert cypress_create_value(field, 'Item') != cypress_edit_value(field, 'Item')


def test_decimal_common_10_2_field_unaffected_by_precision_floor():
    # Regression guard: an ordinary Decimal(10, 2) column (ample headroom,
    # the shape most existing schemas use) keeps producing distinct, valid
    # values after the precision-derivation change.
    props = {'unit_price': _tight_decimal_field(10, 2)}
    metas = get_field_metas(props, required_fields=['unit_price'], relationships=[])
    field = metas[0]
    assert field['decimal_force_zero_int'] is False

    created = cypress_create_value(field, 'Item')
    edited = cypress_edit_value(field, 'Item')
    _assert_fits_decimal(created, 10, 2)
    _assert_fits_decimal(edited, 10, 2)
    assert created != edited
