"""Tests for prj:sync merging prj/package.extra.json into package.json.

A consumer's own code may need an npm package that not every generated app
should carry (e.g. an AI agent SDK). It declares the package in
prj/package.extra.json; prj:sync adds it to package.json, runs npm install, and
removes it again once the consumer drops it. See
docs/knowledge/prj-sync-package-extra.md.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts"))

import prj_sync  # noqa: E402

BASE_PACKAGE = {
    "name": "my-next",
    "private": True,
    "scripts": {"build": "next build"},
    "dependencies": {"next": "16.0.0", "zod": "^4.0.0"},
    "devDependencies": {"vitest": "^3.0.0"},
}


class FakeNpm:
    """Records npm install calls instead of hitting the network."""

    def __init__(self, rc: int = 0):
        self.rc = rc
        self.calls: list[Path] = []

    def __call__(self, dst_dir: Path) -> int:
        self.calls.append(dst_dir)
        return self.rc


def _layout(tmp_path: Path) -> tuple[Path, Path]:
    prj = tmp_path / "prj"
    dst = tmp_path / "gen"
    prj.mkdir()
    dst.mkdir()
    (dst / "package.json").write_text(json.dumps(BASE_PACKAGE, indent=2) + "\n", encoding="utf-8")
    return prj, dst


def _extra(prj: Path, data) -> None:
    text = data if isinstance(data, str) else json.dumps(data)
    (prj / prj_sync.PACKAGE_EXTRA_NAME).write_text(text, encoding="utf-8")


def _pkg(dst: Path) -> dict:
    return json.loads((dst / "package.json").read_text(encoding="utf-8"))


def test_extra_dependencies_are_added_sorted_and_installed(tmp_path, capsys):
    prj, dst = _layout(tmp_path)
    _extra(prj, {
        "//": "agent SDK for prj/lib/agent",
        "dependencies": {"@anthropic-ai/sdk": "^1.2.0", "ai": "5.0.0"},
        "devDependencies": {"@types/foo": "^1.0.0"},
    })
    npm = FakeNpm()
    assert prj_sync.prj_sync(prj, dst, npm_install=npm) == 0

    pkg = _pkg(dst)
    assert list(pkg["dependencies"]) == ["@anthropic-ai/sdk", "ai", "next", "zod"]
    assert pkg["dependencies"]["@anthropic-ai/sdk"] == "^1.2.0"
    assert pkg["devDependencies"] == {"@types/foo": "^1.0.0", "vitest": "^3.0.0"}
    assert pkg["scripts"] == BASE_PACKAGE["scripts"]
    assert npm.calls == [dst]
    # The extra file itself is never copied, and is not a tracked copy.
    assert not (dst / prj_sync.PACKAGE_EXTRA_NAME).exists()
    manifest = json.loads((dst / prj_sync.MANIFEST_NAME).read_text(encoding="utf-8"))
    assert prj_sync.PACKAGE_EXTRA_NAME not in manifest["files"]
    assert manifest["package_extra"]["added"]["dependencies"] == {
        "@anthropic-ai/sdk": "^1.2.0",
        "ai": "5.0.0",
    }
    assert "prj:sync: merged package.json" in capsys.readouterr().out


def test_second_run_is_a_no_op_when_installed(tmp_path):
    prj, dst = _layout(tmp_path)
    _extra(prj, {"dependencies": {"ai": "5.0.0"}})
    npm = FakeNpm()
    prj_sync.prj_sync(prj, dst, npm_install=npm)
    (dst / "node_modules/ai").mkdir(parents=True)
    (dst / "node_modules/ai/package.json").write_text("{}", encoding="utf-8")
    before = (dst / "package.json").read_text(encoding="utf-8")

    assert prj_sync.prj_sync(prj, dst, npm_install=npm) == 0
    assert (dst / "package.json").read_text(encoding="utf-8") == before
    assert len(npm.calls) == 1


def test_missing_node_module_triggers_install_even_without_change(tmp_path):
    prj, dst = _layout(tmp_path)
    _extra(prj, {"dependencies": {"ai": "5.0.0"}})
    npm = FakeNpm()
    prj_sync.prj_sync(prj, dst, npm_install=npm)
    prj_sync.prj_sync(prj, dst, npm_install=npm)
    assert len(npm.calls) == 2


def test_dependency_dropped_from_extra_is_removed(tmp_path, capsys):
    prj, dst = _layout(tmp_path)
    _extra(prj, {"dependencies": {"ai": "5.0.0", "openai": "^6.0.0"}})
    npm = FakeNpm()
    prj_sync.prj_sync(prj, dst, npm_install=npm)

    _extra(prj, {"dependencies": {"ai": "5.0.0"}})
    assert prj_sync.prj_sync(prj, dst, npm_install=npm) == 0
    assert "openai" not in _pkg(dst)["dependencies"]
    assert _pkg(dst)["dependencies"]["ai"] == "5.0.0"
    assert "prj:sync: removed dependencies openai" in capsys.readouterr().out
    assert len(npm.calls) == 2


def test_deleting_extra_file_restores_generator_package_json(tmp_path):
    prj, dst = _layout(tmp_path)
    original = (dst / "package.json").read_text(encoding="utf-8")
    _extra(prj, {"dependencies": {"ai": "5.0.0"}, "devDependencies": {"@types/foo": "1.0.0"}})
    npm = FakeNpm()
    prj_sync.prj_sync(prj, dst, npm_install=npm)

    (prj / prj_sync.PACKAGE_EXTRA_NAME).unlink()
    assert prj_sync.prj_sync(prj, dst, npm_install=npm) == 0
    assert (dst / "package.json").read_text(encoding="utf-8") == original
    manifest = json.loads((dst / prj_sync.MANIFEST_NAME).read_text(encoding="utf-8"))
    assert "package_extra" not in manifest
    # A third run has nothing to do.
    prj_sync.prj_sync(prj, dst, npm_install=npm)
    assert len(npm.calls) == 2


def test_package_json_changed_since_sync_keeps_entry_with_warning(tmp_path, capsys):
    prj, dst = _layout(tmp_path)
    _extra(prj, {"dependencies": {"ai": "5.0.0"}})
    npm = FakeNpm()
    prj_sync.prj_sync(prj, dst, npm_install=npm)

    pkg = _pkg(dst)
    pkg["scripts"]["extra"] = "echo hand edit"
    (dst / "package.json").write_text(json.dumps(pkg, indent=2) + "\n", encoding="utf-8")
    (prj / prj_sync.PACKAGE_EXTRA_NAME).unlink()

    assert prj_sync.prj_sync(prj, dst, npm_install=npm) == 0
    assert _pkg(dst)["dependencies"]["ai"] == "5.0.0"
    assert "WARNING kept dependencies ai" in capsys.readouterr().err


def test_package_json_reset_by_submodule_update_gets_extras_again(tmp_path):
    prj, dst = _layout(tmp_path)
    original = (dst / "package.json").read_text(encoding="utf-8")
    _extra(prj, {"dependencies": {"ai": "5.0.0"}})
    npm = FakeNpm()
    prj_sync.prj_sync(prj, dst, npm_install=npm)

    (dst / "package.json").write_text(original, encoding="utf-8")  # git checkout
    assert prj_sync.prj_sync(prj, dst, npm_install=npm) == 0
    assert _pkg(dst)["dependencies"]["ai"] == "5.0.0"


def test_same_version_as_generator_is_left_alone(tmp_path):
    prj, dst = _layout(tmp_path)
    original = (dst / "package.json").read_text(encoding="utf-8")
    _extra(prj, {"dependencies": {"zod": "^4.0.0"}})
    npm = FakeNpm()
    assert prj_sync.prj_sync(prj, dst, npm_install=npm) == 0
    assert (dst / "package.json").read_text(encoding="utf-8") == original
    assert npm.calls == []

    # Dropping it from the extra must not remove the generator's own entry.
    (prj / prj_sync.PACKAGE_EXTRA_NAME).unlink()
    prj_sync.prj_sync(prj, dst, npm_install=npm)
    assert _pkg(dst)["dependencies"]["zod"] == "^4.0.0"


def test_conflicting_version_is_refused_and_generator_version_kept(tmp_path, capsys):
    prj, dst = _layout(tmp_path)
    _extra(prj, {"dependencies": {"zod": "^3.0.0", "ai": "5.0.0"}})
    npm = FakeNpm()
    assert prj_sync.prj_sync(prj, dst, npm_install=npm) == 1
    pkg = _pkg(dst)
    assert pkg["dependencies"]["zod"] == "^4.0.0"
    assert pkg["dependencies"]["ai"] == "5.0.0"  # the rest still merges
    assert "generator already declares zod@^4.0.0" in capsys.readouterr().err


def test_name_in_other_section_is_refused(tmp_path, capsys):
    prj, dst = _layout(tmp_path)
    _extra(prj, {"dependencies": {"vitest": "^3.0.0"}})
    assert prj_sync.prj_sync(prj, dst, npm_install=FakeNpm()) == 1
    assert "vitest" not in _pkg(dst)["dependencies"]
    assert "already declares it under devDependencies" in capsys.readouterr().err


def test_invalid_extra_leaves_package_json_unchanged(tmp_path, capsys):
    prj, dst = _layout(tmp_path)
    original = (dst / "package.json").read_text(encoding="utf-8")
    for bad in (
        "{not json",
        "[]",
        {"scripts": {"x": "y"}},
        {"dependencies": ["ai"]},
        {"dependencies": {"Bad Name": "1.0.0"}},
        {"dependencies": {"ai": ""}},
        {"dependencies": {"ai": "1"}, "devDependencies": {"ai": "1"}},
    ):
        _extra(prj, bad)
        npm = FakeNpm()
        assert prj_sync.prj_sync(prj, dst, npm_install=npm) == 1, bad
        assert (dst / "package.json").read_text(encoding="utf-8") == original
        assert npm.calls == []
    assert "package.json left unchanged" in capsys.readouterr().err


def test_invalid_extra_keeps_record_so_later_run_can_revert(tmp_path):
    prj, dst = _layout(tmp_path)
    original = (dst / "package.json").read_text(encoding="utf-8")
    npm = FakeNpm()
    _extra(prj, {"dependencies": {"ai": "5.0.0"}})
    prj_sync.prj_sync(prj, dst, npm_install=npm)
    _extra(prj, "{broken")
    assert prj_sync.prj_sync(prj, dst, npm_install=npm) == 1
    (prj / prj_sync.PACKAGE_EXTRA_NAME).unlink()
    assert prj_sync.prj_sync(prj, dst, npm_install=npm) == 0
    assert (dst / "package.json").read_text(encoding="utf-8") == original


def test_npm_install_failure_fails_the_sync(tmp_path, capsys):
    prj, dst = _layout(tmp_path)
    _extra(prj, {"dependencies": {"ai": "5.0.0"}})
    assert prj_sync.prj_sync(prj, dst, npm_install=FakeNpm(rc=1)) == 1
    assert "npm install failed" in capsys.readouterr().err


def test_prj_package_json_and_lock_are_refused(tmp_path, capsys):
    prj, dst = _layout(tmp_path)
    original = (dst / "package.json").read_text(encoding="utf-8")
    (prj / "package.json").write_text('{"name": "consumer"}', encoding="utf-8")
    (prj / "package-lock.json").write_text("{}", encoding="utf-8")
    assert prj_sync.prj_sync(prj, dst, npm_install=FakeNpm()) == 1
    assert (dst / "package.json").read_text(encoding="utf-8") == original
    assert not (dst / "package-lock.json").exists()
    err = capsys.readouterr().err
    assert "prj/package.json SKIPPED" in err
    assert "prj/package-lock.json SKIPPED" in err


def test_no_extra_file_never_touches_package_json_or_npm(tmp_path):
    prj, dst = _layout(tmp_path)
    (dst / "package.json").write_text('{"name":"x","dependencies":{"b":"1","a":"1"}}', encoding="utf-8")
    (prj / "lib").mkdir()
    (prj / "lib/a.ts").write_text("export {}\n", encoding="utf-8")
    npm = FakeNpm()
    assert prj_sync.prj_sync(prj, dst, npm_install=npm) == 0
    assert (dst / "package.json").read_text(encoding="utf-8") == '{"name":"x","dependencies":{"b":"1","a":"1"}}'
    assert npm.calls == []
