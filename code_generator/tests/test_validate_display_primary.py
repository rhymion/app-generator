"""Tests for x-display list primary field required validation (Section 6 of validate_schema)."""
import pytest
from validate import validate_schema, SchemaValidationError


def _make_schema(extra_defs: dict) -> dict:
    """Wrap extra definitions in a minimal valid schema with a _detail sentinel."""
    return {'definitions': extra_defs}


def _entity_schema(model: str, props: dict, required: list, xdisplay: dict,
                   extra_defs: dict | None = None) -> dict:
    """Build a schema containing one entity with x-generate on its view."""
    defs: dict = {
        f'__{model}': {
            'type': 'object',
            'required': required,
            'properties': props,
            'x-display': xdisplay,
        },
        model: {
            'x-generate': {'list': True},
            'allOf': [{'$ref': f'#/definitions/__{model}'}],
        },
    }
    if extra_defs:
        defs.update(extra_defs)
    return {'definitions': defs}


# ---------------------------------------------------------------------------
# (a) positive: required scalar primary field — generation passes
# ---------------------------------------------------------------------------

class TestRequiredPrimaryFieldPasses:
    def test_required_scalar_primary_passes(self):
        schema = _entity_schema(
            model='product',
            props={
                'id': {'type': 'string'},
                'name': {'type': 'string'},
            },
            required=['id', 'name'],
            xdisplay={'table': [{'name': {'primary': True}}]},
        )
        validate_schema(schema)  # must not raise

    def test_required_fk_primary_with_required_label_passes(self):
        schema = _entity_schema(
            model='order',
            props={
                'id': {'type': 'string'},
                'customer_id': {
                    'type': 'string',
                    'x-relationship': {
                        'type': 'many-to-one',
                        'target': 'customer',
                        'labelField': 'name',
                    },
                },
            },
            required=['id', 'customer_id'],
            xdisplay={'table': [{'customer': {'primary': True}}]},
            extra_defs={
                'customer': {
                    'type': 'object',
                    'required': ['id', 'name'],
                    'properties': {
                        'id': {'type': 'string'},
                        'name': {'type': 'string'},
                    },
                },
            },
        )
        validate_schema(schema)  # must not raise

    def test_no_primary_column_skips_validation(self):
        """Entity with x-display.table but no primary: true — no error raised."""
        schema = _entity_schema(
            model='product',
            props={
                'id': {'type': 'string'},
                'code': {'type': ['string', 'null']},
            },
            required=['id'],
            xdisplay={'table': [{'code': {'width': 100}}]},
        )
        validate_schema(schema)  # must not raise

    def test_list_labelfield_all_required_passes(self):
        """Multiple labelField paths where all final fields are required."""
        schema = _entity_schema(
            model='order',
            props={
                'id': {'type': 'string'},
                'customer_id': {
                    'type': 'string',
                    'x-relationship': {
                        'type': 'many-to-one',
                        'target': 'customer',
                        'labelField': ['name', 'code'],
                    },
                },
            },
            required=['id', 'customer_id'],
            xdisplay={'table': [{'customer': {'primary': True}}]},
            extra_defs={
                'customer': {
                    'type': 'object',
                    'required': ['id', 'name', 'code'],
                    'properties': {
                        'id': {'type': 'string'},
                        'name': {'type': 'string'},
                        'code': {'type': 'string'},
                    },
                },
            },
        )
        validate_schema(schema)  # must not raise


# ---------------------------------------------------------------------------
# (b) negative: optional primary field → rejected
# ---------------------------------------------------------------------------

class TestOptionalPrimaryFieldRejected:
    def test_nullable_scalar_primary_rejected(self):
        """Scalar primary field with nullable type raises SchemaValidationError."""
        schema = _entity_schema(
            model='product',
            props={
                'id': {'type': 'string'},
                'name': {'type': ['string', 'null']},
            },
            required=['id', 'name'],
            xdisplay={'table': [{'name': {'primary': True}}]},
        )
        with pytest.raises(SchemaValidationError, match="list primary field 'name'"):
            validate_schema(schema)

    def test_non_required_scalar_primary_rejected(self):
        """Scalar primary field absent from required list raises SchemaValidationError."""
        schema = _entity_schema(
            model='product',
            props={
                'id': {'type': 'string'},
                'name': {'type': 'string'},
            },
            required=['id'],  # 'name' not in required
            xdisplay={'table': [{'name': {'primary': True}}]},
        )
        with pytest.raises(SchemaValidationError, match="list primary field 'name'"):
            validate_schema(schema)

    def test_optional_fk_primary_rejected(self):
        """FK primary field where the FK prop is optional (nullable) raises."""
        schema = _entity_schema(
            model='order',
            props={
                'id': {'type': 'string'},
                'customer_id': {
                    'type': ['string', 'null'],   # nullable FK
                    'x-relationship': {
                        'type': 'many-to-one',
                        'target': 'customer',
                        'labelField': 'name',
                    },
                },
            },
            required=['id', 'customer_id'],
            xdisplay={'table': [{'customer': {'primary': True}}]},
            extra_defs={
                'customer': {
                    'type': 'object',
                    'required': ['id', 'name'],
                    'properties': {
                        'id': {'type': 'string'},
                        'name': {'type': 'string'},
                    },
                },
            },
        )
        with pytest.raises(SchemaValidationError, match="list primary field 'customer'"):
            validate_schema(schema)

    def test_non_required_fk_primary_rejected(self):
        """FK primary field where the FK prop is not in required list raises."""
        schema = _entity_schema(
            model='order',
            props={
                'id': {'type': 'string'},
                'customer_id': {
                    'type': 'string',
                    'x-relationship': {
                        'type': 'many-to-one',
                        'target': 'customer',
                        'labelField': 'name',
                    },
                },
            },
            required=['id'],  # customer_id NOT required
            xdisplay={'table': [{'customer': {'primary': True}}]},
            extra_defs={
                'customer': {
                    'type': 'object',
                    'required': ['id', 'name'],
                    'properties': {
                        'id': {'type': 'string'},
                        'name': {'type': 'string'},
                    },
                },
            },
        )
        with pytest.raises(SchemaValidationError, match="list primary field 'customer'"):
            validate_schema(schema)


# ---------------------------------------------------------------------------
# (c) negative: labelField reference is optional → rejected
# ---------------------------------------------------------------------------

class TestLabelFieldTargetOptionalRejected:
    def test_nullable_labelfield_target_rejected(self):
        """labelField final field is nullable on the target entity — raises."""
        schema = _entity_schema(
            model='order',
            props={
                'id': {'type': 'string'},
                'customer_id': {
                    'type': 'string',
                    'x-relationship': {
                        'type': 'many-to-one',
                        'target': 'customer',
                        'labelField': 'name',
                    },
                },
            },
            required=['id', 'customer_id'],
            xdisplay={'table': [{'customer': {'primary': True}}]},
            extra_defs={
                'customer': {
                    'type': 'object',
                    'required': ['id', 'name'],
                    'properties': {
                        'id': {'type': 'string'},
                        'name': {'type': ['string', 'null']},  # nullable
                    },
                },
            },
        )
        with pytest.raises(SchemaValidationError, match="labelField path 'name'"):
            validate_schema(schema)

    def test_non_required_labelfield_target_rejected(self):
        """labelField final field not in required list on the target entity — raises."""
        schema = _entity_schema(
            model='order',
            props={
                'id': {'type': 'string'},
                'customer_id': {
                    'type': 'string',
                    'x-relationship': {
                        'type': 'many-to-one',
                        'target': 'customer',
                        'labelField': 'name',
                    },
                },
            },
            required=['id', 'customer_id'],
            xdisplay={'table': [{'customer': {'primary': True}}]},
            extra_defs={
                'customer': {
                    'type': 'object',
                    'required': ['id'],  # 'name' not in required
                    'properties': {
                        'id': {'type': 'string'},
                        'name': {'type': 'string'},
                    },
                },
            },
        )
        with pytest.raises(SchemaValidationError, match="labelField path 'name'"):
            validate_schema(schema)

    def test_dotted_labelfield_target_optional_rejected(self):
        """labelField dotted path where final field is optional on the walked entity."""
        schema = _entity_schema(
            model='lifestyle',
            props={
                'id': {'type': 'string'},
                'checkup_id': {
                    'type': 'string',
                    'x-relationship': {
                        'type': 'many-to-one',
                        'target': 'checkup',
                        'labelField': 'patient_rel.name',
                    },
                },
            },
            required=['id', 'checkup_id'],
            xdisplay={'table': [{'checkup': {'primary': True}}]},
            extra_defs={
                'checkup': {
                    'type': 'object',
                    'required': ['id'],
                    'properties': {
                        'id': {'type': 'string'},
                        'patient_rel_id': {
                            'type': 'string',
                            'x-relationship': {
                                'type': 'many-to-one',
                                'target': 'patient_rel',
                            },
                        },
                    },
                },
                'patient_rel': {
                    'type': 'object',
                    'required': ['id'],  # 'name' NOT required
                    'properties': {
                        'id': {'type': 'string'},
                        'name': {'type': 'string'},
                    },
                },
            },
        )
        with pytest.raises(SchemaValidationError, match="labelField path 'patient_rel.name'"):
            validate_schema(schema)


# ---------------------------------------------------------------------------
# (d) multiple labelField — all paths validated
# ---------------------------------------------------------------------------

class TestMultipleLabelFieldHandling:
    def test_multiple_labelfield_all_required_passes(self):
        """List-form labelField where all paths resolve to required fields — no error."""
        schema = _entity_schema(
            model='order',
            props={
                'id': {'type': 'string'},
                'customer_id': {
                    'type': 'string',
                    'x-relationship': {
                        'type': 'many-to-one',
                        'target': 'customer',
                        'labelField': ['name', 'code'],
                    },
                },
            },
            required=['id', 'customer_id'],
            xdisplay={'table': [{'customer': {'primary': True}}]},
            extra_defs={
                'customer': {
                    'type': 'object',
                    'required': ['id', 'name', 'code'],
                    'properties': {
                        'id': {'type': 'string'},
                        'name': {'type': 'string'},
                        'code': {'type': 'string'},
                    },
                },
            },
        )
        validate_schema(schema)  # must not raise

    def test_multiple_labelfield_second_optional_rejected(self):
        """List-form labelField where the second path's field is optional — raises."""
        schema = _entity_schema(
            model='order',
            props={
                'id': {'type': 'string'},
                'customer_id': {
                    'type': 'string',
                    'x-relationship': {
                        'type': 'many-to-one',
                        'target': 'customer',
                        'labelField': ['name', 'code'],
                    },
                },
            },
            required=['id', 'customer_id'],
            xdisplay={'table': [{'customer': {'primary': True}}]},
            extra_defs={
                'customer': {
                    'type': 'object',
                    'required': ['id', 'name'],  # 'code' NOT required
                    'properties': {
                        'id': {'type': 'string'},
                        'name': {'type': 'string'},
                        'code': {'type': 'string'},
                    },
                },
            },
        )
        with pytest.raises(SchemaValidationError, match="labelField path 'code'"):
            validate_schema(schema)

    def test_multiple_labelfield_first_optional_rejected(self):
        """List-form labelField where the first path's field is optional — raises."""
        schema = _entity_schema(
            model='order',
            props={
                'id': {'type': 'string'},
                'customer_id': {
                    'type': 'string',
                    'x-relationship': {
                        'type': 'many-to-one',
                        'target': 'customer',
                        'labelField': ['name', 'code'],
                    },
                },
            },
            required=['id', 'customer_id'],
            xdisplay={'table': [{'customer': {'primary': True}}]},
            extra_defs={
                'customer': {
                    'type': 'object',
                    'required': ['id', 'code'],  # 'name' NOT required
                    'properties': {
                        'id': {'type': 'string'},
                        'name': {'type': 'string'},
                        'code': {'type': 'string'},
                    },
                },
            },
        )
        with pytest.raises(SchemaValidationError, match="labelField path 'name'"):
            validate_schema(schema)


# ---------------------------------------------------------------------------
# (e) non-primary column with table-level labelField — FK optionality detected
# ---------------------------------------------------------------------------

class TestNonPrimaryLabelFieldColumnValidation:
    def test_non_primary_optional_fk_with_label_field_passes(self):
        """Non-primary table column with labelField and optional FK — must NOT raise.

        Mirrors room_reservation.room: the column has labelField in x-display.table
        config but the FK (room_id) is nullable. Only primary fields are validated;
        non-primary columns with optional FK are allowed.
        """
        schema = _entity_schema(
            model='room_reservation',
            props={
                'id': {'type': 'string'},
                'room_type_id': {
                    'type': 'string',
                    'x-relationship': {
                        'type': 'many-to-one',
                        'target': 'room_type',
                        'labelField': 'name',
                    },
                },
                'room_id': {
                    'type': ['string', 'null'],  # nullable — non-primary, allowed
                    'x-relationship': {
                        'type': 'many-to-one',
                        'target': 'room',
                        'labelField': 'room_no',
                    },
                },
            },
            required=['id', 'room_type_id'],  # room_id intentionally absent
            xdisplay={
                'table': [
                    {'room_type': {'primary': True, 'width': 200}},
                    {'room': {'width': 200, 'labelField': 'room_id.room_no'}},
                ]
            },
            extra_defs={
                'room_type': {
                    'type': 'object',
                    'required': ['id', 'name'],
                    'properties': {
                        'id': {'type': 'string'},
                        'name': {'type': 'string'},
                    },
                },
                'room': {
                    'type': 'object',
                    'required': ['id', 'room_no'],
                    'properties': {
                        'id': {'type': 'string'},
                        'room_no': {'type': 'string'},
                    },
                },
            },
        )
        validate_schema(schema)  # must not raise
