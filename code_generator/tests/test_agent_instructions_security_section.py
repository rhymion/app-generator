"""CLAUDE.md and AGENTS.md carry a short security section whose names are real, and no stale raw-SQL rule."""
import pathlib
import re

import pytest

REPO_ROOT = pathlib.Path(__file__).resolve().parents[2]
FILES = ['CLAUDE.md', 'AGENTS.md']


def _section(text: str) -> str:
    match = re.search(r'## Security \(hand-written code\)\n(.*?)\n## ', text, re.S)
    assert match, 'security section missing'
    return match.group(1)


@pytest.mark.parametrize('name', FILES)
def test_security_section_is_short_and_names_exist(name):
    section = _section((REPO_ROOT / name).read_text(encoding='utf-8'))
    assert len(section.splitlines()) <= 30, 'the section is meant to stay short'
    sources = ''.join((REPO_ROOT / p).read_text(encoding='utf-8')
                      for p in ('lib/api-auth.ts', 'lib/authz.ts', 'lib/rate-limit/index.ts'))
    for function in re.findall(r'`((?:require|get|authenticate)\w*)\(\)`', section):
        assert re.search(rf'export (?:async )?function {function}\b', sources), f'{name}: {function}() is not exported'
    for path in re.findall(r'`((?:docs|cypress|test|lib|\.claude)/[^`\s]+)`', section):
        if '<' in path:
            continue
        assert (REPO_ROOT / path.rstrip('/')).exists(), f'{name}: {path} does not exist'


@pytest.mark.parametrize('name', FILES)
def test_raw_sql_rule_matches_the_policy_document(name):
    text = (REPO_ROOT / name).read_text(encoding='utf-8')
    assert "Don't use Prisma.raw" not in text, 'the blanket "all raw SQL is prohibited" rule is out of date'
    rule = re.search(r'### Raw SQL\n(.*?)\n\n', text, re.S)
    assert rule, f'{name}: Raw SQL rule missing'
    assert 'docs/knowledge/raw-sql-policy.md' in rule.group(1)
    assert (REPO_ROOT / 'docs' / 'knowledge' / 'raw-sql-policy.md').is_file()
