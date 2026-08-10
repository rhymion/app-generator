"""
Regression test (cmd_632): an org-scoped entity whose `organization`
relationship is OPTIONAL must still be updatable/deletable by its own
creator after being created without an organization.

Before this fix, upsert{{Parent}}()'s pre-permission existence check
(generators.py's `_actor_and_existing_block`, used by the org-scoped branches
of `actions_context`'s upsert body) unconditionally filtered on
`organization_id: { in: _orgIds } }`. Prisma/SQL's `IN (...)` never matches
NULL, so once cmd_611/612 made `organization` optional on create, a record
created without an organization became permanently un-updatable — every
future `upsert{{Parent}}()` call for that id threw `Error('Not found')`,
even for its own creator (surfaced as cmd_632's parent1 3.3 "Error: Not
found" failure).

`remove{{Parent}}()` (actions.ts.jinja2) and the read-scope getters
(getters.ts.jinja2) already branch on `org_relationship_optional` to add an
`OR: [..., { organization_id: null }]` clause — this fix wires the same
already-computed `org_relationship_optional` context value into the upsert
existence check, so all three (create/update, delete, read) treat a null
organization consistently. Required-org entities are unaffected:
`org_relationship_optional` is False there, so the OR-null branch never
renders (organization_id is never null for those).

Run:
    cd code_generator && python3 -m pytest tests/test_org_optional_update_existence_check.py -v
"""
from pathlib import Path

from jinja2 import Environment, FileSystemLoader

from build_context import build_context
from generators import actions_context


def _schema(organization_required: bool) -> dict:
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
            'required': ['id', 'name'] + (['organization_id'] if organization_required else []),
            'properties': {
                'id': {'type': 'string', 'pattern': '^c[a-z0-9]{24,}$'},
                'name': {'type': 'string', 'minLength': 1},
                'organization_id': {
                    'type': ['string', 'null'] if not organization_required else 'string',
                    'pattern': '^c[a-z0-9]{24,}$',
                    'x-relationship': {
                        'type': 'many-to-one', 'target': 'organization', 'labelField': 'name',
                    },
                },
            },
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


def _render_actions(organization_required: bool) -> str:
    schema = _schema(organization_required)
    ctx = build_context(_entity('widget'), schema)
    act_ctx = {**ctx, **actions_context(ctx)}
    env = Environment(
        loader=FileSystemLoader(Path(__file__).parent.parent / 'templates'),
        trim_blocks=True,
        lstrip_blocks=True,
    )
    return env.get_template('actions.ts.jinja2').render(**act_ctx)


def _upsert_function_body(rendered: str) -> str:
    start = rendered.index('export async function upsertWidget')
    end = rendered.index('export async function', start + 1) if 'export async function' in rendered[start + 1:] else len(rendered)
    return rendered[start:end]


def test_org_optional_update_existence_check_admits_null_org():
    """Optional-organization entity: upsertWidget()'s pre-permission existence
    check must admit organization_id IS NULL rows too, or a record created
    without an org can never be found/updated again by anyone, including its
    own creator (cmd_632 parent1 3.3 repro)."""
    rendered = _render_actions(organization_required=False)
    upsert_body = _upsert_function_body(rendered)

    assert (
        "OR: [{ organization_id: { in: _orgIds } }, { organization_id: null }]"
        in upsert_body
    ), (
        f'Expected the OR-null branch in the existence check for an '
        f'optional-org entity. Got:\n{upsert_body}'
    )


def test_org_required_update_existence_check_still_strict():
    """Required-organization entity: no OR-null branch — organization_id is
    never null there, so the plain `{ in: _orgIds } }` filter is correct and
    unchanged (matches remove{{Parent}}()'s existing org_relationship_optional
    branch shape)."""
    rendered = _render_actions(organization_required=True)
    upsert_body = _upsert_function_body(rendered)

    assert "organization_id: { in: _orgIds } }" in upsert_body
    assert "organization_id: null" not in upsert_body


def test_org_optional_update_existence_check_unconditional_no_actor_org_guard():
    """The OR-null branch must NOT be gated on `_orgIds.length > 0`.

    cmd_632 first tried that guard (mirroring search_helpers.ts.jinja2's
    `associatedOrgIds.length > 0`), but it broke the exact case this fix
    targets: the default seeded test session-user has zero org memberships
    too (org membership is only established by tasks that explicitly create
    one), so gating on actor-org-count denied the record's own creator, not
    just strangers — reproduced empirically via cmd_632's parent1 UI 3.3
    re-run. Every other org_relationship_optional call site (remove<Parent>()
    in actions.ts.jinja2, get<Parent>Detail() in getters.ts.jinja2, the CSV
    import route in api_import_route.ts.jinja2) already uses this same
    unconditional shape — search is the outlier, not the model to copy here."""
    rendered = _render_actions(organization_required=False)
    upsert_body = _upsert_function_body(rendered)

    assert "_orgIds.length > 0" not in upsert_body, (
        f'The OR-null branch must be unconditional (no actor-org-count '
        f'guard) to match the codebase\'s established org_relationship_'
        f'optional convention and avoid locking out a record\'s own '
        f'creator. Got:\n{upsert_body}'
    )


def test_org_optional_update_existence_check_deviation_injection():
    """Deviation injection: without the fix, the existence check always used
    the plain (non-OR) shape regardless of org_relationship_optional — confirm
    that pre-fix shape is no longer what's rendered for an optional-org
    entity, not just that some OR-containing string is present somewhere."""
    rendered = _render_actions(organization_required=False)
    upsert_body = _upsert_function_body(rendered)

    pre_fix_unconditional = (
        "const existing = await prisma.widget.findFirst({ where: { id, organization_id: { in: _orgIds } }, "
    )
    assert pre_fix_unconditional not in upsert_body, (
        'Pre-fix unconditional (non-OR-null) existence check shape is still '
        'being rendered for an optional-org entity — the fix was not applied.'
    )
