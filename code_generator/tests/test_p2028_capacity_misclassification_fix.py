"""
Regression test: service.ts.jinja2's addEntity/updateEntity catch blocks
must route Prisma P2028 (transaction/connection-pool timeout, "Unable to
start a transaction in the given time.") to AppError('CAPACITY', ...) (HTTP
409), not fall through into the generic
`PrismaClientKnownRequestError` -> AppError('VALIDATION', ...) (HTTP 422)
catch-all.

Before this fix, the catch-all treated EVERY PrismaClientKnownRequestError
other than P2002 as a bad-input shape. subtask_1176i's load-test
investigation (cmd_1176) traced Round4/Round6's POST/PUT /api/provider 422s
to exactly this: a real pool-exhaustion condition silently mislabeled as a
field-less client input error. CAPACITY already existed in lib/_errors.ts
("pool / inventory exhausted", mapped to HTTP 409 in
lib/api-auth.ts's APP_ERROR_STATUS_MAP) but was never wired to P2028
detection.

Run:
    cd code_generator && python3 -m pytest tests/test_p2028_capacity_misclassification_fix.py -v
"""
from pathlib import Path

from jinja2 import Environment, FileSystemLoader

from build_context import build_context
from generators import service_context


def _schema() -> dict:
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


def _render_service() -> str:
    schema = _schema()
    ctx = build_context(_entity('widget'), schema)
    svc_ctx = {**ctx, **service_context(ctx, schema)}
    env = Environment(
        loader=FileSystemLoader(Path(__file__).parent.parent / 'templates'),
        trim_blocks=True,
        lstrip_blocks=True,
    )
    return env.get_template('service.ts.jinja2').render(**svc_ctx)


def _function_body(rendered: str, signature_prefix: str) -> str:
    start = rendered.index(signature_prefix)
    end = rendered.index('export async function', start + 1)
    return rendered[start:end]


def _catch_block(fn_body: str) -> str:
    start = fn_body.index('} catch (e) {')
    end = fn_body.index('\n  }\n', start)
    return fn_body[start:end]


P2028_BRANCH = (
    "if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2028') {\n"
    "      throw new AppError('CAPACITY', 'Unable to start a transaction in the given time');\n"
    "    }"
)


def test_add_entity_routes_p2028_to_capacity():
    rendered = _render_service()
    add_body = _function_body(rendered, 'export async function addWidget')
    catch_block = _catch_block(add_body)

    assert P2028_BRANCH in catch_block, (
        f'Expected addWidget() catch block to route P2028 to AppError(\'CAPACITY\', ...). Got:\n{catch_block}'
    )

    p2002_idx = catch_block.index("e.code === 'P2002'")
    p2028_idx = catch_block.index("e.code === 'P2028'")
    validation_idx = catch_block.index("AppError('VALIDATION'")
    assert p2002_idx < p2028_idx < validation_idx, (
        'Expected P2002 check, then P2028 check, then the generic VALIDATION '
        'catch-all, in that order -- each branch throws, so an out-of-order '
        'P2028 check would never be reached.'
    )


def test_update_entity_routes_p2028_to_capacity():
    rendered = _render_service()
    update_body = _function_body(rendered, 'export async function updateWidget')
    catch_block = _catch_block(update_body)

    assert P2028_BRANCH in catch_block, (
        f'Expected updateWidget() catch block to route P2028 to AppError(\'CAPACITY\', ...). Got:\n{catch_block}'
    )

    p2002_idx = catch_block.index("e.code === 'P2002'")
    p2028_idx = catch_block.index("e.code === 'P2028'")
    validation_idx = catch_block.index("AppError('VALIDATION'")
    assert p2002_idx < p2028_idx < validation_idx


def test_p2028_capacity_deviation_injection():
    """Deviation injection: without the fix, P2028 falls straight through
    into the generic PrismaClientKnownRequestError -> VALIDATION catch-all,
    with no P2028-specific branch present at all."""
    rendered = _render_service()
    add_body = _function_body(rendered, 'export async function addWidget')
    catch_block = _catch_block(add_body)

    pre_fix_catch_all = (
        "if (e instanceof Prisma.PrismaClientValidationError || "
        "e instanceof Prisma.PrismaClientKnownRequestError) {\n"
        "      throw new AppError('VALIDATION', 'One or more fields have an invalid value');\n"
        "    }"
    )
    assert pre_fix_catch_all in catch_block, (
        'Expected the generic VALIDATION catch-all to still be present '
        '(P2028 is special-cased ABOVE it, not instead of it).'
    )
    assert "e.code === 'P2028'" in catch_block, (
        'Fix regressed: no P2028-specific branch found -- P2028 would fall '
        'straight through to the generic VALIDATION catch-all again.'
    )
