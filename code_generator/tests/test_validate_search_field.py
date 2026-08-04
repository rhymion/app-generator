"""Tests for x-relationship.searchField retirement validation
(cmd_552, Section 14 of validate_schema).

searchField used to opt an FK into cross-relation substring search
independently of labelField, letting the two silently drift apart. cmd_552
retires it in favor of deriving search eligibility from labelField itself
(derive_searchable_relation_fields, schema_helpers.py). A schema that still
declares searchField must be rejected by name -- not silently ignored --
because a silently-ignored declaration leaves the schema author believing
search still works via the field they named, when it does not (cmd_552
karo_note, echoing the cmd_544 precedent for stale-config-with-no-effect).
"""
import pytest
from validate import validate_schema, SchemaValidationError


def _schema_with_relationship(entity: str, prop: str, rel: dict, target_entity: str = 'target') -> dict:
    return {
        'definitions': {
            entity: {
                'properties': {
                    prop: {'type': 'string', 'x-relationship': rel},
                },
            },
            target_entity: {
                'properties': {
                    'name': {'type': 'string'},
                },
            },
        },
    }


class TestSearchFieldDeviationRejected:
    def test_searchfield_alone_rejected(self):
        """Deviation injection: a schema declaring only the retired
        searchField key (no labelField) must fail validation, naming the
        entity and field."""
        schema = _schema_with_relationship(
            'goods_receipt_line', 'purchase_order_id',
            {'type': 'many-to-one', 'target': 'target', 'searchField': 'po_number'},
        )
        with pytest.raises(SchemaValidationError) as exc_info:
            validate_schema(schema)
        msg = str(exc_info.value)
        assert 'goods_receipt_line' in msg
        assert 'purchase_order_id' in msg
        assert 'searchField' in msg
        assert 'labelField' in msg

    def test_searchfield_alongside_labelfield_also_rejected(self):
        """Even when labelField is also present (the two happened to agree),
        the stale searchField key itself must still be named and rejected --
        it has no effect and its mere presence is what must be removed."""
        schema = _schema_with_relationship(
            'asn_line', 'asn_id',
            {'type': 'many-to-one', 'target': 'target', 'labelField': 'name', 'searchField': 'name'},
        )
        with pytest.raises(SchemaValidationError) as exc_info:
            validate_schema(schema)
        msg = str(exc_info.value)
        assert 'asn_line' in msg
        assert 'asn_id' in msg
        assert 'searchField' in msg


class TestLabelFieldOnlyPasses:
    def test_labelfield_without_searchfield_passes(self):
        schema = _schema_with_relationship(
            'goods_receipt_line', 'purchase_order_id',
            {'type': 'many-to-one', 'target': 'target', 'labelField': 'name'},
        )
        validate_schema(schema)  # must not raise

    def test_no_x_relationship_passes(self):
        schema = {
            'definitions': {
                'item': {'properties': {'sku': {'type': 'string'}}},
            },
        }
        validate_schema(schema)  # must not raise
