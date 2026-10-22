"""Tests for prj:sync removing destinations whose prj/ source is gone (Issue #619).

A hand-written file renamed inside prj/ used to leave its old copy behind at the
destination, still referencing pre-rename identifiers. prj:sync now records what
it copied verbatim and removes a recorded destination once its source is gone,
unless the destination changed since the sync.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts"))

import prj_sync  # noqa: E402


def _write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def _layout(tmp_path: Path) -> tuple[Path, Path]:
    prj = tmp_path / "prj"
    dst = tmp_path / "gen"
    prj.mkdir()
    dst.mkdir()
    return prj, dst


OLD = "app/api/purchase_order/[id]/actions/moveReservation/route.ts"
NEW = "app/api/sales_order/[id]/actions/moveReservation/route.ts"


def test_renamed_file_old_path_is_removed(tmp_path, capsys):
    prj, dst = _layout(tmp_path)
    _write(prj / OLD, "export const model = 'purchase_order'\n")
    assert prj_sync.prj_sync(prj, dst) == 0
    assert (dst / OLD).is_file()

    (prj / OLD).unlink()
    _write(prj / NEW, "export const model = 'sales_order'\n")
    assert prj_sync.prj_sync(prj, dst) == 0

    assert not (dst / OLD).exists()
    assert (dst / NEW).read_text(encoding="utf-8") == "export const model = 'sales_order'\n"
    assert f"prj:sync: removed {OLD}" in capsys.readouterr().out


def test_emptied_parent_directories_are_pruned_but_not_the_root(tmp_path):
    prj, dst = _layout(tmp_path)
    _write(prj / OLD, "x\n")
    prj_sync.prj_sync(prj, dst)
    (prj / OLD).unlink()
    prj_sync.prj_sync(prj, dst)

    assert not (dst / "app/api/purchase_order").exists()
    assert dst.is_dir()


def test_sibling_generator_file_in_same_directory_survives(tmp_path):
    prj, dst = _layout(tmp_path)
    _write(prj / OLD, "x\n")
    prj_sync.prj_sync(prj, dst)
    sibling = dst / Path(OLD).parent / "generated.ts"
    _write(sibling, "generator output\n")

    (prj / OLD).unlink()
    prj_sync.prj_sync(prj, dst)

    assert not (dst / OLD).exists()
    assert sibling.read_text(encoding="utf-8") == "generator output\n"
    assert (dst / Path(OLD).parent).is_dir()


def test_file_never_copied_from_prj_is_never_removed(tmp_path):
    prj, dst = _layout(tmp_path)
    _write(prj / "keep.ts", "x\n")
    generator_owned = dst / "lib/own.ts"
    _write(generator_owned, "generator owned\n")
    prj_sync.prj_sync(prj, dst)
    (prj / "keep.ts").unlink()
    prj_sync.prj_sync(prj, dst)

    assert generator_owned.is_file()


def test_destination_changed_since_sync_is_kept_with_warning(tmp_path, capsys):
    prj, dst = _layout(tmp_path)
    _write(prj / "a.ts", "from prj\n")
    prj_sync.prj_sync(prj, dst)
    _write(dst / "a.ts", "overwritten by generate-code\n")
    (prj / "a.ts").unlink()
    capsys.readouterr()

    prj_sync.prj_sync(prj, dst)

    assert (dst / "a.ts").read_text(encoding="utf-8") == "overwritten by generate-code\n"
    assert "WARNING kept a.ts" in capsys.readouterr().err
    # Once kept, it is no longer tracked, so a later run stays quiet and keeps it.
    prj_sync.prj_sync(prj, dst)
    assert (dst / "a.ts").is_file()


def test_first_run_without_manifest_removes_nothing(tmp_path):
    prj, dst = _layout(tmp_path)
    _write(dst / "legacy.ts", "copied before the manifest existed\n")
    _write(prj / "other.ts", "x\n")
    prj_sync.prj_sync(prj, dst)

    assert (dst / "legacy.ts").is_file()


def test_messages_json_is_merged_and_never_removed(tmp_path):
    prj, dst = _layout(tmp_path)
    _write(dst / "messages/en.json", json.dumps({"A": "system"}))
    _write(prj / "messages/en.json", json.dumps({"B": "consumer"}))
    prj_sync.prj_sync(prj, dst)
    (prj / "messages/en.json").unlink()
    _write(prj / "other.ts", "x\n")
    prj_sync.prj_sync(prj, dst)

    assert json.loads((dst / "messages/en.json").read_text(encoding="utf-8")) == {
        "A": "system",
        "B": "consumer",
    }


def test_no_prj_directory_removes_nothing_and_writes_no_manifest(tmp_path, capsys):
    prj = tmp_path / "prj"  # absent
    dst = tmp_path / "gen"
    dst.mkdir()
    _write(dst / "a.ts", "x\n")
    (dst / prj_sync.MANIFEST_NAME).write_text(
        json.dumps({"version": 1, "files": {"a.ts": "0" * 64}}), encoding="utf-8"
    )

    assert prj_sync.prj_sync(prj, dst) == 0

    assert (dst / "a.ts").is_file()
    assert "no ../prj, skipping" in capsys.readouterr().out


def test_manifest_with_hostile_paths_is_ignored(tmp_path):
    prj, dst = _layout(tmp_path)
    outside = tmp_path / "outside.txt"
    outside.write_text("keep\n", encoding="utf-8")
    digest = prj_sync._sha256(outside)
    (dst / prj_sync.MANIFEST_NAME).write_text(
        json.dumps({"version": 1, "files": {"../outside.txt": digest, str(outside): digest}}),
        encoding="utf-8",
    )
    _write(prj / "x.ts", "x\n")
    prj_sync.prj_sync(prj, dst)

    assert outside.is_file()


def test_corrupt_manifest_is_treated_as_empty(tmp_path):
    prj, dst = _layout(tmp_path)
    (dst / prj_sync.MANIFEST_NAME).write_text("{not json", encoding="utf-8")
    _write(dst / "legacy.ts", "x\n")
    _write(prj / "x.ts", "x\n")

    assert prj_sync.prj_sync(prj, dst) == 0

    assert (dst / "legacy.ts").is_file()
    assert "x.ts" in json.loads((dst / prj_sync.MANIFEST_NAME).read_text(encoding="utf-8"))["files"]


def test_removal_line_does_not_match_lint_prj_sync_line_regex():
    import lint_prj_synced

    assert lint_prj_synced.SYNC_LINE_RE.match("prj:sync: removed a/b.ts (no longer in prj/)") is None
