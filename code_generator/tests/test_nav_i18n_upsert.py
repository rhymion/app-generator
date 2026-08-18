"""
End-to-end (update_i18n_and_config) proof of the §5.2 P2 invariant: nav group
i18n placeholders are written to BOTH en.json and ja.json, and a human edit to
either survives a second generate-code run untouched.
"""
import json
from pathlib import Path

from generators_i18n import update_i18n_and_config


def _entity(model: str) -> dict:
    return {
        'parent': model,
        'model': model,
        'definition_key': model,
        'children': [],
        'generate_config': {'list': True, 'view': True, 'new': True, 'edit': True, 'delete': True, 'fields': None},
    }


def _schema() -> dict:
    return {
        'definitions': {
            'inventory_reservation': {
                'type': 'object',
                'required': ['id'],
                'properties': {'id': {'type': 'string'}},
                'x-nav': {'parent': 'inventory_group', 'order': 1},
            },
        },
    }


def test_first_generation_writes_derived_label_to_both_locales(tmp_path: Path) -> None:
    messages_dir = tmp_path / 'messages'
    messages_dir.mkdir()
    (messages_dir / 'en.json').write_text(json.dumps({}), encoding='utf-8')
    (messages_dir / 'ja.json').write_text(json.dumps({}), encoding='utf-8')

    update_i18n_and_config([_entity('inventory_reservation')], _schema(), tmp_path)

    en = json.loads((messages_dir / 'en.json').read_text(encoding='utf-8'))
    ja = json.loads((messages_dir / 'ja.json').read_text(encoding='utf-8'))
    assert en['Nav']['groups']['inventory_group'] == 'Inventory Group'
    assert ja['Nav']['groups']['inventory_group'] == 'Inventory Group', (
        'ja.json gets the derived English label as a legible placeholder, not a TODO marker'
    )


def test_human_edit_survives_second_generation(tmp_path: Path) -> None:
    messages_dir = tmp_path / 'messages'
    messages_dir.mkdir()
    (messages_dir / 'en.json').write_text(json.dumps({}), encoding='utf-8')
    (messages_dir / 'ja.json').write_text(json.dumps({}), encoding='utf-8')

    # 1. First generation: placeholder is written
    update_i18n_and_config([_entity('inventory_reservation')], _schema(), tmp_path)
    ja = json.loads((messages_dir / 'ja.json').read_text(encoding='utf-8'))
    assert ja['Nav']['groups']['inventory_group'] == 'Inventory Group'

    # 2. Human edits the value
    ja['Nav']['groups']['inventory_group'] = '在庫管理'
    (messages_dir / 'ja.json').write_text(json.dumps(ja, ensure_ascii=False), encoding='utf-8')

    # 3. Second generation: human edit is preserved
    update_i18n_and_config([_entity('inventory_reservation')], _schema(), tmp_path)
    ja_after = json.loads((messages_dir / 'ja.json').read_text(encoding='utf-8'))
    assert ja_after['Nav']['groups']['inventory_group'] == '在庫管理'


def test_untranslated_nav_group_key_surfaces_in_warning(tmp_path: Path, capsys) -> None:
    messages_dir = tmp_path / 'messages'
    messages_dir.mkdir()
    (messages_dir / 'en.json').write_text(json.dumps({}), encoding='utf-8')
    (messages_dir / 'ja.json').write_text(json.dumps({}), encoding='utf-8')

    update_i18n_and_config([_entity('inventory_reservation')], _schema(), tmp_path)

    captured = capsys.readouterr()
    assert 'ja.json [Nav]: ' in captured.out
    assert 'groups.inventory_group' in captured.out
