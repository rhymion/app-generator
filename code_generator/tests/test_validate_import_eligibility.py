"""cmd_426: E_IMPORT_KEY_NOT_ELIGIBLE — a base entity that declares
x-import-key with the import route left on (x-generate.import: true, the
default) must actually be reachable as a primary, create-or-edit-able
entity. Otherwise x-import-key advertises an import path that
build_context.py's import_eligible gate (cmd_328/330) silently disables,
with no diagnostic telling the schema author why.

Structural rule under test (no entity names hardcoded in validate.py):
    has_import_key AND import_flag(default True) AND
    NOT(is_primary_entity AND (can_create OR can_update))

The sanctioned escape hatch — keep x-import-key for export / dotted-FK
natural-key-target purposes while opting out of the entity's own import
route — is x-generate.import: false (documented at the top of
json_schema.yaml). That case must NOT error.
"""
import pytest
from validate import validate_schema, SchemaValidationError


def _fk_field(target, nullable=False, label='name'):
    t = ['string', 'null'] if nullable else 'string'
    return {
        'type': t,
        'pattern': '^c[a-z0-9]{24,}$',
        'x-relationship': {'type': 'many-to-one', 'target': target, 'labelField': label},
    }


class TestNeverGeneratedAsPrimary:
    """x-import-key declared on a model that has no *_detail (or own)
    x-generate block at all — it is never a create/edit-able entity."""

    def test_no_detail_definition_errors(self):
        schema = {
            'definitions': {
                'widget': {
                    'type': 'object',
                    'required': ['id', 'code'],
                    'x-import-key': ['code'],
                    'properties': {
                        'id': {'type': 'string', 'pattern': '^c[a-z0-9]{24,}$'},
                        'code': {'type': 'string'},
                    },
                },
            }
        }
        with pytest.raises(SchemaValidationError, match='E_IMPORT_KEY_NOT_ELIGIBLE'):
            validate_schema(schema)


class TestAliasEntityNotPrimary:
    """A model referenced only through an alias entity (parent != model, e.g.
    'setting' -> 'user' in the real schema) is never import-eligible even
    though the alias itself carries x-generate with new/edit enabled — the
    x-import-key lives on the BASE model, whose own primary form (if any)
    is what matters."""

    def test_alias_only_entity_errors(self):
        schema = {
            'definitions': {
                'widget': {
                    'type': 'object',
                    'required': ['id', 'code'],
                    'x-import-key': ['code'],
                    'properties': {
                        'id': {'type': 'string', 'pattern': '^c[a-z0-9]{24,}$'},
                        'code': {'type': 'string'},
                    },
                },
                # Alias: its own x-generate has new/edit true, but it targets
                # model 'widget' via allOf — parent ('widget_alias') != model
                # ('widget'), so it can never satisfy is_primary_entity.
                'widget_alias': {
                    'x-generate': {'list': True, 'view': True, 'new': True, 'edit': True, 'api': True},
                    'allOf': [
                        {'$ref': '#/definitions/widget'},
                        {'type': 'object', 'properties': {}},
                    ],
                },
            }
        }
        with pytest.raises(SchemaValidationError, match='E_IMPORT_KEY_NOT_ELIGIBLE'):
            validate_schema(schema)


class TestPrimaryButNoCreateOrEdit:
    """Primary _detail entity exists, but both new and edit are disabled —
    there is no route to receive an imported row."""

    def test_new_and_edit_both_false_errors(self):
        schema = {
            'definitions': {
                'widget': {
                    'type': 'object',
                    'required': ['id', 'code'],
                    'x-import-key': ['code'],
                    'properties': {
                        'id': {'type': 'string', 'pattern': '^c[a-z0-9]{24,}$'},
                        'code': {'type': 'string'},
                    },
                },
                'widget_detail': {
                    'x-generate': {'list': True, 'view': True, 'new': False, 'edit': False, 'api': True},
                    'allOf': [{'$ref': '#/definitions/widget'}],
                },
            }
        }
        with pytest.raises(SchemaValidationError, match='E_IMPORT_KEY_NOT_ELIGIBLE'):
            validate_schema(schema)


class TestSanctionedImportFalseOptOut:
    """x-generate.import: false is the documented, sanctioned way to keep
    x-import-key for export/dotted-FK-target purposes while suppressing the
    entity's own import route — must NOT error, even when new/edit are also
    both false."""

    def test_import_false_with_new_and_edit_false_passes(self):
        schema = {
            'definitions': {
                'widget': {
                    'type': 'object',
                    'required': ['id', 'code'],
                    'x-import-key': ['code'],
                    'properties': {
                        'id': {'type': 'string', 'pattern': '^c[a-z0-9]{24,}$'},
                        'code': {'type': 'string'},
                    },
                },
                'widget_detail': {
                    'x-generate': {
                        'list': True, 'view': True, 'new': False, 'edit': False,
                        'api': True, 'import': False,
                    },
                    'allOf': [{'$ref': '#/definitions/widget'}],
                },
            }
        }
        validate_schema(schema)  # must not raise

    def test_import_false_with_no_detail_at_all_passes(self):
        """Never-generated model with x-import-key but import explicitly off
        — e.g. kept solely as a dotted-FK natural-key target. Not this task's
        scope to require x-generate to exist just to carry import:false, so
        the absence-of-primary branch must also respect an explicit
        import:false wherever it's declared."""
        schema = {
            'definitions': {
                'widget': {
                    'type': 'object',
                    'required': ['id', 'code'],
                    'x-import-key': ['code'],
                    'x-generate': {'import': False, 'new': False, 'edit': False},
                    'properties': {
                        'id': {'type': 'string', 'pattern': '^c[a-z0-9]{24,}$'},
                        'code': {'type': 'string'},
                    },
                },
            }
        }
        validate_schema(schema)  # must not raise


class TestLegitimateImportEligiblePasses:
    """The common, real-schema shape (e.g. user/role/organization/permission/
    approval_flow/receiving_receipt) — primary _detail entity, new or edit
    true, import left at its default — must validate cleanly."""

    def test_new_true_edit_false_passes(self):
        schema = {
            'definitions': {
                'widget': {
                    'type': 'object',
                    'required': ['id', 'code'],
                    'x-import-key': ['code'],
                    'properties': {
                        'id': {'type': 'string', 'pattern': '^c[a-z0-9]{24,}$'},
                        'code': {'type': 'string'},
                    },
                },
                'widget_detail': {
                    'x-generate': {'list': True, 'view': True, 'new': True, 'edit': False, 'api': True},
                    'allOf': [{'$ref': '#/definitions/widget'}],
                },
            }
        }
        validate_schema(schema)  # must not raise

    def test_new_false_edit_true_passes(self):
        schema = {
            'definitions': {
                'widget': {
                    'type': 'object',
                    'required': ['id', 'code'],
                    'x-import-key': ['code'],
                    'properties': {
                        'id': {'type': 'string', 'pattern': '^c[a-z0-9]{24,}$'},
                        'code': {'type': 'string'},
                    },
                },
                'widget_detail': {
                    'x-generate': {'list': True, 'view': True, 'new': False, 'edit': True, 'api': True},
                    'allOf': [{'$ref': '#/definitions/widget'}],
                },
            }
        }
        validate_schema(schema)  # must not raise

    def test_no_import_key_never_checked(self):
        """Entities without x-import-key are entirely out of scope for this
        check, regardless of their new/edit/primary status."""
        schema = {
            'definitions': {
                'widget': {
                    'type': 'object',
                    'required': ['id', 'code'],
                    'properties': {
                        'id': {'type': 'string', 'pattern': '^c[a-z0-9]{24,}$'},
                        'code': {'type': 'string'},
                    },
                },
                'widget_detail': {
                    'x-generate': {'list': True, 'view': True, 'new': False, 'edit': False, 'api': True},
                    'allOf': [{'$ref': '#/definitions/widget'}],
                },
            }
        }
        validate_schema(schema)  # must not raise
