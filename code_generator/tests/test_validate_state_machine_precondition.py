"""Issue #696, state-transition Stage 1 PR1:
`validate_state_machine_diagram`-equivalent checks inside `validate_schema()`
for the `x-state-machines` precondition cases that do not require reading a
pointed-to `.mmd` file's own contents (states/edges) — see
state-transition-generator-design.md's diagram-validation table:

  (i)   pointer entry names a field that does not exist on the model, or is
        not an enum-compatible type
  (ii)  two pointer entries name the same (model, field) pair (ambiguous)

Plus: the pointer map's own absence is a no-op (the design's opt-in
guarantee).

An entity-level "Case E" check, and later a field-level CSV import lockout
that replaced it, both used to live here / in build_context.py. Both
removed: whether an entity's import route converges and whether one of its
fields can be governed by a state-transition diagram are independent
questions, and transition legality is an ordinary write-path check like
any other constraint — a governed field's CSV column is imported like any
other column, and validateOnAdd/Update is responsible for rejecting a
value that isn't a legal transition target. Former Case E tests below have
been converted to "must not raise" — the exact shapes that used to be
entity-level rejections.

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

# PR2a-2: validate_schema() now reads each x-state-machines pointer entry's
# .mmd file off disk (resolved relative to the current working directory —
# see validate.py's own comment at the read site for why). Every fixture
# below that expects validate_schema() to pass cleanly must therefore have
# a real, valid .mmd file backing its pointer path; chdir-ing each test
# into its own tmp_path keeps these fixture files from leaking between
# tests or colliding with anything real. Tests that expect a
# SchemaValidationError for a reason unrelated to the .mmd file (unknown
# model/field, malformed key, ambiguous pointer) don't need a real file —
# the pointed-to path is never even read for those (malformed-key cases)
# or reading it merely adds a second, harmless error to the same raised
# exception (unknown model/field cases) alongside the one the test's
# `match=` already asserts on.
_VALID_MMD = 'stateDiagram-v2\n[*] --> draft\ndraft --> [*]\n'


@pytest.fixture(autouse=True)
def _sm_tmp_cwd(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)


def _write_mmd(tmp_path, rel_path, content=_VALID_MMD):
    path = tmp_path / rel_path
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content)


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

    def test_native_enum_type_accepted(self, tmp_path):
        """_prisma_native_enum_type also counts as enum-compatible, not just
        a plain 'enum:' list — legacy int-backed nativeEnum fields must not
        be wrongly rejected here."""
        _write_mmd(tmp_path, 'sm/x.mmd')
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

    def test_distinct_fields_on_same_model_not_ambiguous(self, tmp_path):
        _write_mmd(tmp_path, 'sm/a.mmd')
        _write_mmd(tmp_path, 'sm/b.mmd')
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


class TestFormerCaseIII_ImportConvergenceNoLongerGatesStateMachines:
    """These shapes used to trip the entity-level "Case E" rejection: import
    IS possible for the entity, and that import path would also have to
    carry a bridge or an embedded child it can't converge through the
    service layer. Removed: import convergence and state-machine
    governability are independent (see the module docstring and
    validate.py's own comment at the removal site) — every shape below must
    now pass validate_schema() cleanly. The underlying concern (an
    unconverged import route writing a governed field without going through
    validateOnAdd/Update) is closed separately, at the field level, in
    build_context.py."""

    def test_not_import_eligible_passes(self, tmp_path):
        """No x-import-key at all -- import_eligible is false, so there is no
        import route at all."""
        _write_mmd(tmp_path, 'sm/x.mmd')
        schema = {
            'definitions': {
                'widget': _widget(status_field=_ENUM_STATUS, with_import=False),
            },
            'x-state-machines': {'widget.status': 'sm/x.mmd'},
        }
        validate_schema(schema)  # must not raise

    def test_new_and_edit_both_false_caught_by_import_key_eligibility(self):
        """x-import-key present but both new and edit disabled: import_eligible
        is false here too (no create/update route to receive imported rows).
        This exact shape is rejected by a separate, pre-existing, more
        specific check (E_IMPORT_KEY_NOT_ELIGIBLE, in
        validate_import_eligibility) that fires on the same underlying fact
        (x-import-key declared with no route able to use it) -- unrelated to
        the former Case E check, and unaffected by its removal."""
        schema = {
            'definitions': {
                'widget': _widget(
                    status_field=_ENUM_STATUS,
                    extra={'x-generate': {'list': True, 'view': True, 'new': False, 'edit': False, 'api': True}},
                ),
            },
            'x-state-machines': {'widget.status': 'sm/x.mmd'},
        }
        with pytest.raises(SchemaValidationError, match='E_IMPORT_KEY_NOT_ELIGIBLE'):
            validate_schema(schema)

    def test_new_form_bridge_no_longer_errors(self, tmp_path):
        """A structurally valid new-form x-bridge (name/child/parents, per
        validate.py's own object-form requirements — unrelated to state
        machines) used to still trip Case E purely because
        get_new_form_bridge() returned truthy. It no longer does.

        with_import=False here: a bridge child declaring x-import-key with
        import left enabled is now its own, separate, correctly-firing
        E_IMPORT_KEY_NOT_ELIGIBLE case (cmd_1127 — see
        validate_import_eligibility's bridge-child branch) — orthogonal to
        this test's actual concern (state-machine governability doesn't
        care whether the entity is a bridge child), so it's kept out of
        this fixture the same way test_not_import_eligible_passes above
        keeps import out of its own orthogonal concern."""
        _write_mmd(tmp_path, 'sm/x.mmd')
        schema = {
            'definitions': {
                'widget': _widget(
                    status_field=_ENUM_STATUS,
                    with_import=False,
                    extra={'x-bridge': {
                        'name': 'widgetable',
                        'child': 'widget',
                        'parentCardinality': 'exactlyOne',
                        'parents': [{'role': 'owner_hub', 'target': 'owner', 'labelField': 'name'}],
                    }},
                ),
                'widgetable': {
                    'type': 'object',
                    'required': ['id'],
                    'properties': {'id': {'type': 'string', 'pattern': '^c[a-z0-9]{24,}$'}},
                },
                'owner': {
                    'type': 'object',
                    'required': ['id', 'name'],
                    'properties': {
                        'id': {'type': 'string', 'pattern': '^c[a-z0-9]{24,}$'},
                        'name': {'type': 'string'},
                    },
                    'x-generate': {'list': True, 'view': True, 'new': True, 'edit': True, 'delete': True, 'api': True},
                },
            },
            'x-state-machines': {'widget.status': 'sm/x.mmd'},
        }
        validate_schema(schema)  # must not raise

    def test_writable_embedded_child_no_longer_errors(self, tmp_path):
        """widget.lines embeds widget_line, which has no x-generate of its
        own (no independent write path) — the parent's own service function
        must nested-create/update it, tripping child_params_for_add/update
        non-emptiness (build_context.py write_ch). This no longer blocks
        widget.status from carrying a state-transition pointer."""
        _write_mmd(tmp_path, 'sm/x.mmd')
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
        validate_schema(schema)  # must not raise

    def test_independent_child_still_passes(self, tmp_path):
        """widget_line has its OWN x-generate (new/edit/delete all true) --
        never blocked either way, before or after the removal."""
        _write_mmd(tmp_path, 'sm/x.mmd')
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

    def test_import_eligible_no_bridge_no_children_passes(self, tmp_path):
        _write_mmd(tmp_path, 'sm/x.mmd')
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

    def test_goods_receipt_import_eligible_with_writable_child_passes(self, tmp_path):
        """goods_receipt (app-template develop): x-import-key present (new/
        edit both true) -- import-eligible -- AND embeds `lines`
        (goods_receipt_line, x-generate.new/edit/delete all false -- no
        write path of its own) only on the VIEW's allOf extension. This
        used to trip the entity-level Case E rejection (a properties-merge
        fix was needed just to see `lines` and reject correctly); now that
        Case E is removed, this exact shape must pass -- goods_receipt.status
        can carry a state-transition pointer regardless of the embedded
        child. The narrower concern this used to guard (the import route's
        unconverged raw-tx fallback writing `status` without going through
        validateOnAdd/Update) is closed separately at the field level in
        build_context.py, not here."""
        _write_mmd(tmp_path, 'sm/goods_receipt_status.mmd')
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
        validate_schema(schema)  # must not raise

    def test_goods_receipt_line_passes_not_import_eligible(self, tmp_path):
        """goods_receipt_line (app-template develop): no x-import-key of its
        own -- import_eligible is false -- so it must pass regardless of the
        embedded-child fix above. goods_receipt_line's real generated output
        has no import/ route at all (confirmed by running generate.py
        against the real schema), reproduced here as a schema-level
        fixture."""
        _write_mmd(tmp_path, 'sm/goods_receipt_line_status.mmd')
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

    def test_shipment_line_passes_import_eligible_no_writable_child(self, tmp_path):
        """shipment_line (inventory-app develop): x-import-key present (new/
        edit both true) -- import-eligible -- but has no embedded child of
        its own (only scalar/FK fields plus FK label $refs on the view
        extension, no array property). Exercises the properties-merge fix
        on a real split entity that must still pass -- confirms the fix is
        not overly broad."""
        _write_mmd(tmp_path, 'sm/shipment_line_status.mmd')
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


class TestDiagramContentChecks:
    """PR2a-2: the five 己-table checks that require reading the pointed-to
    .mmd file's own contents — unreachable state, dead-end state, duplicate
    edge, stale-ref state, and Case D (x-approval structural conflict) —
    plus the file-not-found precondition PR2a-2's own diagram-reading step
    introduces (not one of the 己 table's 8 rows itself, but a necessary
    precondition for reading any of them). Every case here must fail
    generate-code (validate_schema() raising SchemaValidationError, the
    same mechanism generate() uses to sys.exit(1) with no partial output)."""

    def test_missing_mmd_file_errors(self):
        # Deliberately not written via _write_mmd — the whole point of this
        # test is that the file does not exist.
        schema = {
            'definitions': {'widget': _widget(status_field=_ENUM_STATUS)},
            'x-state-machines': {'widget.status': 'sm/does_not_exist.mmd'},
        }
        with pytest.raises(SchemaValidationError, match='does not exist'):
            validate_schema(schema)

    def test_unreachable_state_errors(self, tmp_path):
        """'orphan' has an outgoing edge but no incoming edge from any
        initial state — unreachable no matter how the graph is walked."""
        _write_mmd(tmp_path, 'sm/x.mmd', (
            'stateDiagram-v2\n'
            '[*] --> draft\n'
            'draft --> submitted\n'
            'submitted --> [*]\n'
            'orphan --> submitted\n'
        ))
        schema = {
            'definitions': {'widget': _widget(status_field=_ENUM_STATUS)},
            'x-state-machines': {'widget.status': 'sm/x.mmd'},
        }
        with pytest.raises(SchemaValidationError, match='unreachable'):
            validate_schema(schema)

    def test_dead_end_without_terminal_errors(self, tmp_path):
        """'submitted' has no outgoing edge and is never marked terminal
        ('submitted --> [*]') — an accidentally forgotten transition, not
        intentionally final."""
        _write_mmd(tmp_path, 'sm/x.mmd', (
            'stateDiagram-v2\n'
            '[*] --> draft\n'
            'draft --> submitted\n'
        ))
        schema = {
            'definitions': {'widget': _widget(status_field=_ENUM_STATUS)},
            'x-state-machines': {'widget.status': 'sm/x.mmd'},
        }
        with pytest.raises(SchemaValidationError, match='dead-end'):
            validate_schema(schema)

    def test_duplicate_edge_errors(self, tmp_path):
        """Two edges declared between the exact same (fromState, toState)
        pair — nothing can disambiguate which one's condition/effect
        should apply."""
        _write_mmd(tmp_path, 'sm/x.mmd', (
            'stateDiagram-v2\n'
            '[*] --> draft\n'
            'draft --> submitted\n'
            'draft --> submitted\n'
            'submitted --> [*]\n'
        ))
        schema = {
            'definitions': {'widget': _widget(status_field=_ENUM_STATUS)},
            'x-state-machines': {'widget.status': 'sm/x.mmd'},
        }
        with pytest.raises(SchemaValidationError, match='duplicate edge'):
            validate_schema(schema)

    def test_stale_ref_state_via_monkeypatched_parser(self, tmp_path, monkeypatch):
        """The real parser (state_machine_parser.py) can never itself
        produce a StateMachineDiagram with an edge endpoint missing from
        `states` — every bare edge's endpoints are added to `states` as a
        side effect of parsing it, so no real .mmd text can exercise this
        branch. Monkeypatches parse_state_machine_diagram to return a
        hand-built, deliberately inconsistent StateMachineDiagram instead,
        to exercise validate.py's own defensive check directly. See
        validate.py's comment at the stale-ref check site for why this
        check is kept despite being unreachable via the real parser today."""
        import validate
        from helpers.state_machine_parser import StateMachineDiagram

        _write_mmd(tmp_path, 'sm/x.mmd')  # content irrelevant, parser is patched
        monkeypatch.setattr(
            validate, 'parse_state_machine_diagram',
            lambda _text: StateMachineDiagram(
                states={'draft', 'submitted'},
                edges=[('draft', 'submitted'), ('submitted', 'ghost')],
                initial_states={'draft'},
                terminal_states={'submitted'},
            ),
        )
        schema = {
            'definitions': {'widget': _widget(status_field=_ENUM_STATUS)},
            'x-state-machines': {'widget.status': 'sm/x.mmd'},
        }
        with pytest.raises(SchemaValidationError, match='undeclared state'):
            validate.validate_schema(schema)

    def test_case_d_state_not_in_approval_legal_set_errors(self, tmp_path):
        """widget also declares x-approval (submit_on -> 'submitted',
        on_approved.set_fields -> 'approved', on_rejected.set_fields ->
        'rejected'); the diagram's own pre-submission default ('draft') is
        legal too, but 'archived' is structurally impossible under
        x-approval's own declared stages — Case D must reject it."""
        _write_mmd(tmp_path, 'sm/x.mmd', (
            'stateDiagram-v2\n'
            '[*] --> draft\n'
            'draft --> submitted\n'
            'submitted --> approved\n'
            'approved --> archived\n'
            'archived --> [*]\n'
        ))
        widget = _widget(status_field={
            'type': 'string',
            'enum': ['draft', 'submitted', 'approved', 'rejected', 'archived'],
            'default': 'draft',
        })
        widget['x-approval'] = {
            'submit_on': {'status': 'submitted'},
            'on_approved': {'set_fields': {'status': 'approved'}},
            'on_rejected': {'set_fields': {'status': 'rejected'}},
        }
        schema = {
            'definitions': {'widget': widget},
            'x-state-machines': {'widget.status': 'sm/x.mmd'},
        }
        with pytest.raises(SchemaValidationError, match='Case D'):
            validate_schema(schema)

    def test_case_d_legal_states_including_default_pass(self, tmp_path):
        """Positive control for the above: a diagram using ONLY x-approval's
        own legal state set (submit_on/on_approved/on_rejected values plus
        the field's own pre-submission default) must not trip Case D."""
        _write_mmd(tmp_path, 'sm/x.mmd', (
            'stateDiagram-v2\n'
            '[*] --> draft\n'
            'draft --> submitted\n'
            'submitted --> approved\n'
            'submitted --> rejected\n'
            'approved --> [*]\n'
            'rejected --> [*]\n'
        ))
        widget = _widget(status_field={
            'type': 'string',
            'enum': ['draft', 'submitted', 'approved', 'rejected'],
            'default': 'draft',
        })
        widget['x-approval'] = {
            'submit_on': {'status': 'submitted'},
            'on_approved': {'set_fields': {'status': 'approved'}},
            'on_rejected': {'set_fields': {'status': 'rejected'}},
        }
        schema = {
            'definitions': {'widget': widget},
            'x-state-machines': {'widget.status': 'sm/x.mmd'},
        }
        validate_schema(schema)  # must not raise
