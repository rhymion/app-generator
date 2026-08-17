"""
Tests for value-level lockdown of x-approval-managed status values.

A generator-derived guard: for each x-approval entity, the (field, value)
pairs that appear in on_approved.set_fields / on_rejected.set_fields are
values only the approval/rejection workflow may write. Ordinary
create/update through the screen, the REST API / Server Action write path,
and CSV import must all refuse to write one of those values directly — the
workflow itself is unaffected because it writes through a separate code
path (a direct transaction call, not the guarded service layer).

Covers:
  - derive_approval_locked_values (helpers/schema_helpers.py): the pure
    derivation, field-scoped and per-entity.
  - build_context(): the derived value flows into
    approval_locked_values / approval_locked_fields /
    approval_locked_values_select.
  - form_upsert_context() (generators.py): a locked enum option renders
    disabled (present, not selectable) rather than removed (which would
    blank an already-approved/rejected record's field on open).
  - service_validation.ts.jinja2: the shared create/update validation
    rejects a locked value, allows a same-value resubmission on update,
    and emits no dead code for entities without locked values.
  - api_import_route.ts.jinja2: CSV create/update reject a locked value
    with a row-numbered, column-named error; update allows a same-value
    resubmission.
  - generators_test.py's generated-spec value pickers (cypress_edit_value,
    the int-enum "primary field" branch) never pick a locked value.
"""
import pytest
from build_context import build_context
from generators import form_upsert_context
from generators_test import cypress_edit_value
from helpers.schema_helpers import derive_approval_locked_values


# ---------------------------------------------------------------------------
# derive_approval_locked_values (helpers/schema_helpers.py)
# ---------------------------------------------------------------------------

class TestDeriveApprovalLockedValues:
    def test_no_x_approval_returns_empty(self):
        assert derive_approval_locked_values({'properties': {}}) == {}

    def test_x_approval_with_empty_set_fields_returns_empty(self):
        model_def = {
            'properties': {'status': {'type': 'string', 'enum': ['pending', 'rejected']}},
            'x-approval': {'on_approved': {'emit_hook': True}, 'on_rejected': {'set_fields': {}}},
        }
        assert derive_approval_locked_values(model_def) == {}

    def test_on_approved_and_on_rejected_merge_per_field(self):
        model_def = {
            'properties': {'status': {'type': 'string', 'enum': ['pending', 'active', 'released']}},
            'x-approval': {
                'on_approved': {'set_fields': {'status': 'active'}},
                'on_rejected': {'set_fields': {'status': 'released'}},
            },
        }
        assert derive_approval_locked_values(model_def) == {'status': ['active', 'released']}

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
        locked = derive_approval_locked_values(model_def)
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
        assert derive_approval_locked_values(model_def) == {'status': [1, 2]}

    def test_duplicate_value_not_repeated(self):
        model_def = {
            'properties': {'status': {'type': 'string', 'enum': ['pending', 'rejected']}},
            'x-approval': {
                'on_approved': {'set_fields': {'status': 'rejected'}},
                'on_rejected': {'set_fields': {'status': 'rejected'}},
            },
        }
        assert derive_approval_locked_values(model_def) == {'status': ['rejected']}


# ---------------------------------------------------------------------------
# Shared schema/entity helpers (build_context integration)
# ---------------------------------------------------------------------------

def _schema_with_approval(set_fields_approved=None, set_fields_rejected=None, edit=True) -> dict:
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
# build_context(): approval_locked_values / _fields / _values_select
# ---------------------------------------------------------------------------

class TestBuildContextApprovalLockedValues:
    def test_no_x_approval_gives_empty(self):
        schema = _schema_with_approval()
        ctx = build_context(_entity(), schema)
        assert ctx["approval_locked_values"] == {}
        assert ctx["approval_locked_fields"] == []
        assert ctx["approval_locked_values_select"] is None

    def test_x_approval_populates_locked_values(self):
        schema = _schema_with_approval(
            set_fields_approved={'status': 'active'},
            set_fields_rejected={'status': 'released'},
        )
        ctx = build_context(_entity(), schema)
        assert ctx["approval_locked_values"] == {'status': ['active', 'released']}
        assert ctx["approval_locked_fields"] == ['status']
        assert ctx["approval_locked_values_select"] == '{ status: true }'

    def test_empty_set_fields_entity_is_unprotected(self):
        """cmd_732 §7: an x-approval entity whose set_fields is empty on both
        hooks must be reported as unprotected, not silently treated as safe."""
        schema = _schema_with_approval(set_fields_approved={}, set_fields_rejected={})
        ctx = build_context(_entity(), schema)
        assert ctx["approval_locked_values"] == {}
        assert ctx["approval_locked_fields"] == []


# ---------------------------------------------------------------------------
# form_upsert_context(): screen — locked options render disabled, not
# removed (an already-approved/rejected record must not go blank on open).
# ---------------------------------------------------------------------------

class TestFormUpsertApprovalLockedOptions:
    def _build(self, schema: dict) -> dict:
        ctx = build_context(_entity(), schema)
        return form_upsert_context(ctx, schema)

    def test_locked_value_option_present_and_disabled(self):
        schema = _schema_with_approval(
            set_fields_approved={'status': 'active'},
            set_fields_rejected={'status': 'released'},
        )
        upsert = self._build(schema)
        opts = ''.join(upsert['enum_opt_setups'])
        assert "value: 'active'" in opts
        assert "value: 'released'" in opts
        assert "value: 'pending'" in opts
        # Locked values carry disabled: true; pending (never approval-only) does not.
        assert "value: 'active', label: 'active', disabled: true" in opts
        assert "value: 'released', label: 'released', disabled: true" in opts
        assert "value: 'pending', label: 'pending' }" in opts

    def test_no_x_approval_no_disabled_options(self):
        schema = _schema_with_approval()
        upsert = self._build(schema)
        opts = ''.join(upsert['enum_opt_setups'])
        assert 'disabled' not in opts


# ---------------------------------------------------------------------------
# service_validation.ts.jinja2: shared create/update validation
# (REST API route and Server Action both call through this).
# ---------------------------------------------------------------------------

class TestServiceValidationApprovalLockdown:
    def _render(self, schema: dict) -> str:
        from generate import _make_env
        from validation_context import build_validation_context
        env = _make_env()
        ctx = build_context(_entity(), schema)
        val_ctx = {**ctx, **build_validation_context(ctx)}
        return env.get_template('service_validation.ts.jinja2').render(**val_ctx)

    def test_no_x_approval_emits_no_dead_code(self):
        schema = _schema_with_approval()
        rendered = self._render(schema)
        assert 'APPROVAL_LOCKED_FIELDS' not in rendered
        assert 'ApprovalLockedField' not in rendered

    def test_locked_fields_declared_with_values(self):
        schema = _schema_with_approval(
            set_fields_approved={'status': 'active'},
            set_fields_rejected={'status': 'released'},
        )
        rendered = self._render(schema)
        assert "key: 'status', values:" in rendered
        assert '"active"' in rendered and '"released"' in rendered

    def test_check_rejects_locked_value_with_field_specific_error(self):
        schema = _schema_with_approval(
            set_fields_approved={'status': 'active'},
            set_fields_rejected={'status': 'released'},
        )
        rendered = self._render(schema)
        assert 'AppError' in rendered
        assert "field.key" in rendered
        assert 'approval/rejection workflow' in rendered

    def test_update_allows_resubmission_of_persisted_value(self):
        """A no-op resubmit of the value already on the row must be allowed
        -- it's the value the approval/rejection workflow itself wrote, not
        a new write attempt."""
        schema = _schema_with_approval(
            set_fields_approved={'status': 'active'},
            set_fields_rejected={'status': 'released'},
        )
        rendered = self._render(schema)
        assert 'currentRow' in rendered
        assert 'findUnique' in rendered
        assert 'select: { status: true }' in rendered
        assert 'currentRow[field.key] === submitted' in rendered


# ---------------------------------------------------------------------------
# api_import_route.ts.jinja2: CSV import (bypasses the service layer
# entirely, so the check is duplicated here rather than shared).
# ---------------------------------------------------------------------------

class TestCsvImportApprovalLockdown:
    def _render(self, schema: dict) -> str:
        from generate import _make_env
        env = _make_env()
        ctx = build_context(_entity(), schema)
        return env.get_template('api_import_route.ts.jinja2').render(**ctx)

    def test_no_x_approval_emits_no_dead_code(self):
        schema = _schema_with_approval()
        rendered = self._render(schema)
        assert 'APPROVAL_LOCKED_VALUE' not in rendered
        assert 'findLockedViolation' not in rendered

    def test_create_branch_rejects_locked_value(self):
        schema = _schema_with_approval(
            set_fields_approved={'status': 'active'},
            set_fields_rejected={'status': 'released'},
        )
        rendered = self._render(schema)
        assert 'findLockedViolation' in rendered
        # CREATE has no persisted row to fall back to -- unconditional reject.
        assert "code: 'APPROVAL_LOCKED_VALUE'" in rendered
        assert 'row: rowNum' in rendered
        assert "column '${_lockedViolation.key}'" in rendered

    def test_update_branch_allows_resubmission_of_persisted_value(self):
        schema = _schema_with_approval(
            set_fields_approved={'status': 'active'},
            set_fields_rejected={'status': 'released'},
            edit=True,
        )
        rendered = self._render(schema)
        assert '_lockedCurrent' in rendered
        assert 'select: { status: true }' in rendered


# ---------------------------------------------------------------------------
# generators_test.py: generated-spec value pickers must never choose an
# approval-locked value (cmd_732 §8 -- the scaffold must not fabricate an
# approved/rejected-looking record the workflow never produced).
# ---------------------------------------------------------------------------

class TestGeneratedSpecValuePickersSkipLockedValues:
    def test_cypress_edit_value_skips_locked_second_value(self):
        """Reproduces the confirmed collision: a naive values[1] picker on
        status = [pending, active, released, rejected] with active+released
        locked would pick 'active' -- an approval-only value."""
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
