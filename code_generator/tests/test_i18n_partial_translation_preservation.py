"""
Regression tests for the cmd_560 partial-translation-preservation fix.

Background
----------
`messages/ja.json` translations were observed going wholesale-English after a
generate-code run that touched only one new/untranslated field (cmd_538 QC
report). Root cause turned out to live in `cleanup.py`, not here: its
`_clean_appended_files`/`_clean_messages` deleted every Fields/EntityLabel/Nav
key belonging to any entity currently in the passed schema — including real,
already-translated entities — whenever `npm run cleanup` ran (e.g. to remove a
temp fixture entity's generated files before reverting the schema). A
subsequent `npm run generate-code` then re-filled those now-missing keys with
English defaults, since `_update_json` only fills *missing* keys and had no
way to know they used to hold a real translation. See
`test_cleanup.py::test_clean_appended_files_never_touches_messages_json` for
the regression test on that actual fix.

This file locks in two things this cmd also fixed/verified in
`generators_i18n.py` itself:
  1. `_update_json` never overwrites an existing key (it already didn't, but
     now also reports which keys it *did* newly add).
  2. `update_i18n_and_config` surfaces newly-added keys in any non-source-
     locale file (i.e. anything other than `en.json`) as an untranslated-key
     WARNING in the build log, instead of silently reporting bare "Updated"
     for a file that just gained an unreviewed English placeholder.
"""
import json
from pathlib import Path

from generators_i18n import _update_json, update_i18n_and_config


# ---------------------------------------------------------------------------
# _update_json: preserves existing values, reports only genuinely new keys
# ---------------------------------------------------------------------------

def test_update_json_preserves_existing_value_and_reports_added_keys(tmp_path: Path) -> None:
    path = tmp_path / "ja.json"
    path.write_text(
        json.dumps({"Fields": {"action": "アクション"}}, ensure_ascii=False),
        encoding="utf-8",
    )

    changed, added = _update_json(path, {"Fields": {"action": "Action", "newKey": "New Key"}})

    assert changed is True
    assert added == {"Fields": ["newKey"]}, (
        "must report only the genuinely new key, not the already-present 'action' key"
    )

    data = json.loads(path.read_text(encoding="utf-8"))
    assert data["Fields"]["action"] == "アクション", (
        "existing translation must never be overwritten by the recomputed English default"
    )
    assert data["Fields"]["newKey"] == "New Key"


def test_update_json_no_op_when_nothing_new(tmp_path: Path) -> None:
    path = tmp_path / "ja.json"
    path.write_text(
        json.dumps({"Fields": {"action": "アクション"}}, ensure_ascii=False),
        encoding="utf-8",
    )

    changed, added = _update_json(path, {"Fields": {"action": "Action"}})

    assert changed is False
    assert added == {}


# ---------------------------------------------------------------------------
# update_i18n_and_config: untranslated-key visibility (cmd_560 item 3)
# ---------------------------------------------------------------------------

def _entity(model: str) -> dict:
    return {
        "parent": model,
        "model": model,
        "definition_key": f"{model}_detail",
        "children": [],
        "generate_config": {
            "list": True, "view": True, "new": True, "edit": True,
            "delete": True, "api": True, "test": True, "fields": None,
        },
    }


def _schema() -> dict:
    return {
        "definitions": {
            "widget": {
                "type": "object",
                "required": ["id", "name"],
                "properties": {
                    "id": {"type": "string", "pattern": "^c[a-z0-9]{24,}$"},
                    "name": {"type": "string"},
                },
            },
            "widget_detail": {"allOf": [{"$ref": "#/definitions/widget"}]},
        }
    }


def test_update_i18n_and_config_preserves_translation_and_flags_new_key(
    tmp_path: Path, capsys,
) -> None:
    messages_dir = tmp_path / "messages"
    messages_dir.mkdir()
    (messages_dir / "en.json").write_text(json.dumps({"Fields": {}}), encoding="utf-8")
    (messages_dir / "ja.json").write_text(
        json.dumps({"Fields": {"existingTranslated": "既存の訳"}}, ensure_ascii=False),
        encoding="utf-8",
    )

    update_i18n_and_config([_entity("widget")], _schema(), tmp_path)

    captured = capsys.readouterr()
    assert "WARNING: untranslated keys added" in captured.out, (
        "a newly-added key in ja.json (never translated) must be surfaced in the build log"
    )
    assert "ja.json [Fields]: name" in captured.out
    assert "en.json" not in captured.out.split("WARNING")[1], (
        "en.json IS the source of the English defaults -- it must never be reported as untranslated"
    )

    ja_data = json.loads((messages_dir / "ja.json").read_text(encoding="utf-8"))
    assert ja_data["Fields"]["existingTranslated"] == "既存の訳", (
        "a normal generate-code run must never touch an already-translated key"
    )
    assert ja_data["Fields"]["name"] == "Name", (
        "a genuinely new field still gets the English default so the app doesn't render a missing message"
    )


def test_update_i18n_and_config_no_warning_when_nothing_new(tmp_path: Path, capsys) -> None:
    messages_dir = tmp_path / "messages"
    messages_dir.mkdir()
    # Every key update_i18n_and_config will compute for the `widget` entity
    # (EntityLabel/Nav/Fields) is already present in both files, so this run
    # should be a true no-op with nothing to flag as newly-untranslated.
    en_seed = {"EntityLabel": {"widget": "Widget"}, "Nav": {"widget": "Widget"}, "Fields": {"name": "Name"}}
    ja_seed = {"EntityLabel": {"widget": "ウィジェット"}, "Nav": {"widget": "ウィジェット"}, "Fields": {"name": "名前"}}
    (messages_dir / "en.json").write_text(json.dumps(en_seed), encoding="utf-8")
    (messages_dir / "ja.json").write_text(json.dumps(ja_seed, ensure_ascii=False), encoding="utf-8")

    update_i18n_and_config([_entity("widget")], _schema(), tmp_path)

    captured = capsys.readouterr()
    assert "WARNING" not in captured.out, "no new keys were added -- there is nothing to flag"
