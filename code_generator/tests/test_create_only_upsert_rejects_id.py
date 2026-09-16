"""
Regression test (cmd_999): an entity with `x-generate.edit: false` (create
only, no update path) must not silently create a duplicate row when its
generated Server Action is called with an existing record's id.

Before this fix, the create-only branch of `actions_context`'s upsert body
(generators.py `_upsert_body`, `else: # create only`) never read `id` off
the incoming FormData at all -- it unconditionally called `add{Parent}()`.
form_upsert.tsx.jinja2's FormUpsert.tsx unconditionally sets
`formData.set('id', src.id)` regardless of can_update, so an orphaned edit
page (left over from before this entity's x-generate.edit flipped to false,
and no longer regenerated) that still renders FormUpsert.tsx with an
existing record could reach the create-only action with a real id -- and
the action would silently create a duplicate instead of failing loudly
(the purchase_order/PO-DEMO-025 incident, cmd_999).

The fix mirrors the existing can_update-only branch's symmetric
`if (!id) throw new Error('Create not supported');` guard: a create-only
body now reads `id` first and throws `Error('Update not supported')` if
it is present. `src.id` is `''` for a genuine new-entity form
(page_new.tsx), so the normal create path is unaffected.

Run:
    cd code_generator && python3 -m pytest tests/test_create_only_upsert_rejects_id.py -v
"""
from pathlib import Path

from jinja2 import Environment, FileSystemLoader

from build_context import build_context
from generators import actions_context


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


def _render_actions(can_update: bool) -> str:
    schema = _schema(can_update)
    ctx = build_context(_entity(can_update), schema)
    act_ctx = {**ctx, **actions_context(ctx)}
    env = Environment(
        loader=FileSystemLoader(Path(__file__).parent.parent / 'templates'),
        trim_blocks=True,
        lstrip_blocks=True,
    )
    return env.get_template('actions.ts.jinja2').render(**act_ctx)


def _upsert_function_body(rendered: str) -> str:
    start = rendered.index('export async function upsertWidget')
    end = (
        rendered.index('export async function', start + 1)
        if 'export async function' in rendered[start + 1:]
        else len(rendered)
    )
    return rendered[start:end]


def test_create_only_upsert_rejects_id():
    """edit:false entity: upsertWidget() must throw when handed an id
    instead of silently calling addWidget() and creating a duplicate."""
    rendered = _render_actions(can_update=False)
    body = _upsert_function_body(rendered)

    assert "const id = data.get('id') as string | null;" in body, (
        f'Expected the create-only body to read `id` off FormData. Got:\n{body}'
    )
    assert "if (id) throw new Error('Update not supported');" in body, (
        f'Expected the create-only body to reject a non-empty id instead '
        f'of silently creating. Got:\n{body}'
    )
    assert 'await addWidget(' in body, (
        f'Expected the create-only body to still call addWidget() for the '
        f'normal (no-id) create path. Got:\n{body}'
    )
    assert 'await updateWidget(' not in body, (
        f'edit:false must never call updateWidget() -- no update path is '
        f'generated for this entity. Got:\n{body}'
    )


def test_create_only_upsert_guard_precedes_permission_check():
    """The id guard must run before requirePermission()/create-only work
    begins, so an update-intent request is rejected immediately rather than
    partially processed."""
    rendered = _render_actions(can_update=False)
    body = _upsert_function_body(rendered)

    guard_idx = body.index("if (id) throw new Error('Update not supported');")
    perm_idx = body.index("requirePermission('widget', 'create')")
    assert guard_idx < perm_idx, (
        f'Expected the id guard to precede the create permission check. '
        f'Got:\n{body}'
    )


def test_editable_entity_upsert_body_unaffected():
    """edit:true entity (can_create and can_update both true): this fix
    only touches the create-only (`else`) branch of `_upsert_body` -- an
    editable entity's rendered body must be byte-for-byte unchanged, with
    no id-rejection guard and no `'Update not supported'` string at all."""
    rendered = _render_actions(can_update=True)
    body = _upsert_function_body(rendered)

    assert "if (id) throw new Error('Update not supported');" not in body, (
        f'The create-only id-rejection guard must not leak into an '
        f'editable entity\'s upsert body. Got:\n{body}'
    )
    assert 'await updateWidget(' in body
    assert 'await addWidget(' in body
