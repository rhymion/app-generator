"""cmd_394 §8 DP-1a: E_IMPORT_KEY_INVISIBLE — an x-import-key entry must
actually appear as an exported CSV column, or the import route rejects
every row with 400 MISSING_COLUMN before any row is processed.

Also covers cmd_394 §5/§13: E_COMPOSITE_KEY_AMBIGUOUS_LABEL — a composite
x-import-key target referenced elsewhere via a single-field labelField
(fail-loud only; the full composite-key roundtrip redesign is out of scope,
tracked as a separate follow-up cmd).
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


# ---------------------------------------------------------------------------
# E_IMPORT_KEY_INVISIBLE — scalar (non-dotted) keys
# ---------------------------------------------------------------------------

class TestScalarImportKeyVisibility:
    def _schema(self, fields):
        return {
            'definitions': {
                'widget': {
                    'type': 'object',
                    'required': ['id', 'code'],
                    'x-import-key': ['code'],
                    'properties': {
                        'id': {'type': 'string', 'pattern': '^c[a-z0-9]{24,}$'},
                        'code': {'type': 'string'},
                        'secret': {'type': 'string'},
                    },
                },
                'widget_detail': {
                    'x-generate': {'list': True, 'view': True, 'new': True, 'edit': True,
                                   'api': True, 'fields': fields},
                    'allOf': [{'$ref': '#/definitions/widget'}],
                },
            }
        }

    def test_red_key_hidden_from_view_allowlist_errors(self):
        """'code' import key not in x-generate.fields → E_IMPORT_KEY_INVISIBLE."""
        schema = self._schema(['secret'])
        with pytest.raises(SchemaValidationError, match='E_IMPORT_KEY_INVISIBLE'):
            validate_schema(schema)

    def test_green_key_present_in_view_allowlist_passes(self):
        schema = self._schema(['code', 'secret'])
        validate_schema(schema)  # must not raise

    def test_green_unrestricted_fields_passes(self):
        """fields=None (unrestricted) → 'code' is view-visible by default."""
        schema = self._schema(None)
        validate_schema(schema)  # must not raise


# ---------------------------------------------------------------------------
# E_IMPORT_KEY_INVISIBLE — dotted FK keys (labelField mismatch)
# ---------------------------------------------------------------------------

class TestDottedImportKeyVisibility:
    def _schema(self, fk_label):
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
                'widget': {
                    'type': 'object',
                    'required': ['id', 'role_id'],
                    'x-import-key': ['role.name'],
                    'properties': {
                        'id': {'type': 'string', 'pattern': '^c[a-z0-9]{24,}$'},
                        'role_id': _fk_field('role', label=fk_label),
                    },
                },
                'widget_detail': {
                    'x-generate': {'list': True, 'view': True, 'new': True, 'edit': True, 'api': True},
                    'allOf': [{'$ref': '#/definitions/widget'}],
                },
            }
        }

    def test_red_labelfield_diverges_from_dotted_key_field_errors(self):
        """FK labelField='id' but dotted key says 'role.name' → the display
        column is 'role_id', not 'role_name' → invisible → error."""
        schema = self._schema(fk_label='id')
        with pytest.raises(SchemaValidationError, match='E_IMPORT_KEY_INVISIBLE'):
            validate_schema(schema)

    def test_red_composite_labelfield_excludes_display_col_errors(self):
        """FK labelField is a list (composite) → excluded from
        x_relationships_list entirely (cmd_351) → no display col at all → error."""
        schema = self._schema(fk_label=['name', 'code'])
        with pytest.raises(SchemaValidationError, match='E_IMPORT_KEY_INVISIBLE'):
            validate_schema(schema)

    def test_green_labelfield_matches_dotted_key_field_passes(self):
        schema = self._schema(fk_label='name')
        validate_schema(schema)  # must not raise


# ---------------------------------------------------------------------------
# E_COMPOSITE_KEY_AMBIGUOUS_LABEL
# ---------------------------------------------------------------------------

class TestCompositeKeyAmbiguousLabel:
    def _schema(self, flow_import_key, request_label='entity_name'):
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
                    'x-import-key': flow_import_key,
                    'properties': {
                        'id': {'type': 'string', 'pattern': '^c[a-z0-9]{24,}$'},
                        'entity_name': {'type': 'string'},
                        'approver_role_id': _fk_field('role', label='name'),
                    },
                },
                'approval_request': {
                    'type': 'object',
                    'required': ['id', 'approval_flow_id'],
                    'properties': {
                        'id': {'type': 'string', 'pattern': '^c[a-z0-9]{24,}$'},
                        'approval_flow_id': _fk_field('approval_flow', label=request_label),
                    },
                },
            }
        }

    def test_red_composite_key_target_referenced_by_single_field_label_errors(self):
        """approval_flow keyed on [entity_name, approver_role.name]; referenced
        via labelField='entity_name' (one of the two parts) → ambiguous."""
        schema = self._schema(flow_import_key=['entity_name', 'approver_role.name'])
        with pytest.raises(SchemaValidationError, match='E_COMPOSITE_KEY_AMBIGUOUS_LABEL'):
            validate_schema(schema)

    def test_green_non_composite_target_key_passes(self):
        """approval_flow keyed on a SINGLE field → not composite → no ambiguity."""
        schema = self._schema(flow_import_key=['entity_name'])
        validate_schema(schema)  # must not raise

    def test_green_label_not_a_component_of_composite_key_does_not_false_positive(self):
        """labelField doesn't match ANY part of the composite key (e.g. 'id') —
        this check only flags when the label matches a NAMED part of the key;
        a wholly independent (and presumably unique) label is not this failure
        mode."""
        schema = self._schema(
            flow_import_key=['entity_name', 'approver_role.name'],
            request_label='id',
        )
        validate_schema(schema)  # must not raise
