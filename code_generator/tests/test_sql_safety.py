"""
SQL safety lint — confirms generated service.ts files do not use forbidden raw-SQL APIs.

Run AFTER generate-code so that lib/**/service.ts are up-to-date.
If no generated service files exist, the test is skipped with an explanatory message.
"""
import glob
import os
import pytest

FORBIDDEN = ['$queryRawUnsafe', 'Prisma.raw']

_GENERATED_ROOT = os.path.join(os.path.dirname(__file__), '..', '..', 'lib')


def _service_files():
    pattern = os.path.join(_GENERATED_ROOT, '**', 'service.ts')
    return glob.glob(pattern, recursive=True)


def test_no_unsafe_raw_sql():
    """Generated service.ts files must not contain forbidden raw-SQL APIs."""
    service_files = _service_files()
    if not service_files:
        pytest.skip('No generated service.ts found under lib/ — run generate-code first')

    violations = []
    for path in service_files:
        content = open(path).read()
        for forbidden in FORBIDDEN:
            if forbidden in content:
                violations.append(f"Forbidden SQL API '{forbidden}' found in {path}")

    assert not violations, '\n'.join(violations)
