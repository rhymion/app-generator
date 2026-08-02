"""
Gate: no direct @mui imports in *.jinja2 templates.
Allowlist: none — templates NEVER need @mui imports.
AP-6 exceptions apply only to non-template wrapper implementation files.
"""
import re
from pathlib import Path
import pytest

TEMPLATES_DIR = Path(__file__).parent.parent / 'templates'
MUI_RE = re.compile(r"from\s+'@mui|from\s+\"@mui")


def _all_templates():
    return sorted(TEMPLATES_DIR.rglob('*.jinja2'))


@pytest.mark.parametrize('tpl', _all_templates(),
                          ids=lambda p: str(p.relative_to(TEMPLATES_DIR)))
def test_no_direct_mui_import(tpl):
    """Template must not import @mui directly — use wrapper components."""
    lines = Path(tpl).read_text(encoding='utf-8').splitlines()
    violations = [(i + 1, ln.strip()) for i, ln in enumerate(lines) if MUI_RE.search(ln)]
    assert not violations, (
        f"{tpl.relative_to(TEMPLATES_DIR)} — {len(violations)} direct @mui import(s):\n"
        + '\n'.join(f"  L{n}: {code}" for n, code in violations)
    )


# --- Self-test (gate must itself be provably correct) ---
def test_gate_detects_violation(tmp_path):
    """The detection regex must catch a known-bad import pattern.
    This test fails if the gate's own pattern is broken."""
    bad_file = tmp_path / 'bad.tsx.jinja2'
    bad_file.write_text("import Box from '@mui/material/Box';\n")
    text = bad_file.read_text()
    assert MUI_RE.search(text), (
        "GATE SELF-TEST FAILED: MUI_RE did not match a known @mui import. "
        "The gate pattern is broken — fix MUI_RE before proceeding."
    )


def test_gate_does_not_flag_allowlist_comment(tmp_path):
    """A comment mentioning @mui (not an import) must NOT trigger the gate."""
    ok_file = tmp_path / 'ok.tsx.jinja2'
    ok_file.write_text("// Uses AppButton instead of @mui/material/Button\n")
    text = ok_file.read_text()
    assert not MUI_RE.search(text), "False positive: gate flagged a comment, not an import."
