"""
Issue #1092: email verification for self-registration is opt-in through
`x-generator.email-verification.enabled` (default false).

The register routes and pages are hand-written, tracked files and may not import
git-ignored generated output, so generate-code mirrors the schema value into
`siteConfig.auth.registration.emailVerification` in lib/site-config.ts. These
tests run the real build_user_schema.py -> generate.py pipeline with the flag
true, false and absent over a copy of this repository's lib/site-config.ts, and
check the validator.

Run:
    cd code_generator && python3 -m pytest tests/test_email_verification_toggle.py -v
"""
import re
import shutil
from pathlib import Path

import pytest
import yaml

from build_user_schema import build_user_schema
from generate import generate
from generators_i18n import _update_site_config_email_verification
from validate import SchemaValidationError, email_verification_enabled, validate_generator_config

FIXTURE = Path(__file__).resolve().parent / 'fixtures' / 'decimal_gate'
REPO_ROOT = Path(__file__).resolve().parents[2]
SITE_CONFIG = REPO_ROOT / 'lib' / 'site-config.ts'
LINE = re.compile(r'^\s*emailVerification:\s*(true|false),$', re.M)


def _build(tmp_path: Path, value) -> str:
    """Generate the fixture over a copy of lib/site-config.ts; `value` is the block, or 'absent'."""
    prisma_dir = tmp_path / 'prisma'
    prisma_dir.mkdir(parents=True)
    shutil.copy(FIXTURE / 'schema.prisma', prisma_dir / 'schema.prisma')
    (tmp_path / 'lib').mkdir()
    shutil.copy(SITE_CONFIG, tmp_path / 'lib' / 'site-config.ts')
    intermediate = tmp_path / 'generated_json_schema.yaml'
    build_user_schema(FIXTURE / 'json_schema.yaml', FIXTURE / 'schema.prisma', intermediate)
    schema = yaml.safe_load(intermediate.read_text())
    gen = schema.setdefault('x-generator', {})
    if value == 'absent':
        gen.pop('email-verification', None)
    else:
        gen['email-verification'] = value
    intermediate.write_text(yaml.safe_dump(schema))
    generate(str(intermediate), str(tmp_path))
    return (tmp_path / 'lib' / 'site-config.ts').read_text()


@pytest.mark.parametrize('value, expected', [
    ({'enabled': True}, 'true'),
    ({'enabled': False}, 'false'),
    ('absent', 'false'),
])
def test_generate_code_writes_the_flag_into_site_config(tmp_path, value, expected):
    text = _build(tmp_path, value)
    assert LINE.findall(text) == [expected]


def test_repository_site_config_matches_the_default_schema():
    # The default schema leaves verification off; the tracked file must say so,
    # or the next generate-code run changes a tracked file.
    schema = yaml.safe_load((REPO_ROOT / 'code_generator' / 'json_schema.yaml').read_text())
    assert email_verification_enabled(schema) is False
    assert LINE.findall(SITE_CONFIG.read_text()) == ['false']


def test_runtime_code_reads_the_flag_from_site_config():
    # The routes and page decide from siteConfig, never from an environment variable.
    for rel in ('app/api/auth/register/route.ts', 'app/api/auth/register/complete/route.ts',
                'app/[locale]/register/page.tsx'):
        text = (REPO_ROOT / rel).read_text()
        assert 'siteConfig.auth.registration?.emailVerification' in text, rel


def test_rewrites_an_existing_line_and_inserts_a_missing_block(tmp_path):
    path = tmp_path / 'site-config.ts'
    path.write_text('export const siteConfig = {\n  auth: {\n    registration: {\n      emailVerification: false,\n    },\n  },\n};\n')
    assert _update_site_config_email_verification(path, True) is True
    assert LINE.findall(path.read_text()) == ['true']
    assert _update_site_config_email_verification(path, True) is False

    old = tmp_path / 'old-site-config.ts'
    old.write_text('export const siteConfig = {\n  auth: {\n    providers: [],\n  },\n};\n')
    assert _update_site_config_email_verification(old, False) is True
    text = old.read_text()
    assert LINE.findall(text) == ['false']
    assert text.index('registration: {') < text.index('providers: []')


@pytest.mark.parametrize('block, message', [
    ('yes', 'must be a mapping'),
    ({'enabled': 'true'}, 'must be a boolean'),
    ({'enabled': True, 'smtp': 'x'}, 'unknown key'),
])
def test_validator_rejects_a_malformed_block(block, message):
    with pytest.raises(SchemaValidationError, match=message):
        validate_generator_config({'x-generator': {'email-verification': block}})


def test_flag_defaults_to_off():
    assert email_verification_enabled({}) is False
    assert email_verification_enabled({'x-generator': {}}) is False
    assert email_verification_enabled({'x-generator': {'email-verification': {}}}) is False
    assert email_verification_enabled({'x-generator': {'email-verification': {'enabled': True}}}) is True
