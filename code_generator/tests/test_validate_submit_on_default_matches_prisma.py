"""x-approval.submit_on field: json_schema.yaml `default:` vs Prisma
`@default(...)` VALUE cross-check.

validate_defaults_cross_schema() (cmd_574) only catches a json `default:`
with NO matching Prisma `@default()` at all -- pure presence. It does not
compare the actual *values* when both sides declare a default, so a json
`default: draft` next to a Prisma `@default(pending)` passes it silently:
both "have" a default. That silent pass is exactly what let
goods_receipt_line.status (and inventory_reservation.status) drift for 5
days after commit `900ce04` -- the json schema's declared `draft` and
Prisma's real column default (`pending`, unchanged from before that
commit) disagreed, and nothing caught it: newly created rows landed
straight into `LOCKED_STATUS_VALUES` (edit_guard.ts, generators.py
approval_lockdown_context()) as soon as `x-approval.submit_on` was added
(cmd_1016/cmd_1017).

validate_submit_on_default_matches_prisma() closes that value-level gap,
scoped narrowly to x-approval.submit_on fields only (cmd_1017-d): a plain
value mismatch outside x-approval is not inherently wrong (Category A/C,
schema_deriver.py), so this check must not fire there.
"""
import pytest
from validate import (
    validate_schema, validate_defaults_cross_schema,
    validate_submit_on_default_matches_prisma, SchemaValidationError,
)

_SUBMIT_ON_ENTITY_PROPS = {
    'id': {'type': 'string', 'pattern': '^c[a-z0-9]{24,}$'},
    'status': {
        'type': 'string',
        'enum': ['draft', 'pending', 'accepted', 'rejected'],
        'default': 'draft',
    },
}

_PRISMA_DRIFTED_DEFAULT = """
model fake_grl {
  id      String @id @default(cuid())
  status  FakeGrlStatus @default(pending)
}
"""

_PRISMA_MATCHING_DEFAULT = """
model fake_grl {
  id      String @id @default(cuid())
  status  FakeGrlStatus @default(draft)
}
"""

_PRISMA_NO_DEFAULT = """
model fake_grl {
  id      String @id @default(cuid())
  status  FakeGrlStatus
}
"""


def _entity(x_approval=None, props=None):
    defn = {
        'type': 'object',
        'properties': props if props is not None else _SUBMIT_ON_ENTITY_PROPS,
    }
    if x_approval is not None:
        defn['x-approval'] = x_approval
    return {'definitions': {'fake_grl': defn}}


_SUBMIT_ON = {'submit_on': {'status': 'pending'}}


class TestSubmitOnDefaultMatchesPrisma:
    def test_b1_silent_pass_before_the_fix_is_reproduced_by_the_presence_only_check(self, tmp_path):
        """B-1: validate_defaults_cross_schema() alone (the pre-existing,
        presence-only check) does not catch a value-level disagreement when
        Prisma DOES have some @default() -- this is not a bug in that
        function (its scope is presence, by design, cmd_574); it's the
        proof that the goods_receipt_line-shaped drift really did sail
        through unguarded before this new check existed."""
        schema = _entity(x_approval=_SUBMIT_ON)
        prisma_path = tmp_path / 'schema.prisma'
        prisma_path.write_text(_PRISMA_DRIFTED_DEFAULT)
        validate_defaults_cross_schema(schema, prisma_path)  # must not raise

    def test_b2_submit_on_value_mismatch_is_caught(self, tmp_path):
        """B-2: the same injection (json default='draft', Prisma
        @default(pending) -- the real goods_receipt_line.status drift,
        cmd_1016/900ce04), now checked by
        validate_submit_on_default_matches_prisma() -- must raise."""
        schema = _entity(x_approval=_SUBMIT_ON)
        prisma_path = tmp_path / 'schema.prisma'
        prisma_path.write_text(_PRISMA_DRIFTED_DEFAULT)
        with pytest.raises(SchemaValidationError, match='status'):
            validate_submit_on_default_matches_prisma(schema, prisma_path)

    def test_b3_matching_default_on_both_sides_passes(self, tmp_path):
        """B-3: json and Prisma agree (draft/draft) -- normal, in-sync
        case, must pass."""
        schema = _entity(x_approval=_SUBMIT_ON)
        prisma_path = tmp_path / 'schema.prisma'
        prisma_path.write_text(_PRISMA_MATCHING_DEFAULT)
        validate_submit_on_default_matches_prisma(schema, prisma_path)  # must not raise

    def test_b4_same_value_mismatch_outside_x_approval_is_out_of_scope(self, tmp_path):
        """B-4: the identical json/Prisma value disagreement on an entity
        that does NOT declare x-approval.submit_on must NOT be flagged by
        this check -- scope is submit_on fields only (a general default
        VALUE mismatch elsewhere is not this check's job, and is not
        inherently wrong per Category A/C, schema_deriver.py)."""
        schema = _entity(x_approval=None)  # no x-approval at all
        prisma_path = tmp_path / 'schema.prisma'
        prisma_path.write_text(_PRISMA_DRIFTED_DEFAULT)
        validate_submit_on_default_matches_prisma(schema, prisma_path)  # must not raise

    def test_b5_submit_on_field_with_no_json_default_declared_is_skipped(self, tmp_path):
        """B-5: submit_on declared, but the field itself has no json
        `default:` at all (Category A: Prisma's default would be
        auto-reflected at schema-derive time, not hand-declared) --
        nothing to cross-check, must pass."""
        props = {
            'id': {'type': 'string', 'pattern': '^c[a-z0-9]{24,}$'},
            'status': {'type': 'string', 'enum': ['draft', 'pending']},  # no default:
        }
        schema = _entity(x_approval=_SUBMIT_ON, props=props)
        prisma_path = tmp_path / 'schema.prisma'
        prisma_path.write_text(_PRISMA_DRIFTED_DEFAULT)
        validate_submit_on_default_matches_prisma(schema, prisma_path)  # must not raise

    def test_b6_submit_on_field_with_no_prisma_default_at_all_is_skipped(self, tmp_path):
        """B-6: Prisma column has no @default() at all -- that half of the
        gap already belongs to validate_defaults_cross_schema() (presence
        check); this check must not also fire (would be a duplicate error
        for the same root cause)."""
        schema = _entity(x_approval=_SUBMIT_ON)
        prisma_path = tmp_path / 'schema.prisma'
        prisma_path.write_text(_PRISMA_NO_DEFAULT)
        validate_submit_on_default_matches_prisma(schema, prisma_path)  # must not raise

    def test_b7_missing_prisma_schema_file_errors(self, tmp_path):
        schema = _entity(x_approval=_SUBMIT_ON)
        missing_path = tmp_path / 'does_not_exist.prisma'
        with pytest.raises(SchemaValidationError, match='Prisma schema not found'):
            validate_submit_on_default_matches_prisma(schema, missing_path)

    def test_b8_entity_with_no_x_approval_at_all_is_skipped(self, tmp_path):
        """No x-approval block whatsoever -- must not error even when a
        completely unrelated field also happens to have a mismatched
        default (out of scope, same as B-4, from a different angle: no
        x-approval key present rather than submit_on absent within one)."""
        schema = {
            'definitions': {
                'plain_entity': {
                    'type': 'object',
                    'properties': _SUBMIT_ON_ENTITY_PROPS,
                },
            }
        }
        prisma_path = tmp_path / 'schema.prisma'
        prisma_path.write_text("""
model plain_entity {
  id      String @id @default(cuid())
  status  String @default("pending")
}
""")
        validate_submit_on_default_matches_prisma(schema, prisma_path)  # must not raise

    def test_b9_entity_with_no_backing_prisma_model_is_skipped(self, tmp_path):
        """An entity name with no corresponding Prisma model at all is out
        of scope -- nothing to cross check against."""
        schema = _entity(x_approval=_SUBMIT_ON)
        prisma_path = tmp_path / 'schema.prisma'
        prisma_path.write_text("""
model some_other_model {
  id  String @id @default(cuid())
}
""")
        validate_submit_on_default_matches_prisma(schema, prisma_path)  # must not raise

    def test_b10_paired_view_and_raw_entity_reports_the_mismatch_exactly_once(self, tmp_path):
        """A paired entity's view (allOf: [{$ref: __x}, {...}]) merges the
        raw entity by reference -- x-approval and the field default live on
        the raw definition only, so the mismatch must be reported exactly
        once (from '__fake_grl'), not duplicated via the view key."""
        schema = {
            'definitions': {
                'fake_grl': {
                    'type': 'object',
                    'x-generate': {'list': True},
                    'allOf': [
                        {'$ref': '#/definitions/__fake_grl'},
                        {'type': 'object', 'required': [], 'properties': {}},
                    ],
                },
                '__fake_grl': {
                    'type': 'object',
                    'properties': _SUBMIT_ON_ENTITY_PROPS,
                    'x-approval': _SUBMIT_ON,
                },
            }
        }
        prisma_path = tmp_path / 'schema.prisma'
        prisma_path.write_text(_PRISMA_DRIFTED_DEFAULT)
        with pytest.raises(SchemaValidationError) as exc_info:
            validate_submit_on_default_matches_prisma(schema, prisma_path)
        assert str(exc_info.value).count("field 'status'") == 1

    def test_b11_validate_schema_alone_does_not_know_about_prisma_either(self):
        """Sanity companion to B-1: the plain-JSON validate_schema() gate
        has no Prisma awareness at all, by design -- confirms this whole
        class of drift is invisible before any Prisma cross-check runs."""
        schema = _entity(x_approval=_SUBMIT_ON)
        validate_schema(schema)  # must not raise
