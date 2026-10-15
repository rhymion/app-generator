"""Every Cypress spec directory is run by a Completion gate step.

CI's `e2e-tests` job runs `cypress run` with no `--spec` filter, so a spec
directory that neither `test:e2e:cy:api` nor `test:e2e:cy:ui` matches passes the
local gate and still fails CI (Issue #580).
"""
import json
import re
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
SPEC_ROOT = REPO_ROOT / 'cypress' / 'e2e'


def _gate_globs() -> list[str]:
    scripts = json.loads((REPO_ROOT / 'package.json').read_text())['scripts']
    globs: list[str] = []
    for name in ('test:e2e:cy:api', 'test:e2e:cy:ui'):
        match = re.search(r'--spec "([^"]+)"', scripts[name])
        assert match, f'{name} has no --spec glob'
        globs.extend(match.group(1).split(','))
    return globs


def _matches(path: str, glob: str) -> bool:
    # Cypress `*` does not cross `/`, `**` does.
    pattern = re.escape(glob).replace(r'\*\*', '.*').replace(r'\*', '[^/]*')
    return re.fullmatch(pattern, path) is not None


def test_every_committed_cypress_spec_is_matched_by_a_gate_glob():
    globs = _gate_globs()
    unmatched = []
    for spec in sorted(SPEC_ROOT.rglob('*.cy.ts')):
        rel = spec.relative_to(REPO_ROOT).as_posix()
        if not any(_matches(rel, g) for g in globs):
            unmatched.append(rel)
    assert not unmatched, f'specs no gate step runs: {unmatched}'


def test_ui_gate_includes_the_auth_specs():
    assert 'cypress/e2e/auth/**' in _gate_globs()
