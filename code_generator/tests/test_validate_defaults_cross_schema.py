"""json_schema.yaml `default:` vs Prisma `@default(...)` cross-schema check.

The two schemas independently declare `default` values with no automatic
sync: json `fields.X.default:` and Prisma's `@default(...)` are hand-edited
separately. Before cmd_574, a json `default:` with no matching Prisma
`@default()` passed validate_schema() silently -- the UI looked like it had
a default, but nothing was actually written at the DB layer on create with
that field omitted (see proj_c `inventory.quantity` in the cmd_574 design
doc). validate_defaults_cross_schema() closes that gap by reading the real
Prisma schema text, the same way validate_self_only_creator_id_columns()
does. (cmd_574, 2026-08-05)
"""
import pytest
from validate import (
    validate_schema, validate_defaults_cross_schema, SchemaValidationError,
)

_FAKE_ENTITY_PROPS_MISMATCHED = {
    'id': {'type': 'string', 'pattern': '^c[a-z0-9]{24,}$'},
    'mismatched': {'type': 'string', 'default': 'orphan'},
}

_PRISMA_NO_DEFAULT = """
model fake_entity {
  id          String @id @default(cuid())
  mismatched  String
}
"""

_PRISMA_WITH_MATCHING_DEFAULT = """
model fake_entity {
  id          String @id @default(cuid())
  mismatched  String @default("orphan")
}
"""

_PRISMA_PRISMA_ONLY_DEFAULT = """
model fake_entity {
  id          String @id @default(cuid())
  mismatched  String @default("prisma_side_only")
}
"""


def _schema_with_mismatched_default():
    return {
        'definitions': {
            '__fake_entity': {
                'type': 'object',
                'properties': _FAKE_ENTITY_PROPS_MISMATCHED,
            },
        }
    }


class TestDefaultsCrossSchema:
    def test_a1_silent_pass_before_the_fix_is_reproduced_by_validate_schema_alone(self):
        """A-1: validate_schema() alone (the pre-cmd_574 gate) does not know
        about Prisma defaults at all -- it passes a json-only default
        silently. This is not a bug in validate_schema() (it's pure-JSON,
        by design); it's the proof that the gap validate_defaults_cross_schema()
        closes was real and unguarded prior to this check existing."""
        schema = _schema_with_mismatched_default()
        validate_schema(schema)  # must not raise -- proves the pre-existing gap

    def test_a2_cross_schema_check_catches_the_same_mismatch(self, tmp_path):
        """A-2: the same injection, now checked by
        validate_defaults_cross_schema() against a Prisma schema with no
        @default() for the field -- must raise."""
        schema = _schema_with_mismatched_default()
        prisma_path = tmp_path / 'schema.prisma'
        prisma_path.write_text(_PRISMA_NO_DEFAULT)
        with pytest.raises(SchemaValidationError, match='mismatched'):
            validate_defaults_cross_schema(schema, prisma_path)

    def test_a3_matching_default_on_both_sides_passes(self, tmp_path):
        """A-3: json declares default and Prisma has a matching @default()
        -- normal, in-sync case, must pass."""
        schema = _schema_with_mismatched_default()
        prisma_path = tmp_path / 'schema.prisma'
        prisma_path.write_text(_PRISMA_WITH_MATCHING_DEFAULT)
        validate_defaults_cross_schema(schema, prisma_path)  # must not raise

    def test_a4_prisma_only_default_passes(self, tmp_path):
        """A-4: reverse direction -- Prisma has @default() but json has no
        default: for the field. A valid Category C decision (don't
        auto-fill the UI field), not an error."""
        schema = {
            'definitions': {
                '__fake_entity': {
                    'type': 'object',
                    'properties': {
                        'id': {'type': 'string', 'pattern': '^c[a-z0-9]{24,}$'},
                        'mismatched': {'type': 'string'},  # no default: here
                    },
                },
            }
        }
        prisma_path = tmp_path / 'schema.prisma'
        prisma_path.write_text(_PRISMA_PRISMA_ONLY_DEFAULT)
        validate_defaults_cross_schema(schema, prisma_path)  # must not raise

    def test_missing_prisma_schema_file_errors(self, tmp_path):
        schema = {'definitions': {}}
        missing_path = tmp_path / 'does_not_exist.prisma'
        with pytest.raises(SchemaValidationError, match='Prisma schema not found'):
            validate_defaults_cross_schema(schema, missing_path)

    def test_entity_with_no_backing_prisma_model_is_skipped(self, tmp_path):
        """An entity name that doesn't resolve to any Prisma model at all
        (e.g. a schema-only construct) is out of scope -- nothing to cross
        check against."""
        schema = {
            'definitions': {
                '__no_such_model': {
                    'type': 'object',
                    'properties': _FAKE_ENTITY_PROPS_MISMATCHED,
                },
            }
        }
        prisma_path = tmp_path / 'schema.prisma'
        prisma_path.write_text(_PRISMA_NO_DEFAULT)  # defines fake_entity, not no_such_model
        validate_defaults_cross_schema(schema, prisma_path)  # must not raise

    def test_paired_entity_view_and_raw_default_reported_exactly_once(self, tmp_path):
        """A paired entity's view (allOf: [{$ref: __x}, {...}]) merges the
        raw entity's properties by reference -- the same mismatched default
        must be reported exactly once (from the raw definition), not once
        per definition key that resolves to the same Prisma column."""
        schema = {
            'definitions': {
                'fake_entity': {
                    'type': 'object',
                    'x-generate': {'list': True},
                    'allOf': [
                        {'$ref': '#/definitions/__fake_entity'},
                        {'type': 'object', 'required': [], 'properties': {}},
                    ],
                },
                '__fake_entity': {
                    'type': 'object',
                    'properties': _FAKE_ENTITY_PROPS_MISMATCHED,
                },
            }
        }
        prisma_path = tmp_path / 'schema.prisma'
        prisma_path.write_text(_PRISMA_NO_DEFAULT)
        with pytest.raises(SchemaValidationError) as exc_info:
            validate_defaults_cross_schema(schema, prisma_path)
        assert str(exc_info.value).count('mismatched') == 1
