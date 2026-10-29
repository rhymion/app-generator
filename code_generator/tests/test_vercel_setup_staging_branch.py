"""scripts/vercel-setup.sh must create the Preview ("staging") Neon branch
schema-only: a branch created without `init_source` is a full copy of the
production data (emails, password hashes, MFA secrets, API keys, audit log)
inside an environment that runs less-reviewed branch code."""
import re
import subprocess
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[2] / 'scripts' / 'vercel-setup.sh'


def _create_block() -> str:
    text = SCRIPT.read_text()
    start = text.index('if [[ "$_STAGING_EXISTS" != "yes" ]]; then')
    end = text.index('[SKIP] Neon staging branch already exists')
    return text[start:end]


def test_script_parses():
    assert subprocess.run(['bash', '-n', str(SCRIPT)]).returncode == 0


def test_staging_branch_is_created_schema_only_from_production():
    block = _create_block()
    assert '\\"init_source\\":\\"schema-only\\"' in block
    assert '\\"parent_id\\":\\"${_PRODUCTION_ID}\\"' in block


def test_staging_branch_creation_fails_closed():
    block = _create_block()
    # No production parent -> exit, not a silent data-copying branch.
    assert re.search(r'-z "\$_PRODUCTION_ID".*?exit 1', block, re.S)
    # A failed create call is no longer swallowed by `> /dev/null`.
    assert '%{http_code}' in block
    assert '/dev/null\n' not in block.split('-w')[0].split('curl')[-1] or '-o /dev/null -w' in block
    assert re.search(r'_CREATE_STATUS" != 2\*.*?exit 1', block, re.S)


def test_every_branch_post_names_an_init_source():
    # Any POST to the branches endpoint must state its data policy.
    for m in re.finditer(r'curl[^\n]*-X POST[^\n]*\n(?:[^\n]*\\\n)*[^\n]*/branches"', SCRIPT.read_text()):
        assert 'init_source' in m.group(0), m.group(0)
