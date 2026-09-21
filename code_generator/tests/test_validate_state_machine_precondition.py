"""Issue #696, state-transition Stage 1 PR1 (cmd_1121):
`validate_state_machine_diagram`-equivalent checks inside `validate_schema()`
for the 3 `x-state-machines` precondition cases that do not require reading a
pointed-to `.mmd` file's own contents (states/edges) — see
state-transition-generator-design.md 己's table:

  (i)   pointer entry names a field that does not exist on the model, or is
        not an enum-compatible type
  (ii)  two pointer entries name the same (model, field) pair (ambiguous)
  (iii) Case E — entity carries a pointer entry AND
        import_service_call_feasible is False (丙 "Import and scheduled
        execution")

Plus: the pointer map's own absence is a no-op (opt-in guarantee, 庚).

Fixtures use a single, non-split `widget` definitions entry unless a test's
own docstring says otherwise (the (ii) alias test needs a genuine raw/view
split to exercise the '__' collision) — matching the shape every named PR1
opt-in target uses (shipment_line, goods_receipt, goods_receipt_line): a
single definitions entry, no Stage-4 raw/view split.
"""
import pytest
from validate import validate_schema, SchemaValidationError


def _widget(status_field=None, extra=None, with_import=True, with_generate=True):
    props = {
        'id': {'type': 'string', 'pattern': '^c[a-z0-9]{24,}$'},
        'code': {'type': 'string'},
    }
    if status_field is not None:
        props['status'] = status_field
    defn = {'type': 'object', 'required': ['id', 'code'], 'properties': props}
    if with_import:
        defn['x-import-key'] = ['code']
    if with_generate:
        defn['x-generate'] = {'list': True, 'view': True, 'new': True, 'edit': True, 'api': True}
    if extra:
        defn.update(extra)
    return defn


_ENUM_STATUS = {'type': 'string', 'enum': ['draft', 'submitted', 'approved']}


class TestNoOpWhenAbsent:
    """Zero entities carry x-state-machines yet, anywhere (庚's opt-in
    guarantee) — the pointer map's own absence must never be flagged."""

    def test_no_pointer_map_at_all_passes(self):
        schema = {'definitions': {'widget': _widget(status_field=_ENUM_STATUS)}}
        validate_schema(schema)  # must not raise

    def test_empty_pointer_map_passes(self):
        schema = {
            'definitions': {'widget': _widget(status_field=_ENUM_STATUS)},
            'x-state-machines': {},
        }
        validate_schema(schema)  # must not raise


class TestMalformedTopLevelShape:
    def test_non_mapping_pointer_map_errors(self):
        schema = {
            'definitions': {'widget': _widget(status_field=_ENUM_STATUS)},
            'x-state-machines': ['widget.status'],
        }
        with pytest.raises(SchemaValidationError, match='x-state-machines must be a mapping'):
            validate_schema(schema)

    def test_key_without_dot_errors(self):
        schema = {
            'definitions': {'widget': _widget(status_field=_ENUM_STATUS)},
            'x-state-machines': {'widgetstatus': 'sm/widget_status.mmd'},
        }
        with pytest.raises(SchemaValidationError, match=r"must be of the form '\{model\}\.\{field\}'"):
            validate_schema(schema)


class TestCaseI_FieldExistenceAndType:
    def test_unknown_model_errors(self):
        schema = {
            'definitions': {'widget': _widget(status_field=_ENUM_STATUS)},
            'x-state-machines': {'nonexistent.status': 'sm/x.mmd'},
        }
        with pytest.raises(SchemaValidationError, match="model 'nonexistent' does not exist"):
            validate_schema(schema)

    def test_unknown_field_errors(self):
        schema = {
            'definitions': {'widget': _widget(status_field=_ENUM_STATUS)},
            'x-state-machines': {'widget.nope': 'sm/x.mmd'},
        }
        with pytest.raises(SchemaValidationError, match="has no field 'nope'"):
            validate_schema(schema)

    def test_non_enum_type_errors(self):
        schema = {
            'definitions': {'widget': _widget(status_field={'type': 'boolean'})},
            'x-state-machines': {'widget.status': 'sm/x.mmd'},
        }
        with pytest.raises(SchemaValidationError, match='with no declared enum values'):
            validate_schema(schema)

    def test_native_enum_type_accepted(self):
        """_prisma_native_enum_type also counts as enum-compatible, not just
        a plain 'enum:' list — legacy int-backed nativeEnum fields must not
        be wrongly rejected here."""
        schema = {
            'definitions': {
                'widget': _widget(status_field={
                    'type': 'string',
                    '_prisma_native_enum_type': 'WidgetStatus',
                }),
            },
            'x-state-machines': {'widget.status': 'sm/x.mmd'},
        }
        validate_schema(schema)  # must not raise (Case E also clean, see below)


class TestCaseII_AmbiguousPointerEntries:
    """Two distinct x-state-machines keys resolving to the same (model,
    field) pair via the raw/view '__' split alias."""

    def test_raw_and_view_alias_collide(self):
        schema = {
            'definitions': {
                '__widget': _widget(status_field=_ENUM_STATUS),
                'widget': {
                    'x-generate': {'list': True, 'view': True, 'new': True, 'edit': True, 'api': True},
                    'allOf': [{'$ref': '#/definitions/__widget'}],
                },
            },
            'x-state-machines': {
                'widget.status': 'sm/a.mmd',
                '__widget.status': 'sm/b.mmd',
            },
        }
        with pytest.raises(SchemaValidationError, match='all name the same \\(model, field\\) pair'):
            validate_schema(schema)

    def test_distinct_fields_on_same_model_not_ambiguous(self):
        widget = _widget(status_field=_ENUM_STATUS)
        widget['properties']['stage'] = dict(_ENUM_STATUS)
        schema = {
            'definitions': {'widget': widget},
            'x-state-machines': {
                'widget.status': 'sm/a.mmd',
                'widget.stage': 'sm/b.mmd',
            },
        }
        validate_schema(schema)  # must not raise


class TestCaseIII_ImportServiceCallFeasibility:
    """Case E: entity carries a pointer entry AND import_service_call_feasible
    is False."""

    def test_not_import_eligible_errors(self):
        schema = {
            'definitions': {
                'widget': _widget(status_field=_ENUM_STATUS, with_import=False),
            },
            'x-state-machines': {'widget.status': 'sm/x.mmd'},
        }
        with pytest.raises(SchemaValidationError, match='Case E'):
            validate_schema(schema)

    def test_new_and_edit_both_false_errors(self):
        schema = {
            'definitions': {
                'widget': _widget(
                    status_field=_ENUM_STATUS,
                    extra={'x-generate': {'list': True, 'view': True, 'new': False, 'edit': False, 'api': True}},
                ),
            },
            'x-state-machines': {'widget.status': 'sm/x.mmd'},
        }
        with pytest.raises(SchemaValidationError, match='Case E'):
            validate_schema(schema)

    def test_new_form_bridge_errors(self):
        schema = {
            'definitions': {
                'widget': _widget(
                    status_field=_ENUM_STATUS,
                    extra={'x-bridge': {'name': 'widgetable', 'child': 'widget_child'}},
                ),
            },
            'x-state-machines': {'widget.status': 'sm/x.mmd'},
        }
        with pytest.raises(SchemaValidationError, match='new-form x-bridge'):
            validate_schema(schema)

    def test_writable_embedded_child_errors(self):
        """widget.lines embeds widget_line, which has no x-generate of its
        own (no independent write path) — the parent's own service function
        must nested-create/update it, tripping child_params_for_add/update
        non-emptiness (build_context.py write_ch)."""
        widget = _widget(status_field=_ENUM_STATUS)
        widget['properties']['lines'] = {
            'type': 'array',
            'items': {'$ref': '#/definitions/widget_line'},
        }
        schema = {
            'definitions': {
                'widget': widget,
                'widget_line': {
                    'type': 'object',
                    'required': ['id'],
                    'properties': {
                        'id': {'type': 'string', 'pattern': '^c[a-z0-9]{24,}$'},
                        'widget_id': {'type': 'string'},
                    },
                },
            },
            'x-state-machines': {'widget.status': 'sm/x.mmd'},
        }
        with pytest.raises(SchemaValidationError, match='embedded child'):
            validate_schema(schema)

    def test_independent_child_does_not_trip_case_e(self):
        """widget_line has its OWN x-generate (new/edit/delete all true) —
        child_has_own_write_capability() is True, so is_independent=True,
        nested_writable=False, and (not m2m, not self-ref, not an optional
        FK list) use_connect=False too -- this child must NOT count as a
        write-path child for Case E."""
        widget = _widget(status_field=_ENUM_STATUS)
        widget['properties']['lines'] = {
            'type': 'array',
            'items': {'$ref': '#/definitions/widget_line'},
        }
        schema = {
            'definitions': {
                'widget': widget,
                'widget_line': {
                    'type': 'object',
                    'required': ['id'],
                    'x-generate': {'list': True, 'view': True, 'new': True, 'edit': True, 'delete': True},
                    'properties': {
                        'id': {'type': 'string', 'pattern': '^c[a-z0-9]{24,}$'},
                        'widget_id': {'type': 'string'},
                    },
                },
            },
            'x-state-machines': {'widget.status': 'sm/x.mmd'},
        }
        validate_schema(schema)  # must not raise

    def test_import_eligible_no_bridge_no_children_passes(self):
        schema = {
            'definitions': {'widget': _widget(status_field=_ENUM_STATUS)},
            'x-state-machines': {'widget.status': 'sm/x.mmd'},
        }
        validate_schema(schema)  # must not raise
