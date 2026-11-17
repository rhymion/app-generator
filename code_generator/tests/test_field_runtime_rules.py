"""
Runtime validation of submitted values against the JSON schema (Issue #1271, ASVS V2.2.1).

Every writable scalar field gets a rule in the generated service_validation.ts: the JSON type is
always checked; enum, numeric bounds, minLength, pattern and format only when the schema declares
them. No schema key is added. Unknown body keys keep being dropped by the routes' destructuring.

Run:
    cd code_generator && python3 -m pytest tests/test_field_runtime_rules.py -v
"""
import copy
import json
import re

from build_context import build_context
from validation_context import build_field_rule, build_validation_context

from tests.test_validation_message_reason_and_context_filter import (
    _entity_meta,
    _make_env,
    _schema,
)


def test_type_is_always_checked():
    assert build_field_rule('title', {'type': 'string'}) == {'key': 'title', 'label': 'Title', 'type': 'string'}
    assert build_field_rule('qty', {'type': ['integer', 'null']})['type'] == 'integer'
    assert build_field_rule('ratio', {'type': 'number'})['type'] == 'number'
    assert build_field_rule('active', {'type': 'boolean'})['type'] == 'boolean'


def test_declared_constraints_are_carried_and_nothing_else():
    rule = build_field_rule('price', {'type': 'integer', 'minimum': 0, 'maximum': 1000000})
    assert rule == {'key': 'price', 'label': 'Price', 'type': 'integer', 'minimum': 0, 'maximum': 1000000}
    rule = build_field_rule('ratio', {'type': 'number', 'exclusiveMinimum': 0, 'exclusiveMaximum': 1})
    assert rule['exclusiveMinimum'] == 0 and rule['exclusiveMaximum'] == 1
    rule = build_field_rule('status', {'type': 'string', 'enum': ['open', 'closed']})
    assert rule['enum'] == ['open', 'closed']
    rule = build_field_rule('code', {'type': 'string', 'minLength': 1, 'pattern': '^[A-Z]+$'})
    assert rule['minLength'] == 1 and rule['pattern'] == '^[A-Z]+$'
    assert build_field_rule('site', {'type': 'string', 'format': 'uri'})['format'] == 'uri'
    assert build_field_rule('mail', {'type': 'string', 'format': 'email'})['format'] == 'email'
    # String bounds are not applied to numbers and the other way round.
    assert 'minLength' not in build_field_rule('n', {'type': 'integer', 'minLength': 3})
    assert 'minimum' not in build_field_rule('s', {'type': 'string', 'minimum': 3})


def test_fields_with_their_own_check_or_no_scalar_type_get_no_rule():
    assert build_field_rule('amount', {'type': 'string', '_prisma_decimal_type': 'Decimal'}) is None
    for fmt in ('date', 'date-time', 'time'):
        assert build_field_rule('d', {'type': 'string', 'format': fmt}) is None
    assert build_field_rule('items', {'type': 'array'}) is None
    assert build_field_rule('rel', {'$ref': '#/definitions/x'}) is None


def test_foreign_key_pattern_is_not_enforced():
    rule = build_field_rule('policy_id', {
        'type': 'string', 'pattern': '^c[a-z0-9]{24,}$', 'x-relationship': {'target': 'policy'},
    })
    assert rule == {'key': 'policy_id', 'label': 'Policy', 'type': 'string'}


def _rendered_service_validation() -> str:
    schema = copy.deepcopy(_schema())
    props = schema['definitions']['ticket']['properties']
    props['priority'] = {'type': 'integer', 'minimum': 1, 'maximum': 5}
    props['state'] = {'type': 'string', 'enum': ['open', 'closed']}
    ctx = build_context(_entity_meta(), schema)
    return _make_env().get_template('service_validation.ts.jinja2').render(**{**ctx, **build_validation_context(ctx)})


def test_service_validation_lists_the_rules_and_rejects_violations():
    src = _rendered_service_validation()
    assert "import { fieldRuleViolation, type FieldRule } from '@/lib/_field_rules';" in src
    rules_block = src.split('const FIELD_RULES: FieldRule[] = [')[1].split('] ;')[0]
    rules = {r['key']: r for r in (json.loads(line.strip().rstrip(',')) for line in rules_block.strip().splitlines())}
    assert rules['priority'] == {'key': 'priority', 'label': 'Priority', 'type': 'integer', 'minimum': 1, 'maximum': 5}
    assert rules['state']['enum'] == ['open', 'closed']
    assert 'id' not in rules
    loop = src.split('for (const rule of FIELD_RULES)')[1][:300]
    assert 'fieldRuleViolation(rule, data[rule.key])' in loop
    assert "throw new AppError('VALIDATION', violation, rule.key, 'invalid')" in loop
    body = src.split('async function validateSchemaRules')[1]
    assert body.index('FIELD_RULES') < body.index('validateCustomRules')


def test_no_zod_dependency_is_needed():
    assert not re.search(r"from ['\"]zod['\"]", _rendered_service_validation())
