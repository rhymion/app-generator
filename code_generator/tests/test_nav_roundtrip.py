"""
Roundtrip tests for the appended-file invariant nested nav adds to
`lib/site-config.ts` (docs/knowledge/nested-nav-menu-design.md §7.1):

    generate -> write to site-config -> cleanup -> generate again

must produce byte-for-byte identical site-config.ts on the second generation,
and cleanup must restore the file to exactly its pre-generate baseline (this
is the "元へ戻る" property subtask_744b's AC #4 requires pytest proof of).
"""
from pathlib import Path

import cleanup
from generators_i18n import _update_site_config
from nav_config import build_nav_config

_BASELINE = '''export type NavLink = {
  label: string;
  href: string;
  external?: boolean;
  group?: string;
};

export type NavGroup = {
  slug: string;
  labelKey: string;
  order: number;
  icon?: string;
  parent?: string;
};

export const siteConfig = {
  navLinks: [
    { label: "Home", href: "/", external: false },
  ] satisfies NavLink[],

  navGroups: [
  ] satisfies NavGroup[],
};
'''


def _entity(model: str, definition_key: str | None = None) -> dict:
    return {
        'parent': model,
        'model': model,
        'definition_key': definition_key or model,
        'children': [],
        'generate_config': {'list': True, 'view': True, 'new': True, 'edit': True, 'delete': True},
    }


def _run_generate(path: Path, entities: list, schema: dict) -> tuple[list, dict]:
    nav_config = build_nav_config(entities, schema)
    nav_entities = [e for e in entities if e['parent'] == e['model'] and e['generate_config'].get('list', True)]
    _update_site_config(path, nav_entities, nav_config)
    return nav_entities, nav_config


def test_flat_navlink_roundtrip(tmp_path: Path) -> None:
    path = tmp_path / 'site-config.ts'
    path.write_text(_BASELINE, encoding='utf-8')

    entities = [_entity('widget')]
    schema = {'definitions': {'widget': {}}}

    nav_entities, nav_config = _run_generate(path, entities, schema)
    after_generate_1 = path.read_text(encoding='utf-8')
    assert '/widget' in after_generate_1
    assert after_generate_1 != _BASELINE

    nav_hrefs = [f'/{e["parent"]}' for e in nav_entities]
    nav_group_slugs = [g['slug'] for g in nav_config['groups']]
    cleanup._clean_site_config(path, nav_hrefs, nav_group_slugs)
    after_cleanup = path.read_text(encoding='utf-8')
    assert after_cleanup == _BASELINE, 'cleanup must restore the pre-generate baseline exactly'

    _update_site_config(path, nav_entities, nav_config)
    after_generate_2 = path.read_text(encoding='utf-8')
    assert after_generate_2 == after_generate_1, (
        'generate -> cleanup -> generate must reproduce byte-for-byte identical output'
    )


def test_grouped_navlink_and_navgroup_roundtrip(tmp_path: Path) -> None:
    path = tmp_path / 'site-config.ts'
    path.write_text(_BASELINE, encoding='utf-8')

    entities = [
        _entity('inventory_transaction'),
        _entity('inventory_reservation'),
    ]
    schema = {
        'definitions': {
            'inventory_transaction': {'x-nav': {'parent': 'inventory_group', 'order': 1}},
            'inventory_reservation': {'x-nav': {'parent': 'inventory_group', 'order': 2}},
        },
    }

    nav_entities, nav_config = _run_generate(path, entities, schema)
    after_generate_1 = path.read_text(encoding='utf-8')
    assert 'group: "inventory_group"' in after_generate_1
    assert 'slug: "inventory_group"' in after_generate_1
    assert after_generate_1 != _BASELINE

    nav_hrefs = [f'/{e["parent"]}' for e in nav_entities]
    nav_group_slugs = [g['slug'] for g in nav_config['groups']]
    cleanup._clean_site_config(path, nav_hrefs, nav_group_slugs)
    after_cleanup = path.read_text(encoding='utf-8')
    assert after_cleanup == _BASELINE, 'cleanup must strip both the grouped navLinks entries and the navGroups entry'

    _update_site_config(path, nav_entities, nav_config)
    after_generate_2 = path.read_text(encoding='utf-8')
    assert after_generate_2 == after_generate_1, (
        'generate -> cleanup -> generate must reproduce byte-for-byte identical output, '
        'including navGroups and the group tag on navLinks'
    )


def test_nested_group_hierarchy_roundtrip(tmp_path: Path) -> None:
    """§2 group-to-group hierarchy (x-nav-groups) survives the same roundtrip."""
    path = tmp_path / 'site-config.ts'
    path.write_text(_BASELINE, encoding='utf-8')

    entities = [_entity('inventory_reservation')]
    schema = {
        'definitions': {
            'inventory_reservation': {'x-nav': {'parent': 'inventory_group', 'order': 1}},
        },
        'x-nav-groups': {
            'logistics_group': {'order': 5},
            'inventory_group': {'parent': 'logistics_group', 'icon': 'Inventory2'},
        },
    }

    nav_entities, nav_config = _run_generate(path, entities, schema)
    after_generate_1 = path.read_text(encoding='utf-8')
    assert 'parent: "logistics_group"' in after_generate_1
    assert 'icon: "Inventory2"' in after_generate_1

    nav_hrefs = [f'/{e["parent"]}' for e in nav_entities]
    nav_group_slugs = [g['slug'] for g in nav_config['groups']]
    cleanup._clean_site_config(path, nav_hrefs, nav_group_slugs)
    assert path.read_text(encoding='utf-8') == _BASELINE

    _update_site_config(path, nav_entities, nav_config)
    assert path.read_text(encoding='utf-8') == after_generate_1
