"""
nav_config.py — Nested sidebar navigation: schema parsing, validation, and
group-list construction for `x-nav` (entity-side) / `x-nav-groups` (top-level,
group-to-group hierarchy).

See docs/knowledge/nested-nav-menu-design.md for the full design (D1-D11).
Entirely additive: a schema with no `x-nav`/`x-nav-groups` produces an empty
group list and every entity keeps its flat (ungrouped) nav entry.
"""
from __future__ import annotations

from helpers.naming import to_camel_case, to_title_case

# §2: configurable max depth guard for the group parent chain. Schemas whose
# x-nav-groups parent chain exceeds this fail generation (fail-closed).
MAX_NAV_DEPTH = 8

# Icon names NavGroupWrapper.tsx statically imports into its ICON_MAP. This is
# the single source of truth the generator validates x-nav-groups.<slug>.icon
# against — keep in sync with components/_standard/NavGroupWrapper.tsx's
# ICON_MAP keys (its own module docstring points back here).
NAV_ICON_ALLOWLIST = [
    'Folder', 'FolderOpen', 'Work', 'WorkOutlined', 'People', 'PeopleOutlined',
    'Settings', 'SettingsOutlined', 'Inventory', 'Inventory2', 'ShoppingCart',
    'LocalShipping', 'Assignment', 'Description', 'Build', 'Widgets',
    'Dashboard', 'AccountTree', 'Category', 'AttachMoney',
]

# Entities without an explicit x-nav.order (§3), and groups without an
# explicit order (from x-nav-groups or the min-child-order fallback), sort
# last, in this bucket.
_DEFAULT_ORDER = 999


class NavValidationError(Exception):
    """Raised at code-generation time for an invalid x-nav / x-nav-groups declaration."""


def derive_group_label(slug: str) -> str:
    """'inventory_group' -> 'Inventory Group' (§5.1: split on '_', capitalize
    each word, join with a space) — same rule as helpers.naming.to_title_case."""
    return to_title_case(slug)


def group_i18n_key(slug: str) -> str:
    return f'nav.groups.{slug}'


def _raw_def(entity_name: str, schema: dict) -> dict:
    defs = schema.get('definitions', {})
    return defs.get(f'__{entity_name}', {}) or defs.get(entity_name, {})


def _entity_nav(entity: dict, schema: dict) -> dict | None:
    """Return this entity's `x-nav` dict, or None.

    build_user_schema.py's Stage-4 raw/view split moves entity-level
    annotations (x-nav included, see its `_ENTITY_LEVEL_DATA_KEYS`) onto
    the raw ('__'-prefixed) entity, not the view — so this must resolve
    the raw entity the same way every other entity-level annotation reader
    in the generator does (build_context.py's own `_raw_def`), not gate on
    entity['model'] != entity['parent'] (that condition is about proxy
    views like 'setting', unrelated to whether a raw/view split happened,
    and false for the common case of a paired entity whose model name
    equals its own parent — which silently dropped x-nav for exactly that
    case, cmd_744 proj_c verification). The definition_key lookup remains
    as a fallback for hand-authored schemas (e.g. this module's own pytest
    fixtures) that declare x-nav directly under the bare entity key with
    no raw/view split at all.
    """
    x_nav = _raw_def(entity['model'], schema).get('x-nav')
    if not x_nav:
        def_key = entity.get('definition_key') or entity.get('model')
        x_nav = schema.get('definitions', {}).get(def_key, {}).get('x-nav')
    return x_nav if isinstance(x_nav, dict) else None


def _validate_cycles_and_depth(group_defs: dict[str, dict]) -> dict[str, int]:
    """DFS over x-nav-groups' `parent` edges. Returns {slug: depth} (1 = top
    level). Raises NavValidationError on a cycle or on exceeding MAX_NAV_DEPTH."""
    depths: dict[str, int] = {}

    def _depth(slug: str, path: list[str]) -> int:
        if slug in depths:
            return depths[slug]
        if slug in path:
            chain = ' -> '.join(path + [slug])
            raise NavValidationError(f'nav group cycle detected: {chain}')
        parent = group_defs.get(slug, {}).get('parent')
        if parent is None:
            depth = 1
        else:
            if parent not in group_defs:
                raise NavValidationError(
                    f"nav group '{slug}' declares parent '{parent}', which is not "
                    f"defined in x-nav-groups"
                )
            depth = 1 + _depth(parent, path + [slug])
        depths[slug] = depth
        if depth > MAX_NAV_DEPTH:
            full_chain = ' -> '.join(_chain_to_root(slug, group_defs))
            raise NavValidationError(
                f'nav group depth exceeds maximum ({MAX_NAV_DEPTH}): '
                f'path: {full_chain} (depth {depth})'
            )
        return depth

    for slug in group_defs:
        _depth(slug, [])
    return depths


def _chain_to_root(slug: str, group_defs: dict[str, dict]) -> list[str]:
    chain = [slug]
    seen = {slug}
    cur = slug
    while True:
        parent = group_defs.get(cur, {}).get('parent')
        if not parent or parent in seen:
            break
        chain.append(parent)
        seen.add(parent)
        cur = parent
    return list(reversed(chain))


def build_nav_config(entities: list, schema: dict) -> dict:
    """
    Parse `x-nav.parent`/`x-nav.order` off every entity plus the optional
    top-level `x-nav-groups` section, validate (DAG / max depth / icon
    allowlist), and return:

        {
          'groups': [
              {'slug', 'label', 'i18n_key', 'order', 'icon', 'parent'}, ...
          ],   # every group referenced by an entity or declared in x-nav-groups
          'entity_group': {model_name: {'group': slug, 'order': int}},
        }

    Raises NavValidationError for a cycle, excess depth, or unknown icon name.
    """
    x_nav_groups_raw = schema.get('x-nav-groups') or {}
    if not isinstance(x_nav_groups_raw, dict):
        raise NavValidationError("x-nav-groups must be a mapping of slug -> group config")

    entity_group: dict[str, dict] = {}
    referenced_slugs: dict[str, int] = {}  # slug -> reference count (typo-warning heuristic)
    child_orders: dict[str, list[int]] = {}

    for entity in entities:
        x_nav = _entity_nav(entity, schema)
        if not x_nav:
            continue
        parent_slug = x_nav.get('parent')
        if not parent_slug:
            continue
        order = x_nav.get('order', _DEFAULT_ORDER)
        entity_group[entity['model']] = {'group': parent_slug, 'order': order}
        referenced_slugs[parent_slug] = referenced_slugs.get(parent_slug, 0) + 1
        child_orders.setdefault(parent_slug, []).append(order)

    all_slugs = set(x_nav_groups_raw) | set(referenced_slugs)

    # Cycle + depth validation is scoped to explicit x-nav-groups parent
    # edges only — a group that exists purely because an entity references
    # it has no `parent` of its own and is always top-level.
    _validate_cycles_and_depth(x_nav_groups_raw)

    groups = []
    for slug in sorted(all_slugs):
        cfg = x_nav_groups_raw.get(slug, {})
        parent = cfg.get('parent')
        if parent is not None and parent not in all_slugs:
            raise NavValidationError(
                f"nav group '{slug}' declares parent '{parent}', which is not "
                f"defined in x-nav-groups"
            )
        icon = cfg.get('icon')
        if icon is not None and icon not in NAV_ICON_ALLOWLIST:
            raise NavValidationError(
                f"Unknown nav icon '{icon}' in group '{slug}'. "
                f"Supported icons: {', '.join(NAV_ICON_ALLOWLIST)}"
            )
        explicit_order = cfg.get('order')
        if explicit_order is not None:
            order = explicit_order
        elif child_orders.get(slug):
            order = min(child_orders[slug])
        else:
            order = _DEFAULT_ORDER
        groups.append({
            'slug': slug,
            'label': derive_group_label(slug),
            'i18n_key': group_i18n_key(slug),
            'order': order,
            'icon': icon,
            'parent': parent,
        })
        if referenced_slugs.get(slug, 0) == 1 and slug not in x_nav_groups_raw:
            print(
                f"  WARNING: nav group '{slug}' is referenced by exactly one entity "
                f"and has no x-nav-groups entry -- check for a typo'd slug"
            )

    groups.sort(key=lambda g: (g['order'], g['slug']))

    return {'groups': groups, 'entity_group': entity_group}


# ---------------------------------------------------------------------------
# i18n upsert (§5.2) — upsert-only, never overwrites an existing value.
# ---------------------------------------------------------------------------

def upsert_nav_group_i18n(messages: dict, key: str, derived_label: str) -> bool:
    """Insert messages['Nav']['groups'][key] = derived_label only if the key is
    absent. Returns True if a new key was added, False if an existing value
    was preserved untouched (critical invariant: regeneration must never clobber
    a human translation — see docs/knowledge/nested-nav-menu-design.md §5.2)."""
    nav = messages.setdefault('Nav', {})
    nav_groups = nav.setdefault('groups', {})
    if key not in nav_groups:
        nav_groups[key] = derived_label
        return True
    return False
