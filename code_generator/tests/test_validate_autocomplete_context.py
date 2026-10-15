"""validate_schema step 2e: x-autocomplete-context must name a field the
generated form keeps in React state, and must sit on a many-to-one FK.

A plain text/number control is held in a ref, so naming it made FormUpsert
emit `formValues: { name: name }` with no `name` variable declared. On a
one-to-one FK the key was accepted but the generated picker ignored it.
"""
import pytest
from validate import validate_schema, SchemaValidationError

_ID = {'type': 'string', 'pattern': '^c[a-z0-9]{24,}$'}


def _schema(ctx_target_type='many-to-one', ctx=('policy_id',), extra=None) -> dict:
    ticket_props = {
        'id': dict(_ID),
        'name': {'type': 'string'},
        'quantity': {'type': 'integer'},
        'amount': {'type': 'string', '_prisma_decimal_type': 'Decimal'},
        'homepage': {'type': 'string', 'format': 'uri'},
        'due_on': {'type': 'string', 'format': 'date'},
        'urgent': {'type': 'boolean'},
        'kind': {'type': 'string', 'enum': ['a', 'b']},
        'policy_id': {**_ID, 'x-relationship': {'type': 'many-to-one', 'target': 'policy', 'labelField': 'name'}},
        'assignee_id': {
            **_ID,
            'x-relationship': {'type': ctx_target_type, 'target': 'party', 'labelField': 'name'},
            'x-autocomplete-context': list(ctx),
        },
    }
    ticket_props.update(extra or {})
    return {
        'definitions': {
            'ticket': {'properties': ticket_props},
            'policy': {'properties': {'id': dict(_ID), 'name': {'type': 'string'}}},
            'party': {'properties': {'id': dict(_ID), 'name': {'type': 'string'}}},
        },
    }


@pytest.mark.parametrize('field', ['policy_id', 'due_on', 'urgent', 'kind'])
def test_state_held_context_field_accepted(field):
    validate_schema(_schema(ctx=(field,)))  # must not raise


@pytest.mark.parametrize('field', ['name', 'quantity', 'amount', 'homepage'])
def test_ref_held_context_field_rejected_naming_the_field(field):
    with pytest.raises(SchemaValidationError) as exc_info:
        validate_schema(_schema(ctx=(field,)))
    msg = str(exc_info.value)
    assert 'ticket' in msg and 'assignee_id' in msg
    assert f"'{field}'" in msg
    assert 'ref' in msg


def test_one_to_one_fk_with_context_rejected_naming_the_field():
    with pytest.raises(SchemaValidationError) as exc_info:
        validate_schema(_schema(ctx_target_type='one-to-one'))
    msg = str(exc_info.value)
    assert 'assignee_id' in msg
    assert 'many-to-one' in msg
