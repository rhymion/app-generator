"""
Regression test: commit 98391aa2 narrowed actions.ts.jinja2's
getAssociatedOrganizations import condition from `should_filter_by_org and
(can_create or can_update or can_delete)` to `should_filter_by_org and
can_delete`, reasoning that "the only call site lives inside the
can_delete branch" (remove{Parent}'s _assocOrgs lookup).

That reasoning missed a second call site: upsert{Parent}'s update branch
(the `if (id) { ... }` half of _upsert_body) also calls
getAssociatedOrganizations via generators.py's _actor_and_existing_block
whenever should_filter_by_org and can_update -- regardless of can_delete.
_upsert_body's output reaches the template only as the opaque
`{{ upsert_body }}` placeholder, so a plain text search of
actions.ts.jinja2 for "getAssociatedOrganizations" never surfaces this
call site.

Real-world impact: any should_filter_by_org, can_update, NOT can_delete
entity (a common x-approval shape -- approvable records are typically
undeletable) renders an upsert{Parent} that references
getAssociatedOrganizations with no import, i.e. `next build`'s TypeScript
check fails with TS2304. Confirmed against a real consumer schema: five
should_filter_by_org/can_update/not-can_delete entities broke this way
after the pointer bump landed bdb8473a -> edf66060.

Run:
    cd code_generator && python3 -m pytest tests/test_actions_ts_getassociatedorgs_import_scope.py -v
"""
from pathlib import Path

from jinja2 import Environment, FileSystemLoader

from build_context import build_context
from generators import actions_context


def _schema() -> dict:
    defs: dict = {
        '__organization': {
            'type': 'object',
            'required': ['id', 'name'],
            'properties': {
                'id': {'type': 'string', 'pattern': '^c[a-z0-9]{24,}$'},
                'name': {'type': 'string', 'minLength': 1},
            },
        },
        'organization': {
            'x-generate': {
                'list': True, 'view': True, 'new': True, 'edit': True,
                'delete': True, 'api': True, 'test': True,
            },
            'allOf': [{'$ref': '#/definitions/__organization'}],
        },
        '__widget': {
            'type': 'object',
            'required': ['id', 'name', 'organization_id'],
            'properties': {
                'id': {'type': 'string', 'pattern': '^c[a-z0-9]{24,}$'},
                'name': {'type': 'string', 'minLength': 1},
                'organization_id': {
                    'type': 'string',
                    'pattern': '^c[a-z0-9]{24,}$',
                    'x-relationship': {
                        'type': 'many-to-one', 'target': 'organization', 'labelField': 'name',
                    },
                },
            },
        },
        'widget': {
            'x-generate': {
                # edit (update) allowed, delete NOT allowed -- the
                # undeletable-approvable shape that triggered the
                # regression.
                'list': True, 'view': True, 'new': False, 'edit': True,
                'delete': False, 'api': True, 'test': True,
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
            'list': True, 'view': True, 'new': False, 'edit': True,
            'delete': False, 'api': True, 'test': True, 'fields': None,
        },
    }


def _render_actions() -> tuple[str, dict]:
    schema = _schema()
    ctx = build_context(_entity('widget'), schema)
    act_ctx = {**ctx, **actions_context(ctx)}
    env = Environment(
        loader=FileSystemLoader(Path(__file__).parent.parent / 'templates'),
        trim_blocks=True,
        lstrip_blocks=True,
    )
    return env.get_template('actions.ts.jinja2').render(**act_ctx), act_ctx


def test_updateonly_org_scoped_entity_imports_getassociatedorgs():
    """should_filter_by_org + can_update + NOT can_delete (the common
    undeletable-approvable shape) must still import getAssociatedOrganizations
    -- upsert{Parent}'s update branch calls it even though remove{Parent}
    (gated on can_delete) does not exist for this entity."""
    rendered, act_ctx = _render_actions()

    assert act_ctx['should_filter_by_org'] is True
    assert act_ctx['can_update'] is True
    assert act_ctx['can_delete'] is False
    assert 'getAssociatedOrganizations(' in rendered, (
        'upsert{Parent} calls getAssociatedOrganizations via '
        '_actor_and_existing_block but the rendered actions.ts has no '
        'call site at all -- fixture no longer reproduces the regression '
        'shape, update the fixture.'
    )
    assert "import { getAssociatedOrganizations } from '@/lib/organization/getters_associated';" in rendered, (
        'getAssociatedOrganizations is called in the rendered output with '
        'no import -- this is the TS2304 regression (commit 98391aa2 '
        'narrowed the import condition to should_filter_by_org and '
        'can_delete, missing the should_filter_by_org and can_update case).'
    )
