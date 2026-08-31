"""
Tests for declarative state-transition lockdown (x-state-lockdown).

A generator-derived guard, distinct from x-write-locked-values: that key
locks specific *values* a field may receive; this key locks *transitions*.
Once the monitored `field` reaches one of `terminal_values`, (1) `field`
itself may not move to a different value (backward/lateral transition
blocked) and (2) `locked_fields` may not change from their current value.
x-approval-independent by design (D3: shipment_line's replacement for the
x-approval-driven §16.15 lockdown after x-approval is removed from that
entity).

Covers:
  - derive_state_lockdown (helpers/schema_helpers.py): the pure derivation.
  - build_context(): the derived value flows into
    state_lockdown / state_lockdown_select.
  - service_validation.ts.jinja2: the shared create/update validation
    rejects a backward transition and a locked-field change once terminal,
    allows same-value resubmission, skips the check on CREATE, and emits
    no dead code for entities without a declaration.
  - api_import_route.ts.jinja2: CSV import UPDATE rejects the same
    violations with a row-numbered error; CREATE has no check.
  - validate.py: x-state-lockdown fail-closed checks (missing keys, field
    existence, enum membership, locked_fields shape/existence, field not
    self-referenced in locked_fields).
"""
import pytest
from build_context import build_context
from helpers.schema_helpers import derive_state_lockdown
from validate import validate_schema, SchemaValidationError


# ---------------------------------------------------------------------------
# derive_state_lockdown (helpers/schema_helpers.py)
# ---------------------------------------------------------------------------

class TestDeriveStateLockdown:
    def test_no_declaration_returns_none(self):
        assert derive_state_lockdown({'properties': {}}) is None

    def test_declaration_normalized(self):
        model_def = {
            'properties': {
                'status': {'type': 'string', 'enum': ['pending', 'shipped', 'rejected']},
                'quantity_shipped': {'type': 'integer'},
                'lot_number': {'type': 'string'},
            },
            'x-state-lockdown': {
                'field': 'status',
                'terminal_values': ['shipped', 'rejected'],
                'locked_fields': ['quantity_shipped', 'lot_number'],
            },
        }
        assert derive_state_lockdown(model_def) == {
            'field': 'status',
            'terminal_values': ['shipped', 'rejected'],
            'locked_fields': ['quantity_shipped', 'lot_number'],
        }

    def test_empty_locked_fields_normalized_to_empty_list(self):
        model_def = {
            'properties': {'status': {'type': 'string', 'enum': ['pending', 'shipped']}},
            'x-state-lockdown': {
                'field': 'status',
                'terminal_values': ['shipped'],
                'locked_fields': [],
            },
        }
        result = derive_state_lockdown(model_def)
        assert result['locked_fields'] == []


# ---------------------------------------------------------------------------
# Shared schema/entity helpers (build_context integration)
# ---------------------------------------------------------------------------

def _schema_with_state_lockdown(state_lockdown=None, edit=True) -> dict:
    props = {
        "id": {"type": "string", "pattern": "^c[a-z0-9]{24,}$"},
        "quantity_shipped": {"type": "integer"},
        "lot_number": {"type": "string"},
        "status": {
            "type": "string",
            "enum": ["pending", "shipped", "rejected"],
            "default": "pending",
        },
    }
    entity_def: dict = {
        "type": "object", "required": ["id", "status"], "properties": props,
        "x-import-key": ["id"],
    }
    if state_lockdown is not None:
        entity_def['x-state-lockdown'] = state_lockdown

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


_LOCKDOWN = {
    'field': 'status',
    'terminal_values': ['shipped', 'rejected'],
    'locked_fields': ['quantity_shipped', 'lot_number'],
}


class TestBuildContextStateLockdown:
    def test_no_declaration_gives_none(self):
        schema = _schema_with_state_lockdown()
        ctx = build_context(_entity(), schema)
        assert ctx["state_lockdown"] is None
        assert ctx["state_lockdown_select"] is None

    def test_declaration_populates_context(self):
        schema = _schema_with_state_lockdown(state_lockdown=_LOCKDOWN)
        ctx = build_context(_entity(), schema)
        assert ctx["state_lockdown"] == _LOCKDOWN
        assert ctx["state_lockdown_select"] == (
            '{ status: true, quantity_shipped: true, lot_number: true }'
        )

    def test_select_includes_field_even_with_no_locked_fields(self):
        schema = _schema_with_state_lockdown(state_lockdown={
            'field': 'status', 'terminal_values': ['shipped'], 'locked_fields': [],
        })
        ctx = build_context(_entity(), schema)
        assert ctx["state_lockdown_select"] == '{ status: true }'


# ---------------------------------------------------------------------------
# service_validation.ts.jinja2: shared create/update validation.
# ---------------------------------------------------------------------------

class TestServiceValidationStateLockdown:
    def _render(self, schema: dict) -> str:
        from generate import _make_env
        from validation_context import build_validation_context
        env = _make_env()
        ctx = build_context(_entity(), schema)
        val_ctx = {**ctx, **build_validation_context(ctx)}
        return env.get_template('service_validation.ts.jinja2').render(**val_ctx)

    def test_no_declaration_emits_no_dead_code(self):
        schema = _schema_with_state_lockdown()
        rendered = self._render(schema)
        assert 'STATE_LOCKDOWN' not in rendered
        assert 'StateLockdownCfg' not in rendered

    def test_constant_declared_with_config(self):
        schema = _schema_with_state_lockdown(state_lockdown=_LOCKDOWN)
        rendered = self._render(schema)
        assert "field: 'status'" in rendered
        assert '"shipped"' in rendered and '"rejected"' in rendered
        assert '"quantity_shipped"' in rendered and '"lot_number"' in rendered

    def test_check_skipped_on_create(self):
        schema = _schema_with_state_lockdown(state_lockdown=_LOCKDOWN)
        rendered = self._render(schema)
        assert 'if (currentId !== null) {' in rendered

    def test_backward_transition_rejected(self):
        schema = _schema_with_state_lockdown(state_lockdown=_LOCKDOWN)
        rendered = self._render(schema)
        assert 'is in a terminal state and cannot be changed' in rendered
        assert 'STATE_LOCKDOWN.terminalValues.includes(_currentState)' in rendered

    def test_locked_field_change_rejected(self):
        schema = _schema_with_state_lockdown(state_lockdown=_LOCKDOWN)
        rendered = self._render(schema)
        assert 'cannot be changed when' in rendered
        assert 'STATE_LOCKDOWN.lockedFields' in rendered

    def test_prev_row_fallback_uses_state_lockdown_select(self):
        schema = _schema_with_state_lockdown(state_lockdown=_LOCKDOWN)
        rendered = self._render(schema)
        assert 'select: { status: true, quantity_shipped: true, lot_number: true }' in rendered
        assert '_statePrevRow' in rendered


# ---------------------------------------------------------------------------
# api_import_route.ts.jinja2: CSV import (bypasses the service layer
# entirely, so the check is duplicated here).
# ---------------------------------------------------------------------------

class TestCsvImportStateLockdown:
    def _render(self, schema: dict) -> str:
        from generate import _make_env
        env = _make_env()
        ctx = build_context(_entity(), schema)
        return env.get_template('api_import_route.ts.jinja2').render(**ctx)

    def test_no_declaration_emits_no_dead_code(self):
        schema = _schema_with_state_lockdown()
        rendered = self._render(schema)
        assert 'STATE_LOCKDOWN_VIOLATION' not in rendered
        assert 'STATE_LOCKDOWN' not in rendered

    def test_update_branch_rejects_violation(self):
        schema = _schema_with_state_lockdown(state_lockdown=_LOCKDOWN, edit=True)
        rendered = self._render(schema)
        assert "code: 'STATE_LOCKDOWN_VIOLATION'" in rendered
        assert 'row: rowNum' in rendered
        assert '_stateLockdownRow' in rendered

    def test_no_check_on_create_path(self):
        """CREATE has no prior row to compare against -- the design deliberately
        skips the check there; only the UPDATE block's findUnique should carry
        the state_lockdown select clause."""
        schema = _schema_with_state_lockdown(state_lockdown=_LOCKDOWN, edit=True)
        rendered = self._render(schema)
        assert rendered.count('_stateLockdownRow') >= 1
        # The lockdown select clause is only used in the fallback DB read,
        # not duplicated into a create-time check.
        create_section, _, update_section = rendered.partition("op: 'update'")
        assert 'STATE_LOCKDOWN_VIOLATION' not in create_section


# ---------------------------------------------------------------------------
# validate.py: x-state-lockdown fail-closed checks.
# ---------------------------------------------------------------------------

def _minimal_schema_with_state_lockdown(x_state_lockdown) -> dict:
    return {
        "definitions": {
            "item": {
                "type": "object",
                "required": ["id", "status"],
                "properties": {
                    "id": {"type": "string", "pattern": "^c[a-z0-9]{24,}$"},
                    "status": {
                        "type": "string",
                        "enum": ["pending", "shipped", "rejected"],
                    },
                    "quantity_shipped": {"type": "integer"},
                },
                "x-state-lockdown": x_state_lockdown,
            },
        }
    }


class TestStateLockdownFailClosedValidation:
    def test_valid_declaration_passes(self):
        validate_schema(_minimal_schema_with_state_lockdown({
            'field': 'status',
            'terminal_values': ['shipped', 'rejected'],
            'locked_fields': ['quantity_shipped'],
        }))  # must not raise

    def test_valid_declaration_empty_locked_fields_passes(self):
        validate_schema(_minimal_schema_with_state_lockdown({
            'field': 'status',
            'terminal_values': ['shipped'],
            'locked_fields': [],
        }))  # must not raise

    def test_not_a_dict_rejected(self):
        with pytest.raises(SchemaValidationError) as exc_info:
            validate_schema(_minimal_schema_with_state_lockdown(['field', 'status']))
        assert 'must be a mapping' in str(exc_info.value)

    def test_missing_required_key_rejected(self):
        with pytest.raises(SchemaValidationError) as exc_info:
            validate_schema(_minimal_schema_with_state_lockdown({'field': 'status'}))
        assert 'missing required key' in str(exc_info.value)

    def test_field_not_string_rejected(self):
        with pytest.raises(SchemaValidationError) as exc_info:
            validate_schema(_minimal_schema_with_state_lockdown({
                'field': 123, 'terminal_values': ['shipped'], 'locked_fields': [],
            }))
        assert 'must be a string' in str(exc_info.value)

    def test_nonexistent_field_rejected(self):
        with pytest.raises(SchemaValidationError) as exc_info:
            validate_schema(_minimal_schema_with_state_lockdown({
                'field': 'no_such_field', 'terminal_values': ['x'], 'locked_fields': [],
            }))
        assert 'no_such_field' in str(exc_info.value)
        assert 'does not exist in properties' in str(exc_info.value)

    def test_field_with_no_enum_rejected(self):
        with pytest.raises(SchemaValidationError) as exc_info:
            validate_schema(_minimal_schema_with_state_lockdown({
                'field': 'quantity_shipped', 'terminal_values': [1], 'locked_fields': [],
            }))
        assert 'has no enum' in str(exc_info.value)

    def test_empty_terminal_values_rejected(self):
        with pytest.raises(SchemaValidationError) as exc_info:
            validate_schema(_minimal_schema_with_state_lockdown({
                'field': 'status', 'terminal_values': [], 'locked_fields': [],
            }))
        assert 'terminal_values' in str(exc_info.value)
        assert 'non-empty list' in str(exc_info.value)

    def test_terminal_value_not_in_enum_rejected(self):
        with pytest.raises(SchemaValidationError) as exc_info:
            validate_schema(_minimal_schema_with_state_lockdown({
                'field': 'status', 'terminal_values': ['dispatched'], 'locked_fields': [],
            }))
        assert 'dispatched' in str(exc_info.value)
        assert "is not in" in str(exc_info.value)

    def test_locked_fields_not_a_list_rejected(self):
        with pytest.raises(SchemaValidationError) as exc_info:
            validate_schema(_minimal_schema_with_state_lockdown({
                'field': 'status', 'terminal_values': ['shipped'],
                'locked_fields': 'quantity_shipped',
            }))
        assert 'locked_fields' in str(exc_info.value)
        assert 'must be a list' in str(exc_info.value)

    def test_locked_fields_nonexistent_field_rejected(self):
        with pytest.raises(SchemaValidationError) as exc_info:
            validate_schema(_minimal_schema_with_state_lockdown({
                'field': 'status', 'terminal_values': ['shipped'],
                'locked_fields': ['no_such_field'],
            }))
        assert 'no_such_field' in str(exc_info.value)
        assert 'does not exist in properties' in str(exc_info.value)

    def test_field_self_referenced_in_locked_fields_rejected(self):
        with pytest.raises(SchemaValidationError) as exc_info:
            validate_schema(_minimal_schema_with_state_lockdown({
                'field': 'status', 'terminal_values': ['shipped'],
                'locked_fields': ['status'],
            }))
        assert 'must not include' in str(exc_info.value)
