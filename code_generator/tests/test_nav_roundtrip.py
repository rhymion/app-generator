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
from generators_i18n import _update_sidebar, _update_site_config
from nav_config import build_nav_config, nav_list_entities

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
    nav_entities = nav_list_entities(entities)
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


def test_proxy_view_nav_entry_roundtrip(tmp_path: Path) -> None:
    """cmd_813: a proxy view (parent != model, e.g. a 'setting1'-shaped
    demo fixture) must get its own sidebar entry and survive the same
    generate -> cleanup -> generate roundtrip as an ordinary entity."""
    path = tmp_path / 'site-config.ts'
    path.write_text(_BASELINE, encoding='utf-8')

    entities = [
        {
            'parent': 'view_a', 'model': 'shared_model', 'definition_key': 'view_a',
            'children': [],
            'generate_config': {'list': True, 'view': True, 'new': True, 'edit': True, 'delete': True},
        },
        {
            'parent': 'view_b', 'model': 'shared_model', 'definition_key': 'view_b',
            'children': [],
            'generate_config': {'list': True, 'view': True, 'new': True, 'edit': True, 'delete': True},
        },
    ]
    schema = {
        'definitions': {
            'view_a': {'x-nav': {'parent': 'group_a', 'order': 1}},
            'view_b': {'x-nav': {'parent': 'group_b', 'order': 2}},
        },
    }

    nav_entities, nav_config = _run_generate(path, entities, schema)
    after_generate_1 = path.read_text(encoding='utf-8')
    assert '/view_a' in after_generate_1
    assert '/view_b' in after_generate_1
    assert 'group: "group_a"' in after_generate_1
    assert 'group: "group_b"' in after_generate_1

    nav_hrefs = [f'/{e["parent"]}' for e in nav_entities]
    nav_group_slugs = [g['slug'] for g in nav_config['groups']]
    cleanup._clean_site_config(path, nav_hrefs, nav_group_slugs)
    assert path.read_text(encoding='utf-8') == _BASELINE

    _update_site_config(path, nav_entities, nav_config)
    assert path.read_text(encoding='utf-8') == after_generate_1


_SIDEBAR_BASELINE = '''const navTranslationKeys = {
};

export default function SidebarWrapper() {
  return null;
}
'''


def test_cleanup_appended_files_retracts_proxy_view_nav_entry(tmp_path: Path) -> None:
    """cmd_817 regression: cleanup._clean_appended_files (the real cleanup
    entry point, NOT a hand-rebuilt href list) must retract a proxy view's
    (parent != model) nav entry using the SAME entity filter generate used
    to add it.

    #419 loosened generators_i18n.py's generate-side filter to include
    proxy views but left cleanup.py's own literal copy narrower
    (parent == model only) — generate added the entry, cleanup silently
    failed to remove it. nav_config.nav_list_entities is now the single
    predicate both sides call; this test drives real generate + real
    cleanup functions end-to-end so a re-introduced drift between them
    (e.g. someone re-narrowing only one side again) fails here instead of
    shipping unnoticed a third time.
    """
    out = tmp_path
    site_config = out / 'lib' / 'site-config.ts'
    sidebar = out / 'app' / '[locale]' / '@sidebar' / 'page.tsx'
    site_config.parent.mkdir(parents=True)
    sidebar.parent.mkdir(parents=True)
    site_config.write_text(_BASELINE, encoding='utf-8')
    sidebar.write_text(_SIDEBAR_BASELINE, encoding='utf-8')

    entities = [
        {
            'parent': 'view_a', 'model': 'shared_model', 'definition_key': 'view_a',
            'children': [],
            'generate_config': {'list': True, 'view': True, 'new': True, 'edit': True, 'delete': True},
        },
        # An ordinary (parent == model) entity alongside it, to prove the
        # non-proxy-view removal path (unaffected by cmd_817) still works.
        {
            'parent': 'plain_entity', 'model': 'plain_entity', 'definition_key': 'plain_entity',
            'children': [],
            'generate_config': {'list': True, 'view': True, 'new': True, 'edit': True, 'delete': True},
        },
    ]
    schema = {'definitions': {'view_a': {}, 'plain_entity': {}}}

    nav_config = build_nav_config(entities, schema)
    nav_entities = nav_list_entities(entities)
    _update_site_config(site_config, nav_entities, nav_config)
    _update_sidebar(sidebar, nav_entities)
    assert '/view_a' in site_config.read_text(encoding='utf-8')
    assert '/view_a' in sidebar.read_text(encoding='utf-8')
    assert '/plain_entity' in site_config.read_text(encoding='utf-8')

    cleanup._clean_appended_files(out, entities, schema)

    site_config_after = site_config.read_text(encoding='utf-8')
    sidebar_after = sidebar.read_text(encoding='utf-8')
    assert '/view_a' not in site_config_after, (
        'cleanup must retract a proxy view (parent != model) nav entry it generated'
    )
    assert '/view_a' not in sidebar_after, (
        'cleanup must retract a proxy view (parent != model) sidebar entry it generated'
    )
    assert '/plain_entity' not in site_config_after, (
        'existing parent == model cleanup behavior must be unchanged'
    )
    assert site_config_after == _BASELINE
    assert sidebar_after == _SIDEBAR_BASELINE


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
