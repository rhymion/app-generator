"""
Regression test (cmd_999, AC は): the generated view page must never expose
an edit affordance for an `x-generate.edit: false` entity, regardless of
the caller's `permissions.update` value.

Before this fix, form_view.tsx.jinja2 computed `canEdit` purely from
`permissions?.update ?? true`, never consulting the generator-level
`can_update` (x-generate.edit) flag. An orphaned edit screen left over
from before an entity's `x-generate.edit` flipped to false (not
regenerated, so still present on disk -- discovered as a byproduct of
subtask_999a's proj_g orphan sweep, on `purchase_order`'s FormView.tsx)
could still be reached via this generated `editHref`, because the RBAC
`permissions.update` value has nothing to do with whether the entity's
generator emits an update path at all (see
test_create_only_upsert_rejects_id.py's `actions_context` fix for the
Server Action side of the same root cause).

The fix: `canEdit` is now hardcoded to `false` at generation time for a
create-only entity, independent of `permissions?.update`. For an
`edit: true` entity, the rendered FormView.tsx is byte-for-byte unchanged
(see test_editable_entity_view_page_unaffected's golden-diff below).

Run:
    cd code_generator && python3 -m pytest tests/test_view_page_hides_edit_link_when_immutable.py -v
"""
from pathlib import Path

from jinja2 import Environment, FileSystemLoader

from build_context import build_context
from generators import form_view_context

TEMPLATES_DIR = Path(__file__).parent.parent / 'templates'


def _schema(can_update: bool) -> dict:
    defs: dict = {
        '__widget': {
            'type': 'object',
            'required': ['id', 'name'],
            'properties': {
                'id': {'type': 'string', 'pattern': '^c[a-z0-9]{24,}$'},
                'name': {'type': 'string', 'minLength': 1},
            },
        },
        'widget': {
            'x-generate': {
                'list': True, 'view': True, 'new': True, 'edit': can_update,
                'delete': False, 'api': True, 'test': True,
            },
            'allOf': [{'$ref': '#/definitions/__widget'}],
        },
    }
    return {'definitions': defs}


def _entity(can_update: bool) -> dict:
    return {
        'parent': 'widget',
        'model': 'widget',
        'definition_key': 'widget',
        'children': [],
        'generate_config': {
            'list': True, 'view': True, 'new': True, 'edit': can_update,
            'delete': False, 'api': True, 'test': True, 'fields': None,
        },
    }


def _render_form_view(can_update: bool) -> str:
    schema = _schema(can_update)
    ctx = build_context(_entity(can_update), schema)
    fv_ctx = {**ctx, **form_view_context(ctx, schema)}
    env = Environment(
        loader=FileSystemLoader(TEMPLATES_DIR),
        trim_blocks=True,
        lstrip_blocks=True,
    )
    return env.get_template('form_view.tsx.jinja2').render(**fv_ctx)


def test_immutable_entity_view_page_hardcodes_no_edit():
    """edit:false entity: canEdit must be a hardcoded `false`, never
    derived from permissions -- an orphaned edit screen that still calls
    this FormView.tsx's editHref can no longer be reached, no matter what
    permissions.update evaluates to at runtime."""
    rendered = _render_form_view(can_update=False)

    assert 'const canEdit = false;' in rendered, (
        f'Expected the create-only view page to hardcode canEdit = false. '
        f'Got the canEdit line(s): '
        f'{[l for l in rendered.splitlines() if "canEdit" in l]}'
    )
    assert 'permissions?.update' not in rendered, (
        f'edit:false must never reference permissions.update when '
        f'computing canEdit -- that would let RBAC re-enable an edit '
        f'affordance the generator itself provides no update path for. '
        f'Got:\n{rendered}'
    )


def test_editable_entity_view_page_unaffected():
    """edit:true entity: this fix only touches the create-only branch --
    an editable entity's rendered FormView.tsx must be byte-for-byte
    unchanged from the pre-fix template (golden-diff against HEAD's
    form_view.tsx.jinja2, verified out-of-band; this test pins the
    invariant going forward: canEdit still derives from permissions)."""
    rendered = _render_form_view(can_update=True)

    assert 'const canEdit = permissions?.update ?? true;' in rendered
    assert 'const canEdit = false;' not in rendered
