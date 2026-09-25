"""
SQL safety lint — confirms generated *.ts files under lib/ do not use
forbidden raw-SQL APIs.

Run AFTER generate-code so that lib/**/*.ts is up-to-date.
If no generated files exist, the test is skipped with an explanatory message.

issue #737 (raw SQL / unsafe-API audit) found this check inert in practice:
CI's `pytest` job (see .github/workflows/ci.yml) runs `pytest
code_generator/tests` on a bare checkout with no `generate-code` step, so
`lib/` never has generated output for this glob to match and the test
always skips there — it has never once actually executed against real
content in CI. The check that *does* enforce this in the mandatory gate
(and in CI's e2e-tests job, which does run generate-code first) is
`code_generator/check_generated.py` (`npm run check:generated`, gate step
15) — its `raw:*` rules cover the same ground plus an auditable allowlist
for legitimate safe-tagged-template exceptions (see
check_generated_allowlist.yaml). This test remains as a second, narrower
signal for whoever runs `pytest code_generator/tests` locally after
`generate-code`/`test:e2e:build` — useful, but not something the gate or
CI can rely on by itself.
"""
import glob
import os
import pytest

# $executeRawUnsafe( was missing here before issue #737 — PR #727's
# `tx.$executeRawUnsafe('SET LOCAL ...')` would have slipped past this list
# even if the file-glob gap below hadn't already made the test skip.
#
# Each pattern includes its call-opening `(` deliberately: a bare substring
# match (no trailing `(`) also matches these names inside an explanatory
# comment saying *why* the code avoids them — exactly the kind of comment
# issue #737 asks generator templates to carry (see db_init.ts.jinja2's own
# header) — which would make writing that documentation itself a lint
# failure. Requiring the call-opening paren matches only an actual
# invocation, the same distinction check_generated.py's regexes draw by
# requiring a preceding `<identifier>.`.
FORBIDDEN = ['$queryRawUnsafe(', '$executeRawUnsafe(', 'Prisma.raw(']

_GENERATED_ROOT = os.path.join(os.path.dirname(__file__), '..', '..', 'lib')


def _generated_ts_files():
    # Was 'service.ts' only before issue #737 — too narrow to ever see
    # lib/db-init.ts or lib/search/helpers.ts (schema-wide generated files,
    # not scoped under a single entity's own directory; PR #727's unsafe
    # call lived in the search helper). '**/*.ts' covers every generated
    # (and hand-maintained) file directly under lib/.
    pattern = os.path.join(_GENERATED_ROOT, '**', '*.ts')
    return glob.glob(pattern, recursive=True)


def test_no_unsafe_raw_sql():
    """Generated lib/**/*.ts files must not contain forbidden raw-SQL APIs."""
    files = _generated_ts_files()
    if not files:
        pytest.skip('No generated *.ts found under lib/ — run generate-code first')

    violations = []
    for path in files:
        content = open(path).read()
        for forbidden in FORBIDDEN:
            if forbidden in content:
                violations.append(f"Forbidden SQL API '{forbidden}' found in {path}")

    assert not violations, '\n'.join(violations)
