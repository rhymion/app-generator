"""
Regression test: service.ts.jinja2's addEntity/updateEntity catch blocks
must not classify transient or missing-record Prisma codes as client input
errors (AppError('VALIDATION', ...), HTTP 422):

- P2034 (write conflict under Serializable isolation) -> CAPACITY (409)
- P2037 (too many database connections)               -> CAPACITY (409)
- P2025 (required record not found)                   -> NOT_FOUND (404)

Each branch must sit after P2002 and before the generic
PrismaClientKnownRequestError -> VALIDATION catch-all, which must remain
for genuinely input-shaped codes.

Run:
    cd code_generator && python3 -m pytest tests/test_prisma_transient_codes_classification_fix.py -v
"""
import pytest

from test_p2028_capacity_misclassification_fix import (
    _catch_block,
    _function_body,
    _render_service,
)

BRANCHES = {
    'P2034': "AppError('CAPACITY', 'Transaction write conflict, please retry')",
    'P2037': "AppError('CAPACITY', 'Too many database connections')",
    'P2025': "AppError('NOT_FOUND', 'Record not found')",
}

SIGNATURES = ['export async function addWidget', 'export async function updateWidget']


def _expected_branch(code: str) -> str:
    return (
        f"if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === '{code}') {{\n"
        f"      throw new {BRANCHES[code]};\n"
        "    }"
    )


@pytest.mark.parametrize('signature', SIGNATURES)
@pytest.mark.parametrize('code', sorted(BRANCHES))
def test_code_is_routed_before_validation_catch_all(signature, code):
    catch_block = _catch_block(_function_body(_render_service(), signature))

    assert _expected_branch(code) in catch_block, (
        f'Expected {signature} catch block to special-case {code}. Got:\n{catch_block}'
    )
    assert (
        catch_block.index("e.code === 'P2002'")
        < catch_block.index(f"e.code === '{code}'")
        < catch_block.index("AppError('VALIDATION'")
    ), f'{code} must be checked after P2002 and before the VALIDATION catch-all.'


@pytest.mark.parametrize('signature', SIGNATURES)
def test_generic_validation_catch_all_still_handles_other_codes(signature):
    """Deviation injection: the catch-all stays for input-shaped codes
    (P2003 FK, P2011 null constraint, ...); the new branches sit above it."""
    catch_block = _catch_block(_function_body(_render_service(), signature))

    assert (
        "if (e instanceof Prisma.PrismaClientValidationError || "
        "e instanceof Prisma.PrismaClientKnownRequestError) {\n"
        "      throw new AppError('VALIDATION', 'One or more fields have an invalid value');\n"
        "    }"
    ) in catch_block
    for code in ('P2003', 'P2011', 'P2000'):
        assert f"e.code === '{code}'" not in catch_block
