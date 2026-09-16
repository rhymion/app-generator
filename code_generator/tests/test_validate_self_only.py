"""x-self-only schema rules: an entity declaring x-self-only ("only the
record's creator can access it" is a permission-independent invariant)
must have a creator_id column on its underlying Prisma model to filter on,
and must never let CSV import set creator_id directly (it is always
stamped from the session).

The two checks live in different functions because they need different
inputs: the import-key check is pure JSON-schema (validate_schema()), while
the creator_id-column check needs the real Prisma schema text
(validate_self_only_creator_id_columns()) — creator_id is boilerplate added
directly to schema.prisma for every generated model and is never listed
under a definition's 'properties' in the JSON schema (see
schema_deriver.py's derive_raw_entity), so it can't be checked from the
JSON schema alone.

Each violation below is paired with the corresponding valid shape to prove
the rule actually discriminates: the violating schema must fail with the
specific error, and the same schema with the violation removed must pass.
"""
import pytest
from validate import (
    validate_schema, validate_self_only_creator_id_columns, SchemaValidationError,
)


def _widget_props():
    return {
        'id': {'type': 'string', 'pattern': '^c[a-z0-9]{24,}$'},
        'code': {'type': 'string'},
    }


class TestMissingCreatorIdColumn:
    """x-self-only entity whose underlying Prisma model has no creator_id
    column has nothing to filter on."""

    _PRISMA_WITHOUT_CREATOR_ID = """
model widget {
  id   String @id @default(cuid())
  code String
}
"""

    _PRISMA_WITH_CREATOR_ID = """
model widget {
  id         String @id @default(cuid())
  code       String
  creator_id String
  @@index([creator_id])
}
"""

    def test_shorthand_missing_creator_id_errors(self, tmp_path):
        schema = {
            'definitions': {
                '__widget': {
                    'type': 'object',
                    'x-self-only': True,
                    'properties': _widget_props(),
                },
            }
        }
        prisma_path = tmp_path / 'schema.prisma'
        prisma_path.write_text(self._PRISMA_WITHOUT_CREATOR_ID)
        with pytest.raises(SchemaValidationError, match='requires the underlying Prisma model'):
            validate_self_only_creator_id_columns(schema, prisma_path)

    def test_dict_form_missing_creator_id_errors(self, tmp_path):
        schema = {
            'definitions': {
                '__widget': {
                    'type': 'object',
                    'x-self-only': {'admin_bypass': True},
                    'properties': _widget_props(),
                },
            }
        }
        prisma_path = tmp_path / 'schema.prisma'
        prisma_path.write_text(self._PRISMA_WITHOUT_CREATOR_ID)
        with pytest.raises(SchemaValidationError, match='requires the underlying Prisma model'):
            validate_self_only_creator_id_columns(schema, prisma_path)

    def test_with_creator_id_present_passes(self, tmp_path):
        """Same schema, violation removed (Prisma model has creator_id) —
        must validate cleanly."""
        schema = {
            'definitions': {
                '__widget': {
                    'type': 'object',
                    'x-self-only': True,
                    'properties': _widget_props(),
                },
            }
        }
        prisma_path = tmp_path / 'schema.prisma'
        prisma_path.write_text(self._PRISMA_WITH_CREATOR_ID)
        validate_self_only_creator_id_columns(schema, prisma_path)  # must not raise

    def test_non_self_only_entity_never_checked(self, tmp_path):
        """Entities without x-self-only are out of scope — a missing
        creator_id column is fine for an ordinary entity."""
        schema = {
            'definitions': {
                '__widget': {
                    'type': 'object',
                    'properties': _widget_props(),
                },
            }
        }
        prisma_path = tmp_path / 'schema.prisma'
        prisma_path.write_text(self._PRISMA_WITHOUT_CREATOR_ID)
        validate_self_only_creator_id_columns(schema, prisma_path)  # must not raise

    def test_missing_prisma_schema_file_errors(self, tmp_path):
        schema = {'definitions': {}}
        missing_path = tmp_path / 'does_not_exist.prisma'
        with pytest.raises(SchemaValidationError, match='Prisma schema not found'):
            validate_self_only_creator_id_columns(schema, missing_path)

    def test_pass_through_proxy_view_checks_the_real_backing_model(self, tmp_path):
        """A pass-through proxy view (like `setting`, whose allOf resolves
        through an intermediate view to a raw entity backed by a
        differently-named Prisma model) must be checked against the model
        it actually resolves to, not a nonexistent model matching its own
        entity name. Without _resolve_backing_model_name walking the allOf
        chain, this would look for a `proxy_view` Prisma model (which does
        not exist) and false-positive an error even though the real backing
        model (`real_model`) does have creator_id.
        """
        schema = {
            'definitions': {
                'proxy_view': {
                    'type': 'object',
                    'x-self-only': {'admin_bypass': True},
                    'allOf': [{'$ref': '#/definitions/real_model_view'}],
                },
                'real_model_view': {
                    'type': 'object',
                    'allOf': [{'$ref': '#/definitions/__real_model'}],
                },
                '__real_model': {
                    'type': 'object',
                    'properties': _widget_props(),
                },
            }
        }
        prisma_path = tmp_path / 'schema.prisma'
        prisma_path.write_text("""
model real_model {
  id         String @id @default(cuid())
  code       String
  creator_id String
  @@index([creator_id])
}
""")
        validate_self_only_creator_id_columns(schema, prisma_path)  # must not raise

    def test_pass_through_proxy_view_missing_creator_id_on_real_model_errors(self, tmp_path):
        """Same shape as above, but the real backing model lacks
        creator_id — must still be caught (proves the chain-walk finds the
        real model rather than silently skipping the check)."""
        schema = {
            'definitions': {
                'proxy_view': {
                    'type': 'object',
                    'x-self-only': {'admin_bypass': True},
                    'allOf': [{'$ref': '#/definitions/real_model_view'}],
                },
                'real_model_view': {
                    'type': 'object',
                    'allOf': [{'$ref': '#/definitions/__real_model'}],
                },
                '__real_model': {
                    'type': 'object',
                    'properties': _widget_props(),
                },
            }
        }
        prisma_path = tmp_path / 'schema.prisma'
        prisma_path.write_text(self._PRISMA_WITHOUT_CREATOR_ID.replace('widget', 'real_model'))
        with pytest.raises(SchemaValidationError, match="Prisma model 'real_model'"):
            validate_self_only_creator_id_columns(schema, prisma_path)


class TestCreatorIdInImportKey:
    """creator_id must never be settable from user-supplied CSV input."""

    def test_creator_id_in_import_key_errors(self):
        schema = {
            'definitions': {
                'widget': {
                    'type': 'object',
                    'required': ['id', 'code'],
                    'x-self-only': True,
                    'x-import-key': ['creator_id'],
                    'properties': _widget_props(),
                },
            }
        }
        with pytest.raises(SchemaValidationError, match='cannot list .creator_id. in x-import-key'):
            validate_schema(schema)

    def test_import_key_without_creator_id_passes(self):
        """Same schema, violation removed (x-import-key uses 'code' instead of
        'creator_id') — must validate cleanly. widget_detail with new:true
        makes 'code' a legitimate import key under the separate
        E_IMPORT_KEY_NOT_ELIGIBLE rule — unrelated to the rule under test
        here, but required for the fixture to be import-eligible at all."""
        schema = {
            'definitions': {
                'widget': {
                    'type': 'object',
                    'required': ['id', 'code'],
                    'x-self-only': True,
                    'x-import-key': ['code'],
                    'properties': _widget_props(),
                },
                'widget_detail': {
                    'x-generate': {'list': True, 'view': True, 'new': True, 'edit': True, 'api': True},
                    'allOf': [{'$ref': '#/definitions/widget'}],
                },
            }
        }
        validate_schema(schema)  # must not raise

    def test_no_x_self_only_import_key_creator_id_never_checked(self):
        """Entities without x-self-only are entirely out of scope for this
        check too — creator_id in x-import-key is only forbidden because
        x-self-only demands it always be session-stamped."""
        schema = {
            'definitions': {
                'widget': {
                    'type': 'object',
                    'required': ['id', 'code'],
                    'properties': _widget_props(),
                },
            }
        }
        validate_schema(schema)  # must not raise
