"""
mobile_nav.py — footer-tab / drill-down navigation data for the generated
Expo mobile app.

The mobile app is navigated from the SAME source as the desktop sidebar:
`nav_config.build_nav_config()` (x-nav on entities, x-nav-groups at the
top level) plus `nav_config.nav_list_entities()` (which entities have a list
page). Nothing here reads the schema a second time and no schema key is
introduced.

Mapping onto the desktop sidebar tree (lib/nav-tree.ts `buildRootTree`):

* Footer tabs = the sidebar's root level: flat (ungrouped) entity links in
  their existing order, then top-level groups sorted by `order`.
* Selecting a group tab lists that group's sub-groups and entity links on the
  main screen (`children`), sorted like the sidebar sorts siblings; selecting
  a sub-group pushes the next level, to any depth up to MAX_NAV_DEPTH.
* A group with no descendants is omitted, as on the desktop.

Permission filtering needs the caller's identity and therefore happens at
runtime in the app (GET /api/mobile/nav returns the hidden hrefs); this module
emits the full static tree and the app prunes it.
"""
from __future__ import annotations

from helpers.naming import to_camel_case, to_title_case
from nav_config import (
    NAV_ICON_ALLOWLIST,
    build_nav_config,
    nav_list_entities,
)

# Icon used for a flat (ungrouped) entity tab, which has no icon of its own
# (entities carry no icon key; only x-nav-groups do), and for a group declared
# without an icon. Changing either is a one-line edit here.
DEFAULT_ENTITY_ICON = ('MaterialIcons', 'description')
DEFAULT_GROUP_ICON = ('MaterialIcons', 'folder')

# Footer search tab: UI-only, not tied to any entity's x-nav.
SEARCH_TAB_ICON = ('MaterialIcons', 'search')

# Every name in nav_config.NAV_ICON_ALLOWLIST -> (icon family, glyph) in
# @expo/vector-icons. The *Outlined names have no outlined glyph in the
# MaterialIcons family, so they map to the closest *-outline glyphs in
# MaterialCommunityIcons (visually similar, not identical to the desktop).
MOBILE_ICON_MAP: dict[str, tuple[str, str]] = {
    'Folder': ('MaterialIcons', 'folder'),
    'FolderOpen': ('MaterialIcons', 'folder-open'),
    'Work': ('MaterialIcons', 'work'),
    'WorkOutlined': ('MaterialCommunityIcons', 'briefcase-outline'),
    'People': ('MaterialIcons', 'people'),
    'PeopleOutlined': ('MaterialCommunityIcons', 'account-multiple-outline'),
    'Settings': ('MaterialIcons', 'settings'),
    'SettingsOutlined': ('MaterialCommunityIcons', 'cog-outline'),
    'Inventory': ('MaterialIcons', 'inventory'),
    'Inventory2': ('MaterialIcons', 'inventory-2'),
    'ShoppingCart': ('MaterialIcons', 'shopping-cart'),
    'LocalShipping': ('MaterialIcons', 'local-shipping'),
    'Assignment': ('MaterialIcons', 'assignment'),
    'Description': ('MaterialIcons', 'description'),
    'Build': ('MaterialIcons', 'build'),
    'Widgets': ('MaterialIcons', 'widgets'),
    'Dashboard': ('MaterialIcons', 'dashboard'),
    'AccountTree': ('MaterialIcons', 'account-tree'),
    'Category': ('MaterialIcons', 'category'),
    'AttachMoney': ('MaterialIcons', 'attach-money'),
}

# Allowlisted names that render with a different (substitute) glyph family
# than the desktop's MUI icon. Surfaced in docs and asserted by tests.
SUBSTITUTED_ICONS = sorted(
    name for name, (family, _) in MOBILE_ICON_MAP.items() if family != 'MaterialIcons'
)

_DEFAULT_ORDER = 999

# The audit log is a built-in feature, not a schema entity, so the schema-driven
# links never include it. The desktop sidebar lists it under the "administration"
# group (lib/site-config.ts) at this order; the mobile link takes the same place
# when the schema declares that group, and is a flat tab when it does not.
AUDIT_LOG_ENTITY = 'audit_log'
AUDIT_LOG_GROUP = 'administration'
AUDIT_LOG_ORDER = 80


def _icon(pair: tuple[str, str]) -> dict:
    return {'family': pair[0], 'name': pair[1]}


def resolve_group_icon(icon_name: str | None) -> dict:
    """Mobile icon for an x-nav-groups icon name (already validated against the
    allowlist by build_nav_config); a group without an icon gets the default."""
    if icon_name is None:
        return _icon(DEFAULT_GROUP_ICON)
    return _icon(MOBILE_ICON_MAP[icon_name])


def _locale_labels(messages: dict[str, dict], path: tuple[str, ...]) -> dict[str, str]:
    """{locale: text} for the message at `path` in each locale's messages."""
    labels: dict[str, str] = {}
    for locale, data in sorted(messages.items()):
        node = data
        for key in path:
            node = node.get(key) if isinstance(node, dict) else None
            if node is None:
                break
        if isinstance(node, str):
            labels[locale] = node
    return labels


def _sort_key(node: dict) -> tuple:
    return (node['order'], node['key'])


def build_mobile_nav(
    entities: list, schema: dict, messages: dict[str, dict] | None = None,
    include_audit_log: bool = False,
) -> dict:
    """
    Build the mobile navigation data from the desktop sidebar's own source.

    Returns:
        {
          'tabs': [node, ...],      # footer tabs, in display order
          'search_tab': {...},      # fixed trailing tab, not schema-driven
          'icon_substitutions': [...],
        }

    A `node` is either
        {'kind': 'link', 'key': '/role', 'href': '/role', 'entity': 'role',
         'label': 'Role', 'labels': {locale: text}, 'order': int,
         'icon': {family, name}}
    or
        {'kind': 'group', 'key': slug, 'slug': slug, 'label': ..., 'labels': {...},
         'order': int, 'icon': {family, name}, 'children': [node, ...]}

    `messages` ({locale: parsed messages json}) supplies per-locale labels:
    `Nav.groups.<slug>` for groups and `Nav.<camelCase(entity)>` for entities.
    Absent keys fall back to the label the sidebar derives from the name.

    `include_audit_log` adds the built-in audit log link (see AUDIT_LOG_GROUP).
    """
    messages = messages or {}
    nav_config = build_nav_config(entities, schema)
    entity_group = nav_config['entity_group']

    link_nodes = []
    for entity in nav_list_entities(entities):
        name = entity['parent']
        info = entity_group.get(name)
        link_nodes.append({
            'kind': 'link',
            'key': f'/{name}',
            'href': f'/{name}',
            'entity': name,
            'label': to_title_case(name),
            'labels': _locale_labels(messages, ('Nav', to_camel_case(name))),
            'order': info['order'] if info else _DEFAULT_ORDER,
            'icon': _icon(DEFAULT_ENTITY_ICON),
            'group': info['group'] if info else None,
        })

    if include_audit_log and not any(n['entity'] == AUDIT_LOG_ENTITY for n in link_nodes):
        group_slugs = {g['slug'] for g in nav_config['groups']}
        link_nodes.append({
            'kind': 'link',
            'key': f'/{AUDIT_LOG_ENTITY}',
            'href': f'/{AUDIT_LOG_ENTITY}',
            'entity': AUDIT_LOG_ENTITY,
            'label': to_title_case(AUDIT_LOG_ENTITY),
            'labels': _locale_labels(messages, ('Nav', to_camel_case(AUDIT_LOG_ENTITY))),
            'order': AUDIT_LOG_ORDER,
            'icon': _icon(DEFAULT_ENTITY_ICON),
            'group': AUDIT_LOG_GROUP if AUDIT_LOG_GROUP in group_slugs else None,
        })

    def group_children(parent_slug: str) -> list[dict]:
        children: list[dict] = [dict(n) for n in link_nodes if n['group'] == parent_slug]
        for group in nav_config['groups']:
            if group['parent'] != parent_slug:
                continue
            node = group_node(group)
            if node['children']:
                children.append(node)
        return sorted(children, key=_sort_key)

    def group_node(group: dict) -> dict:
        slug = group['slug']
        return {
            'kind': 'group',
            'key': slug,
            'slug': slug,
            'label': group['label'],
            'labels': _locale_labels(messages, ('Nav', 'groups', slug)),
            'order': group['order'],
            'icon': resolve_group_icon(group['icon']),
            'children': group_children(slug),
        }

    flat_tabs = [dict(n) for n in link_nodes if n['group'] is None]
    group_tabs = [
        node
        for node in (group_node(g) for g in nav_config['groups'] if g['parent'] is None)
        if node['children']
    ]
    group_tabs.sort(key=lambda n: (n['order'], n['slug']))

    def strip(node: dict) -> dict:
        node.pop('group', None)
        for child in node.get('children', []):
            strip(child)
        return node

    tabs = [strip(n) for n in flat_tabs + group_tabs]
    return {
        'tabs': tabs,
        'search_tab': {
            'kind': 'search',
            'key': 'search',
            'label': 'Search',
            'labels': _locale_labels(messages, ('Nav', 'search')),
            'icon': _icon(SEARCH_TAB_ICON),
        },
        'icon_substitutions': list(SUBSTITUTED_ICONS),
    }


def assert_icon_map_covers_allowlist() -> None:
    """Fail loudly when nav_config grows an icon name this module cannot map."""
    missing = [n for n in NAV_ICON_ALLOWLIST if n not in MOBILE_ICON_MAP]
    if missing:
        raise AssertionError(f'MOBILE_ICON_MAP is missing nav icons: {", ".join(missing)}')
