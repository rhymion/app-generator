"""cmd_1124/subtask_1124c: an import-eligible entity carrying a writable
embedded DataGrid child (e.g. goods_receipt.lines) now converges through
service.ts the same way a childless entity already did (cmd_996, Issue
#93) -- the entity-level "Case E" ban that used to block this combination
is gone (see test_validate_state_machine_precondition.py's
TestFormerCaseIII_* class), and this file covers the actual convergence
implementation those tests assume but don't exercise: build_context.py's
import_service_call_feasible no longer treats a non-empty
child_params_for_add/_for_update as a blocker, and the generated import
route passes an empty array/id-list literal for every such child on both
create and update (a CSV row has no column that could express nested child
rows, so "no children on import" -- the exact behavior the old raw-tx
fallback already had -- is preserved, just reached through
add/update{Parent} instead of a bare tx.model.create/update).

A new-form x-bridge parent-selection field (bridge_child_params_str) is
NOT covered by this convergence -- that stays on the unconverged raw-tx
fallback (out of this task's scope; see build_context.py's
import_service_call_feasible). Regression-tested here too, so a future
change can't silently fold bridge in without a deliberate decision.

Fixture: goods_receipt (app-template develop's real shape, trimmed) --
the same schema test_validate_state_machine_precondition.py's
TestRealSchemaShapes uses for Case E, reused here at the build_context()/
template level.
"""
from build_context import build_context


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
    Used to block import_service_call_feasible entirely; now converges."""

    def test_import_service_call_feasible_true_despite_writable_child(self):
        ctx = build_context(_goods_receipt_entity(), _goods_receipt_schema())
        assert ctx['child_params_for_add'], (
            'fixture sanity check: goods_receipt.lines must actually be a '
            'write_ch member (non-empty child_params_for_add) or this test '
            'proves nothing about the convergence-despite-a-child case'
        )
        assert ctx['import_service_call_feasible'] is True

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
        # The unconverged branch's actual commit code (`await
        # prisma.$transaction(async (tx) => {`) must not appear -- a
        # descriptive comment mentioning the OTHER branch's mechanism by
        # name, inside the converged branch's own explanatory comment, is
        # fine and expected (see api_import_route.ts.jinja2's `{% if
        # import_service_call_feasible %}` comment block).
        assert 'await prisma.$transaction(async (tx) =>' not in rendered
        assert 'await tx.goods_receipt.create(' not in rendered
        assert 'await tx.goods_receipt.update(' not in rendered

    def test_governed_field_stays_writable_not_locked(self):
        """Once converged, `status` flows through add/updateGoodsReceipt
        (validateOnAdd/Update) like any other field -- the field-level
        import_state_machine_locked_fields carve-out (for entities that
        stay on the unconverged fallback) must NOT apply here."""
        ctx = build_context(_goods_receipt_entity(), _goods_receipt_schema())
        assert 'status' not in ctx['import_unimportable_columns']
        assert any(spec['name'] == 'status' for spec in ctx['import_field_specs'])


class TestBridgeChildImportStillDoesNotConverge:
    """A new-form x-bridge parent-selection field is out of this task's
    scope -- must stay on the unconverged raw-tx fallback, with the
    field-level lockdown still guarding its governed field."""

    def test_import_service_call_feasible_false(self):
        ctx = build_context(_widget_entity(), _bridge_schema())
        assert ctx['bridge_child_params_str'], (
            'fixture sanity check: widget must actually carry a bridge '
            'parent-selection param or this test proves nothing about the '
            'bridge-stays-unconverged case'
        )
        assert ctx['import_service_call_feasible'] is False

    def test_governed_field_locked_out_of_writable_import_columns(self):
        ctx = build_context(_widget_entity(), _bridge_schema())
        assert 'status' in ctx['import_unimportable_columns']
        assert not any(spec['name'] == 'status' for spec in ctx['import_field_specs'])

    def test_rendered_route_uses_raw_tx_and_write_locked_duplicate(self):
        ctx = build_context(_widget_entity(), _bridge_schema())
        rendered = _render_import_route(ctx)
        assert 'prisma.$transaction' in rendered
        assert 'await addWidget' not in rendered
