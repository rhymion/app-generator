"""DP-2a (cmd_394 §12) regression: x-import-key dotted-FK validation must
resolve the target entity via the FK property's x-relationship.target, not
by treating the dotted-key prefix as a literal entity name. Companion to the
same fix in build_context.py (see tests/test_build_context.py
TestImportKeySpecsAliasedFkLookup) — this covers the schema-validation gate
in validate.py (Section 10, IA-8), which blocks generate.py entirely on a
false-positive "entity not defined" error for aliased FK property names
(e.g. approver_role_id → target 'role').
"""
import pytest
from validate import validate_schema, SchemaValidationError


def _fk_field(target: str, nullable: bool = False, label: str = 'name') -> dict:
    t = ['string', 'null'] if nullable else 'string'
    return {
        'type': t,
        'pattern': '^c[a-z0-9]{24,}$',
        'x-relationship': {'type': 'many-to-one', 'target': target, 'labelField': label},
    }


def _schema_with_aliased_fk_import_key(import_key):
    return {
        'definitions': {
            'role': {
                'type': 'object',
                'required': ['id', 'name'],
                'properties': {
                    'id': {'type': 'string', 'pattern': '^c[a-z0-9]{24,}$'},
                    'name': {'type': 'string'},
                },
            },
            'approval_flow': {
                'type': 'object',
                'required': ['id', 'entity_name', 'approver_role_id'],
                'x-import-key': import_key,
                'x-display': {'table': [{'entity_name': {'primary': True}}]},
                'properties': {
                    'id': {'type': 'string', 'pattern': '^c[a-z0-9]{24,}$'},
                    'entity_name': {'type': 'string'},
                    'approver_role_id': _fk_field('role'),
                    'requestor_role_id': _fk_field('role', nullable=True),
                },
            },
            'approval_flow_detail': {
                'x-generate': {'list': True, 'view': True, 'new': True, 'edit': True, 'api': True},
                'allOf': [{'$ref': '#/definitions/approval_flow'}],
            },
        }
    }


class TestAliasedDottedFkImportKeyPasses:
    """approver_role.name / requestor_role.name must validate cleanly — the FK
    property prefix ('approver_role') differs from the Prisma model it
    targets ('role'), and validation must resolve via x-relationship.target
    rather than requiring a (nonexistent) 'approver_role' top-level entity."""

    def test_single_aliased_dotted_key_passes(self):
        schema = _schema_with_aliased_fk_import_key(['entity_name', 'approver_role.name'])
        validate_schema(schema)  # must not raise

    def test_two_aliased_dotted_keys_to_same_target_passes(self):
        schema = _schema_with_aliased_fk_import_key(
            ['entity_name', 'approver_role.name', 'requestor_role.name']
        )
        validate_schema(schema)  # must not raise


class TestNonAliasedDottedFkImportKeyStillPasses:
    """Non-regression: prefix == target (e.g. role.name on a plain role_id FK)."""

    def test_non_aliased_dotted_key_still_passes(self):
        schema = {
            'definitions': {
                'role': {
                    'type': 'object',
                    'required': ['id', 'name'],
                    'properties': {
                        'id': {'type': 'string', 'pattern': '^c[a-z0-9]{24,}$'},
                        'name': {'type': 'string'},
                    },
                },
                'permission': {
                    'type': 'object',
                    'required': ['id', 'name', 'role_id'],
                    'x-import-key': ['name', 'role.name'],
                    'x-display': {'table': [{'name': {'primary': True}}]},
                    'properties': {
                        'id': {'type': 'string', 'pattern': '^c[a-z0-9]{24,}$'},
                        'name': {'type': 'string'},
                        'role_id': _fk_field('role'),
                    },
                },
                'permission_detail': {
                    'x-generate': {'list': True, 'view': True, 'new': True, 'edit': True, 'api': True},
                    'allOf': [{'$ref': '#/definitions/permission'}],
                },
            }
        }
        validate_schema(schema)  # must not raise


class TestGenuineImportKeyErrorsStillCaught:
    """The fix must not swallow real errors — a missing FK property or a
    target entity that truly doesn't exist must still fail validation."""

    def test_missing_fk_property_still_errors(self):
        schema = _schema_with_aliased_fk_import_key(['entity_name', 'nonexistent_prefix.name'])
        with pytest.raises(SchemaValidationError, match="expects a FK property 'nonexistent_prefix_id'"):
            validate_schema(schema)

    def test_target_entity_truly_undefined_still_errors(self):
        schema = _schema_with_aliased_fk_import_key(['entity_name', 'approver_role.name'])
        # Retarget the FK to an entity that really doesn't exist in the schema.
        schema['definitions']['approval_flow']['properties']['approver_role_id'] = _fk_field('ghost_entity')
        with pytest.raises(SchemaValidationError, match="resolves .* to entity 'ghost_entity' which is not defined"):
            validate_schema(schema)

    def test_target_field_missing_still_errors(self):
        schema = _schema_with_aliased_fk_import_key(['entity_name', 'approver_role.nonexistent_field'])
        with pytest.raises(SchemaValidationError, match="field 'nonexistent_field' does not exist on entity 'role'"):
            validate_schema(schema)
