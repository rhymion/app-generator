"""
Tests for declarative, value-level write lockdown.

A generator-derived guard: for each entity, the (field, value) pairs that
only the system may write — the union of (a) values that appear in an
x-approval entity's on_approved.set_fields / on_rejected.set_fields, and
(b) values explicitly declared via the entity-level x-write-locked-values
key. Ordinary create/update through the screen, the REST API / Server
Action write path, and CSV import must all refuse to write one of those
values directly — a system writer (the approval/rejection workflow, or
whatever external process the x-write-locked-values declaration guards
against) is unaffected because it writes through a separate code path (a
direct transaction call, not the guarded service layer).

Covers:
  - derive_write_locked_values (helpers/schema_helpers.py): the pure
    derivation, field-scoped and per-entity, and its union semantics
    across the two sources.
  - build_context(): the derived value flows into
    write_locked_values / write_locked_fields / write_locked_values_select.
  - form_upsert_context() (generators.py): a locked enum option renders
    disabled (present, not selectable) rather than removed (which would
    blank an already-locked record's field on open).
  - service_validation.ts.jinja2: the shared create/update validation
    rejects a locked value, allows a same-value resubmission on update,
    and emits no dead code for entities without locked values.
  - api_import_route.ts.jinja2: CSV create/update reject a locked value
    with a row-numbered, column-named error; update allows a same-value
    resubmission.
  - generators_test.py's generated-spec value pickers (cypress_edit_value,
    the int-enum "primary field" branch) never pick a locked value.
  - validate.py: x-write-locked-values fail-closed checks (field
    existence, dict/list shape, enum membership).
"""
import pytest
from build_context import build_context
from generators import form_upsert_context
from generators_test import cypress_edit_value
from helpers.schema_helpers import derive_write_locked_values
from validate import validate_schema, SchemaValidationError


# ---------------------------------------------------------------------------
# derive_write_locked_values (helpers/schema_helpers.py)
# ---------------------------------------------------------------------------

class TestDeriveWriteLockedValues:
    def test_no_source_returns_empty(self):
        assert derive_write_locked_values({'properties': {}}) == {}

    def test_x_approval_with_empty_set_fields_returns_empty(self):
        model_def = {
            'properties': {'status': {'type': 'string', 'enum': ['pending', 'rejected']}},
            'x-approval': {'on_approved': {'emit_hook': True}, 'on_rejected': {'set_fields': {}}},
        }
        assert derive_write_locked_values(model_def) == {}

    def test_on_approved_and_on_rejected_merge_per_field(self):
        model_def = {
            'properties': {'status': {'type': 'string', 'enum': ['pending', 'active', 'released']}},
            'x-approval': {
                'on_approved': {'set_fields': {'status': 'active'}},
                'on_rejected': {'set_fields': {'status': 'released'}},
            },
        }
        assert derive_write_locked_values(model_def) == {'status': ['active', 'released']}

    def test_different_fields_kept_separate_not_bundled(self):
        """A value locked on one field must not spill onto an unrelated field."""
        model_def = {
            'properties': {
                'status': {'type': 'string', 'enum': ['pending', 'approved']},
                'reviewer_note': {'type': 'string'},
            },
            'x-approval': {
                'on_approved': {'set_fields': {'status': 'approved', 'reviewer_note': 'ok'}},
                'on_rejected': {'set_fields': {}},
            },
        }
        locked = derive_write_locked_values(model_def)
        assert locked == {'status': ['approved'], 'reviewer_note': ['ok']}

    def test_legacy_int_enum_label_resolves_to_ordinal(self):
        """set_fields may name an int-enum member by its label; the locked
        value must be the ordinal actually written to the DB, not the label
        string (matches _resolve_set_fields' dispatch-context behavior)."""
        model_def = {
            'properties': {'status': {'type': 'integer', 'enum': ['Pending', 'Approved', 'Rejected']}},
            'x-approval': {
                'on_approved': {'set_fields': {'status': 'Approved'}},
                'on_rejected': {'set_fields': {'status': 'Rejected'}},
            },
        }
        assert derive_write_locked_values(model_def) == {'status': [1, 2]}

    def test_duplicate_value_not_repeated(self):
        model_def = {
            'properties': {'status': {'type': 'string', 'enum': ['pending', 'rejected']}},
            'x-approval': {
                'on_approved': {'set_fields': {'status': 'rejected'}},
                'on_rejected': {'set_fields': {'status': 'rejected'}},
            },
        }
        assert derive_write_locked_values(model_def) == {'status': ['rejected']}

    # -- x-write-locked-values only (no x-approval on the entity at all) --

    def test_write_locked_values_only_no_x_approval(self):
        model_def = {
            'properties': {
                'status': {
                    'type': 'string',
                    'enum': ['draft', 'submitted', 'in_underwriting', 'issued'],
                },
            },
            'x-write-locked-values': {'status': ['in_underwriting', 'issued']},
        }
        assert derive_write_locked_values(model_def) == {
            'status': ['in_underwriting', 'issued'],
        }

    def test_write_locked_values_duplicate_value_not_repeated(self):
        model_def = {
            'properties': {'status': {'type': 'string', 'enum': ['a', 'b']}},
            'x-write-locked-values': {'status': ['a', 'a']},
        }
        assert derive_write_locked_values(model_def) == {'status': ['a']}

    # -- union of both sources --

    def test_union_of_x_approval_and_write_locked_values(self):
        """x-write-locked-values adds to, never replaces, the x-approval
        derived set — including on the same field."""
        model_def = {
            'properties': {
                'status': {
                    'type': 'string',
                    'enum': ['pending', 'approved', 'rejected', 'archived'],
                },
            },
            'x-approval': {
                'on_approved': {'set_fields': {'status': 'approved'}},
                'on_rejected': {'set_fields': {'status': 'rejected'}},
            },
            'x-write-locked-values': {'status': ['archived']},
        }
        locked = derive_write_locked_values(model_def)
        assert set(locked['status']) == {'approved', 'rejected', 'archived'}

    def test_union_no_duplicate_when_same_value_declared_both_ways(self):
        model_def = {
            'properties': {'status': {'type': 'string', 'enum': ['pending', 'approved']}},
            'x-approval': {'on_approved': {'set_fields': {'status': 'approved'}}},
            'x-write-locked-values': {'status': ['approved']},
        }
        assert derive_write_locked_values(model_def) == {'status': ['approved']}


# ---------------------------------------------------------------------------
# Shared schema/entity helpers (build_context integration)
# ---------------------------------------------------------------------------

def _schema_with_locks(
    set_fields_approved=None,
    set_fields_rejected=None,
    write_locked_values=None,
    edit=True,
) -> dict:
    props = {
        "id": {"type": "string", "pattern": "^c[a-z0-9]{24,}$"},
        "name": {"type": "string"},
        "status": {
            "type": "string",
            "enum": ["pending", "active", "released", "rejected"],
            "default": "pending",
        },
    }
    entity_def: dict = {
        "type": "object", "required": ["id", "name", "status"], "properties": props,
        "x-import-key": ["name"],
    }
    x_approval = {}
    if set_fields_approved is not None:
        x_approval['on_approved'] = {'set_fields': set_fields_approved}
    if set_fields_rejected is not None:
        x_approval['on_rejected'] = {'set_fields': set_fields_rejected}
    if x_approval:
        entity_def['x-approval'] = x_approval
    if write_locked_values is not None:
        entity_def['x-write-locked-values'] = write_locked_values

    return {
        "definitions": {
            "item": entity_def,
            "item_detail": {
                "x-generate": {
                    "list": True, "view": True, "new": True, "edit": edit,
                    "delete": True, "api": True, "test": False, "fields": None,
                },
                "allOf": [{"$ref": "#/definitions/item"}],
            },
        }
    }


def _entity(model: str = "item") -> dict:
    return {
        "parent": model,
        "model": model,
        "definition_key": f"{model}_detail",
        "children": [],
        "generate_config": {
            "list": True, "view": True, "new": True, "edit": True,
            "delete": True, "api": True, "test": False, "fields": None,
        },
    }


# ---------------------------------------------------------------------------
# build_context(): write_locked_values / _fields / _values_select
# ---------------------------------------------------------------------------

class TestBuildContextWriteLockedValues:
    def test_no_source_gives_empty(self):
        schema = _schema_with_locks()
        ctx = build_context(_entity(), schema)
        assert ctx["write_locked_values"] == {}
        assert ctx["write_locked_fields"] == []
        assert ctx["write_locked_values_select"] is None

    def test_x_approval_populates_locked_values(self):
        schema = _schema_with_locks(
            set_fields_approved={'status': 'active'},
            set_fields_rejected={'status': 'released'},
        )
        ctx = build_context(_entity(), schema)
        assert ctx["write_locked_values"] == {'status': ['active', 'released']}
        assert ctx["write_locked_fields"] == ['status']
        assert ctx["write_locked_values_select"] == '{ status: true }'

    def test_write_locked_values_only_populates_without_x_approval(self):
        schema = _schema_with_locks(write_locked_values={'status': ['released']})
        ctx = build_context(_entity(), schema)
        assert ctx["write_locked_values"] == {'status': ['released']}
        assert ctx["write_locked_fields"] == ['status']
        assert ctx["write_locked_values_select"] == '{ status: true }'

    def test_union_when_both_sources_present(self):
        schema = _schema_with_locks(
            set_fields_approved={'status': 'active'},
            write_locked_values={'status': ['released']},
        )
        ctx = build_context(_entity(), schema)
        assert set(ctx["write_locked_values"]['status']) == {'active', 'released'}

    def test_empty_set_fields_entity_is_unprotected(self):
        """cmd_732 §7: an x-approval entity whose set_fields is empty on both
        hooks must be reported as unprotected, not silently treated as safe."""
        schema = _schema_with_locks(set_fields_approved={}, set_fields_rejected={})
        ctx = build_context(_entity(), schema)
        assert ctx["write_locked_values"] == {}
        assert ctx["write_locked_fields"] == []


# ---------------------------------------------------------------------------
# form_upsert_context(): screen — locked options render disabled, not
# removed (an already-locked record must not go blank on open).
# ---------------------------------------------------------------------------

class TestFormUpsertWriteLockedOptions:
    def _build(self, schema: dict) -> dict:
        ctx = build_context(_entity(), schema)
        return form_upsert_context(ctx, schema)

    def test_locked_value_option_present_and_disabled(self):
        schema = _schema_with_locks(
            set_fields_approved={'status': 'active'},
            set_fields_rejected={'status': 'released'},
        )
        upsert = self._build(schema)
        opts = ''.join(upsert['enum_opt_setups'])
        assert "value: 'active'" in opts
        assert "value: 'released'" in opts
        assert "value: 'pending'" in opts
        # Locked values carry disabled: true; pending (never locked) does not.
        assert "value: 'active', label: 'active', disabled: true" in opts
        assert "value: 'released', label: 'released', disabled: true" in opts
        assert "value: 'pending', label: 'pending' }" in opts

    def test_write_locked_values_only_also_disables(self):
        """x-write-locked-values on its own (no x-approval) must disable
        the option too — the disabling logic keys off write_locked_values,
        not off x-approval's presence."""
        schema = _schema_with_locks(write_locked_values={'status': ['released']})
        upsert = self._build(schema)
        opts = ''.join(upsert['enum_opt_setups'])
        assert "value: 'released', label: 'released', disabled: true" in opts
        assert "value: 'pending', label: 'pending' }" in opts

    def test_no_source_no_disabled_options(self):
        schema = _schema_with_locks()
        upsert = self._build(schema)
        opts = ''.join(upsert['enum_opt_setups'])
        assert 'disabled' not in opts


# ---------------------------------------------------------------------------
# service_validation.ts.jinja2: shared create/update validation
# (REST API route and Server Action both call through this).
# ---------------------------------------------------------------------------

class TestServiceValidationWriteLockdown:
    def _render(self, schema: dict) -> str:
        from generate import _make_env
        from validation_context import build_validation_context
        env = _make_env()
        ctx = build_context(_entity(), schema)
        val_ctx = {**ctx, **build_validation_context(ctx)}
        return env.get_template('service_validation.ts.jinja2').render(**val_ctx)

    def test_no_source_emits_no_dead_code(self):
        schema = _schema_with_locks()
        rendered = self._render(schema)
        assert 'WRITE_LOCKED_FIELDS' not in rendered
        assert 'WriteLockedField' not in rendered

    def test_locked_fields_declared_with_values(self):
        schema = _schema_with_locks(
            set_fields_approved={'status': 'active'},
            set_fields_rejected={'status': 'released'},
        )
        rendered = self._render(schema)
        assert "key: 'status', values:" in rendered
        assert '"active"' in rendered and '"released"' in rendered

    def test_check_rejects_locked_value_with_field_specific_error(self):
        schema = _schema_with_locks(
            set_fields_approved={'status': 'active'},
            set_fields_rejected={'status': 'released'},
        )
        rendered = self._render(schema)
        assert 'AppError' in rendered
        assert "field.key" in rendered
        assert 'managed by the system' in rendered

    def test_update_allows_resubmission_of_persisted_value(self):
        """A no-op resubmit of the value already on the row must be allowed
        -- it was already written by a prior operation, not a new write
        attempt."""
        schema = _schema_with_locks(
            set_fields_approved={'status': 'active'},
            set_fields_rejected={'status': 'released'},
        )
        rendered = self._render(schema)
        assert 'currentRow' in rendered
        assert 'findUnique' in rendered
        assert 'select: { status: true }' in rendered
        assert 'currentRow[field.key] === submitted' in rendered

    def test_write_locked_values_only_also_renders_check(self):
        schema = _schema_with_locks(write_locked_values={'status': ['released']})
        rendered = self._render(schema)
        assert 'WRITE_LOCKED_FIELDS' in rendered
        assert "key: 'status', values:" in rendered
        assert '"released"' in rendered


# ---------------------------------------------------------------------------
# api_import_route.ts.jinja2: CSV import (bypasses the service layer
# entirely, so the check is duplicated here rather than shared).
# ---------------------------------------------------------------------------

class TestCsvImportWriteLockdown:
    def _render(self, schema: dict) -> str:
        from generate import _make_env
        env = _make_env()
        ctx = build_context(_entity(), schema)
        return env.get_template('api_import_route.ts.jinja2').render(**ctx)

    def test_no_source_emits_no_dead_code(self):
        schema = _schema_with_locks()
        rendered = self._render(schema)
        assert 'APPROVAL_LOCKED_VALUE' not in rendered
        assert 'findLockedViolation' not in rendered

    def test_create_branch_rejects_locked_value(self):
        schema = _schema_with_locks(
            set_fields_approved={'status': 'active'},
            set_fields_rejected={'status': 'released'},
        )
        rendered = self._render(schema)
        assert 'findLockedViolation' in rendered
        # CREATE has no persisted row to fall back to -- unconditional reject.
        # Error code string is intentionally kept as-is (external contract).
        assert "code: 'APPROVAL_LOCKED_VALUE'" in rendered
        assert 'row: rowNum' in rendered
        assert "column '${_lockedViolation.key}'" in rendered

    def test_update_branch_allows_resubmission_of_persisted_value(self):
        schema = _schema_with_locks(
            set_fields_approved={'status': 'active'},
            set_fields_rejected={'status': 'released'},
            edit=True,
        )
        rendered = self._render(schema)
        assert '_lockedCurrent' in rendered
        assert 'select: { status: true }' in rendered

    def test_write_locked_values_only_also_rejects(self):
        schema = _schema_with_locks(write_locked_values={'status': ['released']})
        rendered = self._render(schema)
        assert 'findLockedViolation' in rendered
        assert "code: 'APPROVAL_LOCKED_VALUE'" in rendered


# ---------------------------------------------------------------------------
# generators_test.py: generated-spec value pickers must never choose a
# write-locked value (cmd_732 §8 -- the scaffold must not fabricate a
# system-managed-looking record no real write ever produced).
# ---------------------------------------------------------------------------

class TestGeneratedSpecValuePickersSkipLockedValues:
    def test_cypress_edit_value_skips_locked_second_value(self):
        """Reproduces the confirmed collision: a naive values[1] picker on
        status = [pending, active, released, rejected] with active+released
        locked would pick 'active' -- a locked value."""
        field = {
            'category': 'string_enum',
            'prop_name': 'status',
            'enum_values': ['pending', 'active', 'released', 'rejected'],
        }
        locked = {'status': ['active', 'released']}
        value = cypress_edit_value(field, 'Item', locked)
        assert value not in ('active', 'released')
        assert value == 'rejected'

    def test_cypress_edit_value_unaffected_when_no_locked_values(self):
        field = {
            'category': 'string_enum',
            'prop_name': 'status',
            'enum_values': ['pending', 'active', 'released', 'rejected'],
        }
        assert cypress_edit_value(field, 'Item', {}) == 'active'
        assert cypress_edit_value(field, 'Item', None) == 'active'


# ---------------------------------------------------------------------------
# validate.py: x-write-locked-values fail-closed checks (cmd_857, cmd_476
# injection-proof style). Each test injects one concrete violation and
# asserts validate_schema() raises SchemaValidationError naming the
# offending definition/field.
# ---------------------------------------------------------------------------

def _minimal_schema_with_write_locked(x_write_locked) -> dict:
    return {
        "definitions": {
            "item": {
                "type": "object",
                "required": ["id", "status"],
                "properties": {
                    "id": {"type": "string", "pattern": "^c[a-z0-9]{24,}$"},
                    "status": {
                        "type": "string",
                        "enum": ["pending", "active", "released"],
                    },
                },
                "x-write-locked-values": x_write_locked,
            },
        }
    }


class TestWriteLockedValuesFailClosedValidation:
    def test_nonexistent_field_rejected(self):
        """(a) a field name not present in properties at all."""
        schema = _minimal_schema_with_write_locked({'no_such_field': ['x']})
        with pytest.raises(SchemaValidationError) as exc_info:
            validate_schema(schema)
        assert 'no_such_field' in str(exc_info.value)
        assert 'does not exist in properties' in str(exc_info.value)

    def test_value_not_in_enum_rejected(self):
        """(b) a value that is not a member of the field's enum."""
        schema = _minimal_schema_with_write_locked({'status': ['not_a_real_status']})
        with pytest.raises(SchemaValidationError) as exc_info:
            validate_schema(schema)
        assert 'not_a_real_status' in str(exc_info.value)
        assert 'not in enum' in str(exc_info.value)

    def test_dict_instead_of_field_list_rejected(self):
        """(c) x-write-locked-values itself is not a mapping (e.g. a list)."""
        schema = _minimal_schema_with_write_locked([{'field': 'status', 'values': ['active']}])
        with pytest.raises(SchemaValidationError) as exc_info:
            validate_schema(schema)
        assert 'must be a' in str(exc_info.value)
        assert 'mapping' in str(exc_info.value)

    def test_scalar_instead_of_list_rejected(self):
        """(d) a field's declared value is a bare scalar, not a list."""
        schema = _minimal_schema_with_write_locked({'status': 'active'})
        with pytest.raises(SchemaValidationError) as exc_info:
            validate_schema(schema)
        assert 'must be a list' in str(exc_info.value)

    def test_valid_declaration_passes(self):
        """Control case: a well-formed declaration raises nothing."""
        schema = _minimal_schema_with_write_locked({'status': ['active', 'released']})
        validate_schema(schema)  # must not raise

    def test_field_with_no_enum_rejected(self):
        schema = {
            "definitions": {
                "item": {
                    "type": "object",
                    "required": ["id", "note"],
                    "properties": {
                        "id": {"type": "string", "pattern": "^c[a-z0-9]{24,}$"},
                        "note": {"type": "string"},
                    },
                    "x-write-locked-values": {'note': ['whatever']},
                },
            }
        }
        with pytest.raises(SchemaValidationError) as exc_info:
            validate_schema(schema)
        assert 'no enum' in str(exc_info.value)
