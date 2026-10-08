"""
Tests for mobile_nav.py -- footer tabs and drill-down lists for the generated
Expo app, built from the same nav_config source as the desktop sidebar.
"""
import pytest

from mobile_nav import (
    DEFAULT_ENTITY_ICON,
    DEFAULT_GROUP_ICON,
    MOBILE_ICON_MAP,
    SUBSTITUTED_ICONS,
    assert_icon_map_covers_allowlist,
    build_mobile_nav,
)
from nav_config import MAX_NAV_DEPTH, NAV_ICON_ALLOWLIST, NavValidationError


def _entity(model: str, list_page: bool = True) -> dict:
    return {
        'parent': model,
        'model': model,
        'definition_key': model,
        'children': [],
        'generate_config': {'list': list_page},
    }


def _schema(definitions: dict, nav_groups: dict | None = None) -> dict:
    schema = {'definitions': definitions}
    if nav_groups is not None:
        schema['x-nav-groups'] = nav_groups
    return schema


def _keys(nodes):
    return [n['key'] for n in nodes]


def test_icon_map_covers_the_whole_allowlist():
    assert_icon_map_covers_allowlist()
    assert set(MOBILE_ICON_MAP) == set(NAV_ICON_ALLOWLIST)


def test_outlined_icons_use_the_substitute_family():
    assert SUBSTITUTED_ICONS == ['PeopleOutlined', 'SettingsOutlined', 'WorkOutlined']
    for name in SUBSTITUTED_ICONS:
        assert MOBILE_ICON_MAP[name][0] == 'MaterialCommunityIcons'


def test_no_nav_declared_gives_one_flat_tab_per_entity():
    """Desktop parity: without x-nav / x-nav-groups every entity is a flat link."""
    entities = [_entity('role'), _entity('user')]
    nav = build_mobile_nav(entities, _schema({'role': {}, 'user': {}}))
    assert _keys(nav['tabs']) == ['/role', '/user']
    for tab in nav['tabs']:
        assert tab['kind'] == 'link'
        assert tab['icon'] == {'family': DEFAULT_ENTITY_ICON[0], 'name': DEFAULT_ENTITY_ICON[1]}


def test_entity_without_list_page_has_no_tab():
    entities = [_entity('role'), _entity('hidden', list_page=False)]
    nav = build_mobile_nav(entities, _schema({'role': {}, 'hidden': {}}))
    assert _keys(nav['tabs']) == ['/role']


def test_top_level_groups_become_tabs_in_order_after_flat_links():
    entities = [_entity('alpha'), _entity('beta'), _entity('gamma'), _entity('delta')]
    schema = _schema(
        {
            'alpha': {'x-nav': {'parent': 'zeta_group', 'order': 1}},
            'beta': {'x-nav': {'parent': 'admin', 'order': 1}},
            'gamma': {},
            'delta': {},
        },
        {'zeta_group': {'order': 5, 'icon': 'Work'}, 'admin': {'order': 2, 'icon': 'Settings'}},
    )
    nav = build_mobile_nav(entities, schema)
    assert _keys(nav['tabs']) == ['/gamma', '/delta', 'admin', 'zeta_group']
    admin = nav['tabs'][2]
    assert admin['kind'] == 'group'
    assert admin['icon'] == {'family': 'MaterialIcons', 'name': 'settings'}
    assert admin['label'] == 'Admin'
    assert _keys(admin['children']) == ['/beta']


def test_group_without_icon_gets_the_default_group_icon():
    entities = [_entity('alpha')]
    schema = _schema({'alpha': {'x-nav': {'parent': 'stuff'}}})
    nav = build_mobile_nav(entities, schema)
    assert nav['tabs'][0]['icon'] == {'family': DEFAULT_GROUP_ICON[0], 'name': DEFAULT_GROUP_ICON[1]}


def test_outlined_group_icon_maps_to_the_substitute_glyph():
    entities = [_entity('alpha')]
    schema = _schema({'alpha': {'x-nav': {'parent': 'team'}}}, {'team': {'icon': 'PeopleOutlined'}})
    nav = build_mobile_nav(entities, schema)
    assert nav['tabs'][0]['icon'] == {'family': 'MaterialCommunityIcons', 'name': 'account-multiple-outline'}


def test_sublevel_lists_sub_groups_and_links_sorted_by_order():
    entities = [_entity('one'), _entity('two'), _entity('three')]
    schema = _schema(
        {
            'one': {'x-nav': {'parent': 'top', 'order': 3}},
            'two': {'x-nav': {'parent': 'sub', 'order': 1}},
            'three': {'x-nav': {'parent': 'top', 'order': 1}},
        },
        {'top': {'order': 1}, 'sub': {'parent': 'top', 'order': 2}},
    )
    nav = build_mobile_nav(entities, schema)
    assert _keys(nav['tabs']) == ['top']
    top = nav['tabs'][0]
    assert _keys(top['children']) == ['/three', 'sub', '/one']
    sub = top['children'][1]
    assert sub['kind'] == 'group'
    assert _keys(sub['children']) == ['/two']


def test_empty_group_is_omitted_at_every_level():
    entities = [_entity('one')]
    schema = _schema(
        {'one': {'x-nav': {'parent': 'top'}}},
        {'top': {}, 'empty_sub': {'parent': 'top'}, 'empty_top': {}},
    )
    nav = build_mobile_nav(entities, schema)
    assert _keys(nav['tabs']) == ['top']
    assert _keys(nav['tabs'][0]['children']) == ['/one']


def test_maximum_depth_chain_is_reachable_level_by_level():
    """An 8-deep group chain is one stack push per level, with the entity at the bottom."""
    slugs = [f'g{i}' for i in range(1, MAX_NAV_DEPTH + 1)]
    groups = {slugs[0]: {}}
    for parent, slug in zip(slugs, slugs[1:]):
        groups[slug] = {'parent': parent}
    entities = [_entity('leaf')]
    schema = _schema({'leaf': {'x-nav': {'parent': slugs[-1]}}}, groups)
    nav = build_mobile_nav(entities, schema)
    node = nav['tabs'][0]
    for slug in slugs:
        assert node['kind'] == 'group' and node['slug'] == slug
        node = node['children'][0]
    assert node['kind'] == 'link' and node['entity'] == 'leaf'


def test_depth_beyond_the_maximum_is_rejected_by_the_shared_validator():
    slugs = [f'g{i}' for i in range(1, MAX_NAV_DEPTH + 2)]
    groups = {slugs[0]: {}}
    for parent, slug in zip(slugs, slugs[1:]):
        groups[slug] = {'parent': parent}
    schema = _schema({'leaf': {'x-nav': {'parent': slugs[-1]}}}, groups)
    with pytest.raises(NavValidationError):
        build_mobile_nav([_entity('leaf')], schema)


def test_unknown_icon_is_rejected_by_the_shared_validator():
    schema = _schema({'a': {'x-nav': {'parent': 'g'}}}, {'g': {'icon': 'NotAnIcon'}})
    with pytest.raises(NavValidationError):
        build_mobile_nav([_entity('a')], schema)


def test_locale_labels_come_from_the_messages_files():
    entities = [_entity('purchase_order'), _entity('alpha')]
    schema = _schema({'purchase_order': {}, 'alpha': {'x-nav': {'parent': 'inventory_group'}}})
    messages = {
        'en': {'Nav': {'purchaseOrder': 'Purchase Orders', 'groups': {'inventory_group': 'Inventory'}}},
        'ja': {'Nav': {'groups': {'inventory_group': '在庫'}}},
    }
    nav = build_mobile_nav(entities, schema, messages)
    flat = nav['tabs'][0]
    assert flat['label'] == 'Purchase Order'
    assert flat['labels'] == {'en': 'Purchase Orders'}
    group = nav['tabs'][1]
    assert group['labels'] == {'en': 'Inventory', 'ja': '在庫'}


def test_search_tab_is_fixed_and_not_part_of_the_schema_driven_tabs():
    nav = build_mobile_nav([_entity('role')], _schema({'role': {}}))
    assert nav['search_tab']['kind'] == 'search'
    assert 'search' not in _keys(nav['tabs'])


def test_search_and_icon_substitution_report_are_present():
    nav = build_mobile_nav([], _schema({}))
    assert nav['tabs'] == []
    assert nav['icon_substitutions'] == SUBSTITUTED_ICONS
