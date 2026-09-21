"""Issue #696, state-transition Stage 1 PR1:
`validate_state_machine_diagram`-equivalent checks inside `validate_schema()`
for the 3 `x-state-machines` precondition cases that do not require reading a
pointed-to `.mmd` file's own contents (states/edges) — see
state-transition-generator-design.md's diagram-validation table:

  (i)   pointer entry names a field that does not exist on the model, or is
        not an enum-compatible type
  (ii)  two pointer entries name the same (model, field) pair (ambiguous)
  (iii) Case E — entity carries a pointer entry AND
        import_service_call_feasible is False ("Import and scheduled
        execution" in the design doc's existing-mechanism-boundary section)

Plus: the pointer map's own absence is a no-op (the design's opt-in
guarantee).

Fixtures use a single, non-split `widget` definitions entry unless a test's
own docstring says otherwise (the (ii) alias test needs a genuine raw/view
split to exercise the '__' collision). Every named PR1 opt-in target
(shipment_line, goods_receipt, goods_receipt_line) is in fact a Stage-4
raw/view-split entity in its real schema (app-template/inventory-app
develop, confirmed by generating each one's actual intermediate schema) —
an earlier version of this comment claimed the opposite ("a single
definitions entry, no split"), which was never checked against the real
schemas and was wrong. `TestRealSchemaShapes` below uses trimmed but
structurally faithful (real raw/view split, real key placement) fixtures
for exactly these three entities so the split shape is exercised directly,
not just abstractly via `widget`.
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
    """Zero entities carry x-state-machines yet, anywhere (the design's
    opt-in guarantee) — the pointer map's own absence must never be
    flagged."""

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
    """Case E: entity carries a pointer entry, import IS possible for it, and
    that import path would also have to carry a bridge or an embedded child
    it can't converge through the service layer.

    Correction (this entity's own doubt, raised and confirmed against the
    real generator's output): import-ineligibility alone is no longer a
    rejection reason. `generate.py` only writes
    `app/api/<entity>/import/route.ts` when `import_eligible` is true — an
    entity with no import route has no unconverged raw-transaction branch
    for Case E to guard against in the first place, so rejecting it bought
    nothing. This was checked by generating a real target entity's actual
    output directory and confirming no `import/` route exists there when
    `import_eligible` is false; the earlier test below asserted the
    opposite (reject) purely from the formula's shape, never against a
    real generated tree."""

    def test_not_import_eligible_passes(self):
        """No x-import-key at all -- import_eligible is false, so there is no
        import route and nothing for Case E to guard against."""
        schema = {
            'definitions': {
                'widget': _widget(status_field=_ENUM_STATUS, with_import=False),
            },
            'x-state-machines': {'widget.status': 'sm/x.mmd'},
        }
        validate_schema(schema)  # must not raise

    def test_new_and_edit_both_false_caught_by_import_key_eligibility_not_case_e(self):
        """x-import-key present but both new and edit disabled: import_eligible
        is false here too (no create/update route to receive imported rows),
        so Case E itself does not fire -- but this exact shape is already
        rejected by a separate, pre-existing, more specific check
        (E_IMPORT_KEY_NOT_ELIGIBLE, in validate_import_eligibility) that
        fires on the same underlying fact (x-import-key declared with no
        route able to use it). Confirmed by running this fixture and reading
        the actual error raised, not assumed from the E_IMPORT_KEY_NOT_ELIGIBLE
        name alone."""
        schema = {
            'definitions': {
                'widget': _widget(
                    status_field=_ENUM_STATUS,
                    extra={'x-generate': {'list': True, 'view': True, 'new': False, 'edit': False, 'api': True}},
                ),
            },
            'x-state-machines': {'widget.status': 'sm/x.mmd'},
        }
        with pytest.raises(SchemaValidationError, match='E_IMPORT_KEY_NOT_ELIGIBLE') as excinfo:
            validate_schema(schema)
        assert 'Case E' not in str(excinfo.value)

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


class TestRealSchemaShapes:
    """The three named PR1 opt-in targets (shipment_line, goods_receipt,
    goods_receipt_line), as trimmed-but-structurally-faithful copies of
    their REAL intermediate schema shape — generated with this repo's own
    `build_user_schema.py` against app-template's and inventory-app's real
    develop-branch `json_schema.yaml`/`schema.prisma` and inspected directly
    (not reconstructed from memory or from the design doc's prose). Every
    fixture here is a genuine Stage-4 raw/view split: scalar/FK properties
    and Category C keys (x-import-key, x-approval-lines) on the '__'-raw
    entity, x-generate/x-relationships and any embedded-child array
    property on the bare view entity's own allOf extension -- exactly the
    shape the properties-merge fix above exists to handle correctly.

    Trimmed fields (removed only where irrelevant to Case E's own
    computation: unrelated FK columns, x-display/x-nav, non-status enum
    values) -- the raw/view split shape, key placement, and every field
    Case E actually reads are kept faithful to the real schemas."""

    def test_goods_receipt_rejected_import_eligible_with_writable_child(self):
        """goods_receipt (app-template develop): x-import-key present (new/
        edit both true) -- import-eligible -- AND embeds `lines`
        (goods_receipt_line, x-generate.new/edit/delete all false -- no
        write path of its own) only on the VIEW's allOf extension. Before
        the properties-merge fix, `lines` was invisible (read off the raw
        entity alone) and this entity wrongly passed Case E -- reproduced
        directly here against the real schema shape."""
        schema = {
            'definitions': {
                '__goods_receipt': {
                    'type': 'object',
                    'required': ['id', 'receipt_no'],
                    'properties': {
                        'id': {'type': 'string', 'pattern': '^c[a-z0-9]{24,}$'},
                        'receipt_no': {'type': 'string'},
                        'status': {'type': 'string', 'enum': ['draft', 'confirmed', 'cancelled']},
                    },
                    'x-import-key': ['receipt_no'],
                    'x-approval-lines': ['lines'],
                },
                'goods_receipt': {
                    'allOf': [
                        {'$ref': '#/definitions/__goods_receipt'},
                        {
                            'type': 'object',
                            'required': ['lines'],
                            'properties': {
                                'lines': {'type': 'array', 'items': {'$ref': '#/definitions/goods_receipt_line'}},
                            },
                        },
                    ],
                    'x-generate': {'list': True, 'view': True, 'new': True, 'edit': True, 'delete': True, 'api': True, 'invalidate': False, 'test': True},
                },
                '__goods_receipt_line': {
                    'type': 'object',
                    'required': ['id', 'goods_receipt_id'],
                    'properties': {
                        'id': {'type': 'string', 'pattern': '^c[a-z0-9]{24,}$'},
                        'goods_receipt_id': {'type': 'string'},
                        'status': {'type': 'string', 'enum': ['pending', 'split', 'rejected']},
                    },
                },
                'goods_receipt_line': {
                    'allOf': [{'$ref': '#/definitions/__goods_receipt_line'}],
                    'x-generate': {'list': True, 'view': True, 'new': False, 'edit': False, 'delete': False, 'api': False, 'invalidate': False, 'test': True},
                },
            },
            'x-state-machines': {'goods_receipt.status': 'sm/goods_receipt_status.mmd'},
        }
        with pytest.raises(SchemaValidationError, match='Case E') as excinfo:
            validate_schema(schema)
        assert 'embedded child' in str(excinfo.value)

    def test_goods_receipt_line_passes_not_import_eligible(self):
        """goods_receipt_line (app-template develop): no x-import-key of its
        own -- import_eligible is false -- so it must pass regardless of the
        embedded-child fix above. goods_receipt_line's real generated output
        has no import/ route at all (confirmed by running generate.py
        against the real schema), reproduced here as a schema-level
        fixture."""
        schema = {
            'definitions': {
                '__goods_receipt': {
                    'type': 'object',
                    'required': ['id', 'receipt_no'],
                    'properties': {
                        'id': {'type': 'string', 'pattern': '^c[a-z0-9]{24,}$'},
                        'receipt_no': {'type': 'string'},
                        'status': {'type': 'string', 'enum': ['draft', 'confirmed', 'cancelled']},
                    },
                    'x-import-key': ['receipt_no'],
                    'x-approval-lines': ['lines'],
                },
                'goods_receipt': {
                    'allOf': [
                        {'$ref': '#/definitions/__goods_receipt'},
                        {
                            'type': 'object',
                            'required': ['lines'],
                            'properties': {
                                'lines': {'type': 'array', 'items': {'$ref': '#/definitions/goods_receipt_line'}},
                            },
                        },
                    ],
                    'x-generate': {'list': True, 'view': True, 'new': True, 'edit': True, 'delete': True, 'api': True, 'invalidate': False, 'test': True},
                },
                '__goods_receipt_line': {
                    'type': 'object',
                    'required': ['id', 'goods_receipt_id'],
                    'properties': {
                        'id': {'type': 'string', 'pattern': '^c[a-z0-9]{24,}$'},
                        'goods_receipt_id': {'type': 'string'},
                        'status': {'type': 'string', 'enum': ['pending', 'split', 'rejected']},
                    },
                    # no x-import-key -- goods_receipt_line has no import route at all
                },
                'goods_receipt_line': {
                    'allOf': [
                        {'$ref': '#/definitions/__goods_receipt_line'},
                        {'type': 'object', 'properties': {
                            'goods_receipt': {'$ref': '#/definitions/goods_receipt'},
                        }},
                    ],
                    'x-generate': {'list': True, 'view': True, 'new': False, 'edit': False, 'delete': False, 'api': False, 'invalidate': False, 'test': True},
                },
            },
            'x-state-machines': {'goods_receipt_line.status': 'sm/goods_receipt_line_status.mmd'},
        }
        validate_schema(schema)  # must not raise

    def test_shipment_line_passes_import_eligible_no_writable_child(self):
        """shipment_line (inventory-app develop): x-import-key present (new/
        edit both true) -- import-eligible -- but has no embedded child of
        its own (only scalar/FK fields plus FK label $refs on the view
        extension, no array property). Exercises the properties-merge fix
        on a real split entity that must still pass -- confirms the fix is
        not overly broad."""
        schema = {
            'definitions': {
                'item': {
                    'type': 'object',
                    'required': ['id', 'sku'],
                    'properties': {
                        'id': {'type': 'string', 'pattern': '^c[a-z0-9]{24,}$'},
                        'sku': {'type': 'string'},
                    },
                    'x-generate': {'list': True, 'view': True, 'new': True, 'edit': True, 'delete': True, 'api': True, 'invalidate': False, 'test': True},
                },
                '__shipment': {
                    'type': 'object',
                    'required': ['id', 'shipment_number'],
                    'properties': {
                        'id': {'type': 'string', 'pattern': '^c[a-z0-9]{24,}$'},
                        'shipment_number': {'type': 'string'},
                        'status': {'type': 'string', 'enum': ['pending', 'shipped', 'delivered', 'cancelled']},
                    },
                    'x-import-key': ['shipment_number'],
                },
                'shipment': {
                    'allOf': [
                        {'$ref': '#/definitions/__shipment'},
                        {'type': 'object', 'required': ['shipment_lines'], 'properties': {
                            'shipment_lines': {'type': 'array', 'items': {'$ref': '#/definitions/shipment_line'}},
                        }},
                    ],
                    'x-generate': {'list': True, 'view': True, 'new': True, 'edit': True, 'delete': True, 'api': True, 'invalidate': False, 'search': True, 'test': True},
                    'x-relationships': {'shipment_lines': {'type': 'one-to-many', 'target': 'shipment_line', 'labelField': 'item.sku'}},
                },
                '__shipment_line': {
                    'type': 'object',
                    'required': ['id', 'shipment_id', 'item_id', 'quantity_shipped'],
                    'properties': {
                        'id': {'type': 'string', 'pattern': '^c[a-z0-9]{24,}$'},
                        'shipment_id': {'type': 'string', 'x-relationship': {'type': 'many-to-one', 'target': 'shipment', 'labelField': 'shipment_number'}},
                        'item_id': {'type': 'string', 'x-relationship': {'type': 'many-to-one', 'target': 'item', 'labelField': 'sku'}},
                        'quantity_shipped': {'type': 'integer'},
                        'status': {'type': 'string', '_prisma_native_enum_type': 'ShipmentLineStatus', 'enum': ['picked', 'packed']},
                    },
                    'x-import-key': ['item.sku', 'shipment.shipment_number'],
                },
                'shipment_line': {
                    'allOf': [
                        {'$ref': '#/definitions/__shipment_line'},
                        {'type': 'object', 'properties': {
                            'shipment': {'$ref': '#/definitions/shipment'},
                            'item': {'$ref': '#/definitions/item'},
                        }},
                    ],
                    'x-generate': {'list': True, 'view': True, 'new': True, 'edit': True, 'delete': True, 'api': True, 'invalidate': False, 'search': False, 'test': False},
                },
            },
            'x-state-machines': {'shipment_line.status': 'sm/shipment_line_status.mmd'},
        }
        validate_schema(schema)  # must not raise
