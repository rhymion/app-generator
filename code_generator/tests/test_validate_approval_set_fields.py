"""Tests for x-approval.{on_approved,on_rejected}.set_fields shape validation
(cmd_544, Section 10 of validate_schema).

_resolve_set_fields() (generate.py) iterates `raw.items()` -- only a mapping
works. Before this section existed, a list-of-{field, value} schema (the form
docs/knowledge/appendix/approval-flow.md §16.9 showed, in error) passed
validate_schema() silently and only failed later inside generate() with an
uninformative AttributeError naming neither the entity nor the field.
"""
import pytest
from validate import validate_schema, SchemaValidationError


def _schema_with_set_fields(entity: str, stage: str, set_fields) -> dict:
    return {
        'definitions': {
            entity: {
                'properties': {
                    'status': {'type': 'integer', 'enum': ['Pending', 'Approved']},
                },
                'x-approval': {
                    stage: {'set_fields': set_fields},
                },
            },
        },
    }


class TestMappingFormPasses:
    def test_on_approved_mapping_passes(self):
        schema = _schema_with_set_fields('purchase_order', 'on_approved', {'status': 'approved'})
        validate_schema(schema)  # must not raise

    def test_on_rejected_mapping_passes(self):
        schema = _schema_with_set_fields('receiving_receipt_line', 'on_rejected', {'status': 'rejected'})
        validate_schema(schema)  # must not raise

    def test_missing_set_fields_passes(self):
        schema = {
            'definitions': {
                'purchase_order': {
                    'properties': {},
                    'x-approval': {'on_approved': {'emit_hook': True}},
                },
            },
        }
        validate_schema(schema)  # must not raise -- set_fields is optional


class TestListFormRejected:
    def test_on_approved_list_form_rejected(self):
        schema = _schema_with_set_fields(
            'purchase_order', 'on_approved',
            [{'field': 'status', 'value': 'approved'}],
        )
        with pytest.raises(SchemaValidationError) as exc_info:
            validate_schema(schema)
        msg = str(exc_info.value)
        assert 'purchase_order' in msg
        assert 'on_approved.set_fields' in msg
        assert 'status' in msg
        assert 'mapping' in msg

    def test_on_rejected_list_form_rejected(self):
        schema = _schema_with_set_fields(
            'receiving_receipt_line', 'on_rejected',
            [{'field': 'status', 'value': 'rejected'}],
        )
        with pytest.raises(SchemaValidationError) as exc_info:
            validate_schema(schema)
        msg = str(exc_info.value)
        assert 'receiving_receipt_line' in msg
        assert 'on_rejected.set_fields' in msg

    def test_non_list_non_dict_form_rejected(self):
        schema = _schema_with_set_fields('purchase_order', 'on_approved', 'status')
        with pytest.raises(SchemaValidationError) as exc_info:
            validate_schema(schema)
        assert 'purchase_order' in str(exc_info.value)
