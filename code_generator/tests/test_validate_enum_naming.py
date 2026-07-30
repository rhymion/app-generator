"""Tests for nativeEnum member naming convention validation (cmd_493, Section 9 of validate_schema)."""
import pytest
from validate import validate_schema, SchemaValidationError


def _schema_with_enum(entity: str, prop: str, native_type: str, enum_values: list) -> dict:
    return {
        'definitions': {
            entity: {
                'properties': {
                    prop: {
                        'type': 'string',
                        '_prisma_native_enum_type': native_type,
                        'enum': enum_values,
                    },
                },
            },
        },
    }


class TestLowercaseSnakeCasePasses:
    def test_single_word_members_pass(self):
        schema = _schema_with_enum('room', 'status', 'RoomStatus', ['available', 'maintenance'])
        validate_schema(schema)  # must not raise

    def test_multi_word_snake_case_members_pass(self):
        schema = _schema_with_enum(
            'receiving_purchase_order', 'status', 'ReceivingPurchaseOrderStatus',
            ['draft', 'issued', 'partially_received', 'received', 'cancelled'],
        )
        validate_schema(schema)  # must not raise

    def test_int_enum_fields_are_out_of_scope(self):
        """type: integer enum labels are UI display text, not Prisma identifiers --
        this rule must not fire on them even when PascalCase."""
        schema = {
            'definitions': {
                'plan': {
                    'properties': {
                        'tier': {
                            'type': 'integer',
                            'enum': ['Free', 'Premium', 'VIP'],
                        },
                    },
                },
            },
        }
        validate_schema(schema)  # must not raise


class TestNonConformingMembersRejected:
    def test_pascal_case_member_rejected(self):
        schema = _schema_with_enum(
            'approval_request', 'status', 'ApprovalRequestStatus',
            ['pending', 'approved', 'rejected', 'TerminalRejected'],
        )
        with pytest.raises(SchemaValidationError) as exc_info:
            validate_schema(schema)
        msg = str(exc_info.value)
        assert 'TerminalRejected' in msg
        assert 'ApprovalRequestStatus' in msg
        assert 'approval_request' in msg

    def test_camel_case_member_rejected(self):
        schema = _schema_with_enum('reaction', 'type', 'ReactionType', ['like', 'terminalRejected'])
        with pytest.raises(SchemaValidationError) as exc_info:
            validate_schema(schema)
        assert 'terminalRejected' in str(exc_info.value)

    def test_uppercase_member_rejected(self):
        schema = _schema_with_enum('widget', 'mode', 'WidgetMode', ['ACTIVE', 'inactive'])
        with pytest.raises(SchemaValidationError) as exc_info:
            validate_schema(schema)
        assert 'ACTIVE' in str(exc_info.value)
