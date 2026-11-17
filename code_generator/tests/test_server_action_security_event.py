"""
Issue #1307: a denial returned by a generated Server Action writes a security event.

On REST every 401/403/429 reaches handleApiError, which writes a `[security-event]`
line. A Server Action instead turns a caught error into an `ActionFailure`; without a
call at that point, a denial thrown by hand (`new AppError('PERMISSION_DENIED', ...)`
in a generated guard, `lib/_fk_reference.ts` or a consumer's
`service_validation_custom.ts`) would never be logged. Every generated catch that
returns an `ActionFailure` must therefore call `logSecurityEventForError(e)` (from
`lib/security-event.ts`, the function handleApiError itself uses) before anything
else.

Runs the real build_user_schema.py -> generate.py pipeline on the default schema
(create / update / delete actions, the account view's credential confirmation) and on
the x-version-of fixture (its submit-for-approval action), then checks every catch
in the generated action modules.

Run:
    cd code_generator && python3 -m pytest tests/test_server_action_security_event.py -v
"""
from pathlib import Path
import re
import shutil

import pytest

from build_user_schema import build_user_schema
from generate import generate
from test_server_function_module_exports import _generate_version_of_fixture

REPO = Path(__file__).resolve().parents[2]

LOG_CALL = 'logSecurityEventForError(e);'
LOG_IMPORT = "import { logSecurityEventForError } from '@/lib/security-event';"
CATCH = re.compile(r'\} catch \(e\) \{\n')


def _run(json_schema: Path, prisma_schema: Path, tmp_path: Path) -> Path:
    prisma_dir = tmp_path / 'prisma'
    prisma_dir.mkdir(parents=True, exist_ok=True)
    shutil.copy(prisma_schema, prisma_dir / 'schema.prisma')
    intermediate = tmp_path / 'generated_json_schema.yaml'
    build_user_schema(json_schema, prisma_schema, intermediate)
    generate(str(intermediate), str(tmp_path))
    return tmp_path


@pytest.fixture(scope='module')
def default_out(tmp_path_factory) -> Path:
    return _run(REPO / 'code_generator' / 'json_schema.yaml', REPO / 'prisma' / 'schema.prisma',
                tmp_path_factory.mktemp('default'))


@pytest.fixture(scope='module')
def approval_out(tmp_path_factory) -> Path:
    # The x-version-of fixture is the one that emits an explicit submit action.
    out = tmp_path_factory.mktemp('version_of')
    _generate_version_of_fixture(out)
    return out / 'gen'


def _action_modules(out: Path) -> list[Path]:
    return sorted(list((out / 'lib').glob('*/actions.ts')) + list((out / 'lib').glob('*/submit_actions.ts')))


def _failure_catches(text: str) -> list[str]:
    """Every `catch (e)` body (up to its closing `throw e;` or the next catch) that returns an ActionFailure."""
    bodies = []
    for m in CATCH.finditer(text):
        rest = text[m.end():]
        end = min(i for i in (rest.find('throw e;'), rest.find('} catch ('), len(rest)) if i != -1)
        body = rest[:end]
        if 'satisfies ActionFailure' in body:
            bodies.append(body)
    return bodies


def _check(out: Path) -> dict[str, int]:
    counts = {}
    for path in _action_modules(out):
        text = path.read_text()
        catches = _failure_catches(text)
        if not catches:
            continue
        rel = str(path.relative_to(out))
        for body in catches:
            code = [ln.strip() for ln in body.split('\n') if ln.strip() and not ln.strip().startswith('//')]
            first = code[0]
            assert first == LOG_CALL, f'{rel}: a catch returns an ActionFailure without logging first:\n{body[:400]}'
        assert LOG_IMPORT in text, f'{rel}: calls logSecurityEventForError without importing it'
        counts[rel] = len(catches)
    return counts


def test_default_schema_actions_log_before_returning_a_failure(default_out):
    counts = _check(default_out)
    # Not vacuous: create/update/delete catches exist on the default entities.
    assert counts, 'no ActionFailure catch found in the generated default actions'
    assert counts.get('lib/role/actions.ts', 0) >= 3


def test_credential_confirmation_catch_logs_the_wrong_current_password(default_out):
    # A wrong current password is ApiError(403) on REST (authz.denied) and is turned
    # into a VALIDATION failure in the account action; it logs the same event.
    text = (default_out / 'lib' / 'setting' / 'actions.ts').read_text()
    block = text[text.index('_credential = await confirmCredentialChange('):]
    block = block[:block.index('throw e;')]
    after_catch = block[block.index('} catch (e) {') + len('} catch (e) {'):].lstrip()
    assert after_catch.startswith(LOG_CALL)


def test_submit_for_approval_action_logs_before_returning_a_failure(approval_out):
    counts = _check(approval_out)
    assert any(k.endswith('/submit_actions.ts') for k in counts), counts


def test_inline_create_probe_does_not_log_a_denial(default_out):
    # A hint for showing a button reads the flag; it never calls a check that logs.
    for path in (default_out / 'lib').glob('*/inline_create.ts'):
        text = path.read_text()
        probe = text[text.index('BeCreatedInline'):text.index('InlineCreateInit')]
        assert 'catch' not in probe, path
