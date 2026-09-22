"""cmd_1124/subtask_1124c: an import-eligible entity carrying a writable
embedded DataGrid child (e.g. goods_receipt.lines) now converges through
service.ts the same way a childless entity already did (cmd_996, Issue
#93) -- the entity-level "Case E" ban that used to block this combination
is gone (see test_validate_state_machine_precondition.py's
TestFormerCaseIII_* class), and this file covers the actual convergence
implementation those tests assume but don't exercise: build_context.py's
import route generation no longer treats a non-empty
child_params_for_add/_for_update as a blocker, and the generated import
route passes an empty array/id-list literal for every such child on both
create and update (a CSV row has no column that could express nested child
rows, so "no children on import" -- the exact behavior the old raw-tx
fallback already had -- is preserved, just reached through
add/update{Parent} instead of a bare tx.model.create/update).

cmd_1127: a new-form x-bridge parent-selection field
(bridge_child_params_str) is excluded from import_eligible entirely (not
merely kept unconverged) -- a bridge child's parent is selected via
selectedParentType/selectedParentId at create time, never through a
physical FK column, so CSV export never emits a column that could satisfy
it on import. There is no remaining unconverged-import case: every entity
that reaches import_eligible=True converges through add/update{Parent}.
Regression-tested here too, so a future change can't silently make a
bridge child import-eligible without a deliberate decision.

Fixture: goods_receipt (app-template develop's real shape, trimmed) --
the same schema test_validate_state_machine_precondition.py's
TestRealSchemaShapes uses for Case E, reused here at the build_context()/
template level.
"""
import pytest
from build_context import build_context


# PR2b (Issue #696 Stage 1): build_context() now reads and parses each
# x-state-machines pointer entry's .mmd file off disk (previously -- PR1 --
# it only recorded which (model, field) pairs were governed, as a name set,
# with no file I/O) -- see build_context.py's state_machine_diagrams
# comment. Every fixture below whose schema carries an x-state-machines
# pointer therefore needs a real, valid .mmd file backing it, matching that
# fixture's own status enum; chdir-ing into tmp_path (same convention as
# test_validate_state_machine_precondition.py) keeps these files from
# leaking between tests.
@pytest.fixture(autouse=True)
def _sm_tmp_cwd(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    sm_dir = tmp_path / 'sm'
    sm_dir.mkdir()
    (sm_dir / 'goods_receipt_status.mmd').write_text(
        'stateDiagram-v2\n'
        '[*] --> draft\n'
        'draft --> confirmed\n'
        'draft --> cancelled\n'
        'confirmed --> [*]\n'
        'cancelled --> [*]\n'
    )
    (sm_dir / 'widget_status.mmd').write_text(
        'stateDiagram-v2\n'
        '[*] --> draft\n'
        'draft --> submitted\n'
        'submitted --> approved\n'
        'approved --> [*]\n'
    )


def _goods_receipt_schema(with_state_machine: bool = True) -> dict:
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
                'x-generate': {
                    'list': True, 'view': True, 'new': True, 'edit': True, 'delete': True,
                    'api': True, 'invalidate': False, 'test': True,
                },
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
                'x-generate': {
                    'list': True, 'view': True, 'new': False, 'edit': False, 'delete': False,
                    'api': False, 'invalidate': False, 'test': True,
                },
            },
        },
    }
    if with_state_machine:
        schema['x-state-machines'] = {'goods_receipt.status': 'sm/goods_receipt_status.mmd'}
    return schema


def _goods_receipt_entity() -> dict:
    return {
        'parent': 'goods_receipt',
        'model': 'goods_receipt',
        'definition_key': 'goods_receipt',
        'children': [
            {'name': 'goods_receipt_line', 'property_name': 'lines',
             'output_type': None, 'file_type': None, 'relationship': None},
        ],
        'generate_config': {
            'list': True, 'view': True, 'new': True, 'edit': True,
            'delete': True, 'api': True, 'test': True, 'fields': None,
        },
    }


def _bridge_schema() -> dict:
    """A new-form x-bridge parent-selection shape (out of this task's
    scope) -- child_params_for_add/_for_update are irrelevant here since
    the blocker is bridge_child_params_str, not an embedded child."""
    return {
        'definitions': {
            'owner': {
                'type': 'object',
                'required': ['id', 'name'],
                'properties': {
                    'id': {'type': 'string', 'pattern': '^c[a-z0-9]{24,}$'},
                    'name': {'type': 'string'},
                },
                'x-generate': {'list': True, 'view': True, 'new': True, 'edit': True, 'delete': True, 'api': True},
            },
            'widgetable': {
                'type': 'object',
                'required': ['id'],
                'properties': {'id': {'type': 'string', 'pattern': '^c[a-z0-9]{24,}$'}},
            },
            '__widget': {
                'type': 'object',
                'required': ['id', 'code'],
                'properties': {
                    'id': {'type': 'string', 'pattern': '^c[a-z0-9]{24,}$'},
                    'code': {'type': 'string'},
                    'status': {'type': 'string', 'enum': ['draft', 'submitted', 'approved']},
                },
                'x-import-key': ['code'],
                'x-bridge': {
                    'name': 'widgetable',
                    'child': 'widget',
                    'parentCardinality': 'exactlyOne',
                    'parents': [{'role': 'owner_hub', 'target': 'owner', 'labelField': 'name'}],
                },
            },
            'widget': {
                'allOf': [{'$ref': '#/definitions/__widget'}],
                'x-generate': {'list': True, 'view': True, 'new': True, 'edit': True, 'delete': True, 'api': True},
            },
        },
        'x-state-machines': {'widget.status': 'sm/widget_status.mmd'},
    }


def _widget_entity() -> dict:
    return {
        'parent': 'widget',
        'model': 'widget',
        'definition_key': 'widget',
        'children': [],
        'generate_config': {
            'list': True, 'view': True, 'new': True, 'edit': True,
            'delete': True, 'api': True, 'test': True, 'fields': None,
        },
    }


def _render_import_route(ctx: dict) -> str:
    from generate import _make_env
    env = _make_env()
    return env.get_template('api_import_route.ts.jinja2').render(**ctx)


class TestEmbeddedChildImportConverges:
    """goods_receipt: import-eligible, writable embedded child (`lines`).
    Used to block convergence entirely; now converges."""

    def test_import_eligible_true_despite_writable_child(self):
        ctx = build_context(_goods_receipt_entity(), _goods_receipt_schema())
        assert ctx['child_params_for_add'], (
            'fixture sanity check: goods_receipt.lines must actually be a '
            'write_ch member (non-empty child_params_for_add) or this test '
            'proves nothing about the convergence-despite-a-child case'
        )
        assert ctx['import_eligible'] is True

    def test_import_service_child_args_is_empty_array_literal_per_child(self):
        ctx = build_context(_goods_receipt_entity(), _goods_receipt_schema())
        assert ctx['import_service_child_args'] == '[]'

    def test_rendered_route_calls_service_functions_with_empty_child_array(self):
        ctx = build_context(_goods_receipt_entity(), _goods_receipt_schema())
        rendered = _render_import_route(ctx)
        assert "import { addGoodsReceipt, updateGoodsReceipt } from '@/lib/goods_receipt/service';" in rendered
        # CSV rows can't express nested child rows -- `lines` must be an
        # explicit empty array on both create and update, not omitted
        # (omitting it would be a TS2554 arity mismatch against
        # add/updateGoodsReceipt's declared signature). update{{Parent}}'s
        # own signature ends in srcSnapshotRaw, so the create call's line
        # ends in the empty-array literal but the update call's line ends
        # in `, null);` with the empty array immediately before it.
        assert 'await addGoodsReceipt(actorId,' in rendered
        assert 'await updateGoodsReceipt(actorId, action.id,' in rendered
        for line in rendered.splitlines():
            if 'await addGoodsReceipt(actorId,' in line:
                assert line.rstrip().endswith('[]);'), (
                    f"expected the create call's last argument to be the "
                    f"empty child-array literal, got: {line!r}"
                )
            if 'await updateGoodsReceipt(actorId, action.id,' in line:
                assert line.rstrip().endswith('[], null);'), (
                    f"expected the update call's second-to-last argument "
                    f"to be the empty child-array literal, got: {line!r}"
                )

    def test_no_raw_tx_fallback_emitted(self):
        ctx = build_context(_goods_receipt_entity(), _goods_receipt_schema())
        rendered = _render_import_route(ctx)
        # cmd_1127: the raw-tx fallback branch was deleted from the template
        # entirely (it's unreachable now that every import_eligible entity
        # converges) -- its commit code must not appear.
        assert 'await prisma.$transaction(async (tx) =>' not in rendered
        assert 'await tx.goods_receipt.create(' not in rendered
        assert 'await tx.goods_receipt.update(' not in rendered

    def test_governed_field_not_flagged_unimportable_or_dropped_from_field_specs(self):
        """`status` still flows through add/updateGoodsReceipt
        (validateOnAdd/Update) like any other field at the
        import_unimportable_columns / import_field_specs level -- those two
        mechanisms are unaffected by state-machine governance, and remain
        exactly as they'd be for a plain (non-governed) status field. The
        actual Case E field-level lockout is a separate, narrower mechanism
        (import_state_machine_locked_fields, Issue #696 Stage 1 PR2a-3) --
        see TestStateMachineFieldLevelLockout below, which supersedes this
        test's former claim that "no field-level lockout mechanism applies
        here" (that was true only until PR2a-3 built the mechanism this
        docstring now describes)."""
        ctx = build_context(_goods_receipt_entity(), _goods_receipt_schema())
        assert 'status' not in ctx['import_unimportable_columns']
        assert any(spec['name'] == 'status' for spec in ctx['import_field_specs'])


class TestStateMachineFieldLevelLockout:
    """Issue #696 Stage 1 PR2a-3, "Case E" field-level lockout:
    import_state_machine_locked_fields (build_context.py) excludes a
    state-transition-governed field from the CSV import route's writable
    set, even though the entity itself converges cleanly through
    add/updateGoodsReceipt (Case E's former entity-level ban is gone --
    see the module docstring and TestEmbeddedChildImportConverges above).
    The field remains readable (export_scalar_fields / import_field_specs
    both still carry it, per the test above) -- only the write path is
    closed, at the template's per-row loop that builds `data`, so it can
    never be applied on CREATE or UPDATE regardless of what a CSV cell
    says."""

    def test_locked_fields_populated_when_state_machine_present(self):
        ctx = build_context(_goods_receipt_entity(), _goods_receipt_schema(with_state_machine=True))
        assert ctx['import_state_machine_locked_fields'] == ['status']

    def test_locked_fields_empty_when_no_state_machine_pointer(self):
        """Opt-in guarantee: an identical entity/schema minus the
        x-state-machines pointer must not have any field locked."""
        ctx = build_context(_goods_receipt_entity(), _goods_receipt_schema(with_state_machine=False))
        assert ctx['import_state_machine_locked_fields'] == []

    def test_rendered_route_declares_locked_fields_const(self):
        ctx = build_context(_goods_receipt_entity(), _goods_receipt_schema(with_state_machine=True))
        rendered = _render_import_route(ctx)
        assert 'const STATE_MACHINE_LOCKED_FIELDS: string[] = ["status"];' in rendered
        assert 'if (STATE_MACHINE_LOCKED_FIELDS.includes(spec.name)) continue;' in rendered

    def test_rendered_route_locked_fields_const_empty_without_state_machine(self):
        ctx = build_context(_goods_receipt_entity(), _goods_receipt_schema(with_state_machine=False))
        rendered = _render_import_route(ctx)
        assert 'const STATE_MACHINE_LOCKED_FIELDS: string[] = [];' in rendered


class TestBridgeChildNeverImportEligible:
    """cmd_1127: a new-form x-bridge child's parent is selected via
    selectedParentType/selectedParentId at create time, never through a
    physical FK column -- CSV export never emits a column identifying the
    parent, so there is no information a CSV row could carry to satisfy it
    on import. Such an entity is excluded from import_eligible entirely,
    not merely kept on an unconverged fallback."""

    def test_import_eligible_false_despite_import_key_and_create_edit(self):
        ctx = build_context(_widget_entity(), _bridge_schema())
        assert ctx['bridge_child_params_str'], (
            'fixture sanity check: widget must actually carry a bridge '
            'parent-selection param or this test proves nothing about the '
            'bridge-exclusion case'
        )
        assert ctx['import_eligible'] is False
        assert ctx['import_can_create'] is False
        assert ctx['import_can_update'] is False

    def test_rendered_route_returns_not_supported_stub(self):
        ctx = build_context(_widget_entity(), _bridge_schema())
        rendered = _render_import_route(ctx)
        assert 'ENTITY_IMPORT_NOT_SUPPORTED' in rendered
        assert 'selectedParentType' not in rendered
        assert 'selectedParentId' not in rendered
        assert 'await addWidget(' not in rendered
        assert 'await updateWidget(' not in rendered
        assert 'await tx.widget.create(' not in rendered
        assert 'await tx.widget.update(' not in rendered
