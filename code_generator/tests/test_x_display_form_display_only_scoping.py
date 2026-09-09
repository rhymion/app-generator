"""
Regression test (cmd_1007): a field can stay in filtered_props / the
category-classified lists (text_props, enum_str_props, date_time_props,
parent_rels_raw, ...) inside form_upsert_context/form_view_context while
x-display.form (when declared) excludes it from the fields the form actually
renders an editable/visible control for -- e.g. a value the schema still
wants read for submission (an approval-flow field only ever *set* through a
later action, not through this create/edit form) but never shown here.

Before this fix, form_upsert_context/form_view_context built the *display-
only* side effects of such a field -- the setter half of its useState
destructure, its options array, a relation's InitialOptions/SearchAction/
CurrentOption/PermissionDenied hooks (and the component's prop signature
entries feeding them), and import-trigger flags (uses_format_label_value,
has_datetime_props / needs_datetime_wrapper) -- unconditionally, keyed only
off category-list membership, never off whether x-display.form would later
drop the field from _ordered_fields. The field's *getter* is still needed
(it's read by parent_form_data_sets / live_state_var_by_field so the current
value round-trips on submit even though it's not editable here) but nothing
else generated for it was ever referenced, producing ESLint
@typescript-eslint/no-unused-vars warnings.

Real-world impact: confirmed against a real consumer schema (22 warnings
across FormUpsert.tsx/FormView.tsx for customer_return.responsibility/
resolution, inventory_reservation.modification_reason, supplier_return.
shipped_at, goods_receipt_line.inventory_id) -- all entities whose
x-display.form lists a strict subset of their properties, a normal and
already-supported schema-authoring pattern, not a schema bug.

Run:
    cd code_generator && python3 -m pytest tests/test_x_display_form_display_only_scoping.py -v
"""
from pathlib import Path

from jinja2 import Environment, FileSystemLoader

from build_context import build_context
from generators import form_upsert_context, form_view_context


def _schema() -> dict:
    defs: dict = {
        '__widget_target': {
            'type': 'object',
            'required': ['id', 'name'],
            'properties': {
                'id': {'type': 'string', 'pattern': '^c[a-z0-9]{24,}$'},
                'name': {'type': 'string', 'minLength': 1},
            },
        },
        'widget_target': {
            'x-generate': {
                'list': True, 'view': True, 'new': True, 'edit': True,
                'delete': True, 'api': True, 'test': True,
            },
            'allOf': [{'$ref': '#/definitions/__widget_target'}],
        },
        '__widget': {
            'type': 'object',
            'required': ['id', 'reason', 'status'],
            'properties': {
                'id': {'type': 'string', 'pattern': '^c[a-z0-9]{24,}$'},
                # Shown on the form.
                'reason': {'type': 'string', 'enum': ['a', 'b']},
                'status': {'type': 'string', 'enum': ['open', 'closed']},
                # x-display.form-excluded string enum -- set only via a
                # later approval/processing action, never through this
                # create/edit form (mirrors customer_return.responsibility).
                'resolution': {'type': ['string', 'null'], 'enum': ['fixed', 'rejected']},
                # x-display.form-excluded date -- same shape as
                # supplier_return.shipped_at.
                'resolved_at': {'type': ['string', 'null'], 'format': 'date-time'},
                # x-display.form-excluded many-to-one relation -- same shape
                # as goods_receipt_line.inventory_id.
                'target_id': {
                    'type': ['string', 'null'],
                    'pattern': '^c[a-z0-9]{24,}$',
                    'x-relationship': {
                        'type': 'many-to-one', 'target': 'widget_target', 'labelField': 'name',
                    },
                },
            },
            'x-display': {'form': ['reason', 'status']},
        },
        'widget': {
            'x-generate': {
                'list': True, 'view': True, 'new': True, 'edit': True,
                'delete': True, 'api': True, 'test': True,
            },
            'allOf': [{'$ref': '#/definitions/__widget'}],
        },
    }
    return {'definitions': defs}


def _entity(model: str) -> dict:
    return {
        'parent': model,
        'model': model,
        'definition_key': model,
        'children': [],
        'generate_config': {
            'list': True, 'view': True, 'new': True, 'edit': True,
            'delete': True, 'api': True, 'test': True, 'fields': None,
        },
    }


def _env() -> Environment:
    return Environment(
        loader=FileSystemLoader(Path(__file__).parent.parent / 'templates'),
        trim_blocks=True,
        lstrip_blocks=True,
    )


def _render_upsert() -> tuple[str, dict]:
    schema = _schema()
    ctx = build_context(_entity('widget'), schema)
    up_ctx = {**ctx, **form_upsert_context(ctx, schema)}
    rendered = _env().get_template('form_upsert.tsx.jinja2').render(**up_ctx)
    return rendered, up_ctx


def _render_view() -> tuple[str, dict]:
    schema = _schema()
    ctx = build_context(_entity('widget'), schema)
    v_ctx = {**ctx, **form_view_context(ctx, schema)}
    rendered = _env().get_template('form_view.tsx.jinja2').render(**v_ctx)
    return rendered, v_ctx


def test_upsert_excluded_enum_string_keeps_getter_drops_setter_and_options():
    rendered, _ = _render_upsert()

    assert 'const [resolution]' in rendered, (
        "resolution's current value must still round-trip (read by "
        'parent_form_data_sets/live_state_var_by_field) even though the '
        'field is not editable on this form.'
    )
    assert 'setResolution' not in rendered, (
        'resolution is excluded from x-display.form -- nothing renders an '
        'AppFieldSelect for it, so its setter must never be destructured '
        '(ESLint no-unused-vars regression).'
    )
    assert 'resolutionOptions' not in rendered, (
        "resolution's options array is display-only and must not be "
        'emitted when the field is excluded from x-display.form.'
    )
    assert "formData.set('resolution'" in rendered, (
        "resolution's current value must still be submitted."
    )


def test_upsert_excluded_datetime_keeps_dayjs_call_drops_wrapper():
    rendered, _ = _render_upsert()

    assert 'dayjs(src.resolved_at)' in rendered, (
        "resolved_at's getter initializer always parses the value via "
        'dayjs() regardless of display status -- the dayjs import must '
        'stay.'
    )
    assert 'setResolvedAt' not in rendered, (
        'resolved_at is excluded from x-display.form -- its setter must '
        'never be destructured.'
    )
    assert 'DateTimeWrapper' not in rendered, (
        'no field in this fixture renders an editable or readonly '
        'DateTimeWrapper widget -- the import must not appear.'
    )


def test_upsert_excluded_relation_drops_aux_hooks_and_prop_signature():
    rendered, up_ctx = _render_upsert()

    assert 'const [targetId]' in rendered, (
        "target_id's current value must still round-trip for submission."
    )
    assert 'setTargetId' not in rendered
    for aux in ('targetIdInitialOptions', 'targetIdSearchAction', 'targetIdCurrentOption', 'targetIdPermissionDenied'):
        assert aux not in rendered, (
            f'{aux} is only ever referenced from the AppFieldRelation JSX, '
            'which is never rendered for an x-display.form-excluded '
            'relation -- it must not be declared.'
        )
    assert 'initialWidgetTargets' not in up_ctx['form_upsert_params'], (
        'target_id has no other (displayed) path reaching the '
        "widget_target target, so the component's prop signature must not "
        'destructure initialWidgetTargets/searchWidgetTargetOptions either '
        '-- otherwise those become unused parameters instead of unused '
        'locals (the same regression one level up).'
    )
    assert 'searchWidgetTargetOptions' not in up_ctx['form_upsert_params']


def test_view_excluded_enum_string_drops_options_array():
    rendered, _ = _render_view()

    assert 'resolutionOptions' not in rendered, (
        'FormView must not build an options array for a field excluded '
        'from x-display.form -- it never reaches _ordered_fields there '
        'either.'
    )


def test_view_excluded_datetime_drops_wrapper_when_nothing_else_needs_it():
    rendered, v_ctx = _render_view()

    assert v_ctx['needs_datetime_wrapper'] is False, (
        'This fixture has no displayed date field and no other trigger '
        '(flatten/child grid) -- DateTimeWrapper must not be imported.'
    )
    assert 'DateTimeWrapper' not in rendered
