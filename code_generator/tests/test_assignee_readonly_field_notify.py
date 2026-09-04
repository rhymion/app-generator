"""
Regression test for cmd_947: the same #486 (cmd_945) client_prop_infos
exclusion that broke service.ts.jinja2's should_filter_by_org guard
(fixed by cmd_946d / org_id_client_writable -- see
test_org_readonly_field_write_guard.py) also breaks the assignee
notification trigger -- a separate hardcoded reference in the same
template, discovered when the Lord hit it live in proj_h
(service_request_offer_response, which declares assignee_id in
x-readonly-fields).

Root cause: service.ts.jinja2's has_assignee_id-gated notify blocks (both
add{Parent}() and update{Parent}()) reference a raw assigneeId identifier
assuming it is always in scope as a function parameter. Once #486 excludes
a readonly field from parent_params_with_types, assigneeId no longer
exists as a parameter for an entity with assignee_id in x-readonly-fields
-- TS2304, the same failure class as organizationId, just a different
identifier.

Fix direction (the Lord's own guidance, cmd_947): do NOT just delete the
reference (that would silently drop the assignment notification -- "gate
green, harm silent", the worst kind of failure per his own standing
doctrine). Read the value off the PERSISTED row instead of a client
parameter:
  - add{Parent}(): the transaction's returned object now carries
    assignee_id: created.assignee_id; the post-tx notify reads
    result.assignee_id.
  - update{Parent}(): a new _newAssigneeId variable (declared alongside
    the existing _prevAssigneeId, which already read the OLD value from
    the DB) captures updated.assignee_id from the update() call's own
    return value; the post-tx notify reads _newAssigneeId.

This is not merely a compile fix: reading from the row is correct even
when assignee_id IS client-writable, since it reflects whatever actually
landed in the row (a server-driven write, e.g. an x-approval set_fields
side effect during the same update, can still change assignee_id even
when the client-facing parameter cannot) -- so the fix applies
unconditionally, with no readonly/writable branch needed at all.

Run:
    cd code_generator && python3 -m pytest tests/test_assignee_readonly_field_notify.py -v
"""
from pathlib import Path

from jinja2 import Environment, FileSystemLoader

from build_context import build_context
from generators import service_context


def _schema(assignee_id_readonly: bool) -> dict:
    defs: dict = {
        '__user': {
            'type': 'object',
            'required': ['id', 'name'],
            'properties': {
                'id': {'type': 'string', 'pattern': '^c[a-z0-9]{24,}$'},
                'name': {'type': 'string', 'minLength': 1},
            },
        },
        'user': {
            'x-generate': {
                'list': True, 'view': True, 'new': True, 'edit': True,
                'delete': True, 'api': True, 'test': True,
            },
            'allOf': [{'$ref': '#/definitions/__user'}],
        },
        '__ticket': {
            'type': 'object',
            'required': ['id', 'name'],
            'properties': {
                'id': {'type': 'string', 'pattern': '^c[a-z0-9]{24,}$'},
                'name': {'type': 'string', 'minLength': 1},
                'assignee_id': {
                    'type': ['string', 'null'],
                    'pattern': '^c[a-z0-9]{24,}$',
                    'x-relationship': {
                        'type': 'many-to-one', 'target': 'user', 'labelField': 'name',
                    },
                },
            },
        },
        'ticket': {
            'x-generate': {
                'list': True, 'view': True, 'new': True, 'edit': True,
                'delete': True, 'api': True, 'test': True,
            },
            'allOf': [{'$ref': '#/definitions/__ticket'}],
            **({'x-readonly-fields': ['assignee_id']} if assignee_id_readonly else {}),
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


def _render_service(assignee_id_readonly: bool) -> tuple[str, dict]:
    schema = _schema(assignee_id_readonly)
    ctx = build_context(_entity('ticket'), schema)
    svc_ctx = {**ctx, **service_context(ctx, schema)}
    env = Environment(
        loader=FileSystemLoader(Path(__file__).parent.parent / 'templates'),
        trim_blocks=True,
        lstrip_blocks=True,
    )
    return env.get_template('service.ts.jinja2').render(**svc_ctx), svc_ctx


def _function_body(rendered: str, fn_name: str) -> str:
    start = rendered.index(f'export async function {fn_name}')
    end = rendered.index('export async function', start + 1)
    return rendered[start:end]


def _strip_comment_lines(body: str) -> str:
    """Drop `//`-comment-only lines before scanning for a bare identifier
    -- prose (this test file's own docstrings/comments included) may
    legitimately name the old parameter for exposition; only CODE matters
    for TS2304."""
    return '\n'.join(
        line for line in body.splitlines() if not line.strip().startswith('//')
    )


def test_readonly_assignee_id_has_no_bare_parameter_reference():
    """The TS2304 repro: with assignee_id readonly, assigneeId must not
    exist as a parameter or be referenced as code anywhere -- not in the
    function signature, not in the data write, not in the notify guard."""
    rendered, svc_ctx = _render_service(assignee_id_readonly=True)

    assert svc_ctx['has_assignee_id'] is True
    add_code = _strip_comment_lines(_function_body(rendered, 'addTicket'))
    update_code = _strip_comment_lines(_function_body(rendered, 'updateTicket'))

    import re
    bare_ref = re.compile(r'(?<![.\w])assigneeId\b')
    assert not bare_ref.search(add_code), f'Bare assigneeId reference survives in add():\n{add_code}'
    assert not bare_ref.search(update_code), f'Bare assigneeId reference survives in update():\n{update_code}'


def test_readonly_assignee_id_notification_is_not_silently_dropped():
    """The Lord's explicit anti-requirement: fixing the compile error must
    not come at the cost of deleting the notify trigger outright. Both
    add() and update() must still call notify(...) for an assignee change,
    reading the value off the persisted row."""
    rendered, _ = _render_service(assignee_id_readonly=True)
    add_body = _function_body(rendered, 'addTicket')
    update_body = _function_body(rendered, 'updateTicket')

    assert "notify(result.assignee_id, 'assigned'" in add_body
    assert 'result.assignee_id && result.assignee_id !== actorId' in add_body

    assert "notify(_newAssigneeId, 'assigned'" in update_body
    assert '_newAssigneeId && _newAssigneeId !== _prevAssigneeId && _newAssigneeId !== actorId' in update_body
    # The update() call inside the transaction must actually capture the
    # post-write row so _newAssigneeId has something real to read.
    assert 'const updated = await tx.ticket.update(' in update_body
    assert '_newAssigneeId = updated.assignee_id;' in update_body

    # The create-time return value must carry assignee_id so the post-tx
    # notify (which runs outside the transaction closure) has it in scope.
    assert 'assignee_id: created.assignee_id' in rendered
    assert 'assignee_id: string | null' in rendered  # Promise<{...}> return type


def test_writable_assignee_id_also_reads_from_the_row_not_a_stale_param():
    """assignee_id NOT readonly (the common case): the fix applies
    unconditionally -- this is not a readonly-only special case. assigneeId
    still legitimately exists as a parameter here (it has to -- the client
    write itself needs it), but the notify guard specifically must still
    read the persisted row, not that parameter -- it reflects whatever
    actually landed, including any server-driven override."""
    rendered, svc_ctx = _render_service(assignee_id_readonly=False)
    assert svc_ctx['has_assignee_id'] is True

    add_body = _function_body(rendered, 'addTicket')
    update_body = _function_body(rendered, 'updateTicket')

    # The parameter still exists (needed to write the client-supplied value).
    assert 'assigneeId: string | null' in add_body

    # ...but the notify guard reads the row, not the parameter.
    assert "notify(result.assignee_id, 'assigned'" in add_body
    assert 'result.assignee_id && result.assignee_id !== actorId' in add_body
    assert "notify(_newAssigneeId, 'assigned'" in update_body
    assert '_newAssigneeId && _newAssigneeId !== _prevAssigneeId && _newAssigneeId !== actorId' in update_body


def test_readonly_assignee_id_deviation_injection():
    """Deviation injection: the pre-fix shape (a bare assigneeId inside
    the has_assignee_id-gated notify guard, with no row-read fallback) must
    not be what's rendered."""
    rendered, _ = _render_service(assignee_id_readonly=True)

    pre_fix_create_guard = "if (assigneeId && assigneeId !== actorId) {"
    pre_fix_update_guard = "if (assigneeId && assigneeId !== _prevAssigneeId && assigneeId !== actorId) {"
    assert pre_fix_create_guard not in rendered
    assert pre_fix_update_guard not in rendered
