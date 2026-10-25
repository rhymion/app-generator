"""Tests for prj:sync excluding a generator test whose script prj/ replaces (Issue #1070).

scripts/grant-all-permissions.test.ts asserts the generator script's contract
with a fake client. A consumer whose prj/ replaces the script with a variant
that has a different contract (another admin lookup, blanket grants) would fail
every example, so prj:sync lists the test in .prj-sync-excluded-tests.json and
vitest.config.ts skips it. The list is rewritten on every sync.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts"))

import prj_sync  # noqa: E402

SCRIPT = "scripts/grant-all-permissions.ts"
TEST = "scripts/grant-all-permissions.test.ts"


def _write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def _layout(tmp_path: Path) -> tuple[Path, Path]:
    prj = tmp_path / "prj"
    dst = tmp_path / "gen"
    prj.mkdir()
    dst.mkdir()
    return prj, dst


def _excluded(dst: Path) -> list[str]:
    return json.loads((dst / prj_sync.EXCLUDED_TESTS_NAME).read_text(encoding="utf-8"))["tests"]


def test_mapping_names_the_real_generator_files():
    root = Path(__file__).resolve().parents[2]
    for script, test in prj_sync.GENERATOR_TESTS_OF_OVERRIDABLE_SCRIPTS.items():
        assert (root / script).is_file()
        assert (root / test).is_file()


def test_test_is_excluded_when_prj_replaces_the_script(tmp_path, capsys):
    prj, dst = _layout(tmp_path)
    _write(prj / SCRIPT, "export async function grantAllPermissions() {}\n")
    assert prj_sync.prj_sync(prj, dst) == 0
    assert _excluded(dst) == [TEST]
    assert f"generator test {TEST} excluded" in capsys.readouterr().out


def test_test_is_kept_when_prj_has_no_override(tmp_path):
    prj, dst = _layout(tmp_path)
    _write(prj / "unrelated.txt", "x\n")
    assert prj_sync.prj_sync(prj, dst) == 0
    assert _excluded(dst) == []


def test_test_is_kept_when_prj_ships_its_own_test(tmp_path):
    prj, dst = _layout(tmp_path)
    _write(prj / SCRIPT, "export async function grantAllPermissions() {}\n")
    _write(prj / TEST, "// consumer test\n")
    assert prj_sync.prj_sync(prj, dst) == 0
    assert _excluded(dst) == []


def test_exclusion_is_lifted_when_the_override_leaves_prj(tmp_path):
    prj, dst = _layout(tmp_path)
    _write(prj / SCRIPT, "export async function grantAllPermissions() {}\n")
    assert prj_sync.prj_sync(prj, dst) == 0
    assert _excluded(dst) == [TEST]
    (prj / SCRIPT).unlink()
    assert prj_sync.prj_sync(prj, dst) == 0
    assert _excluded(dst) == []
