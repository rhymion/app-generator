"""
Tests for nav_config.py — nested sidebar navigation (cmd_744 / subtask_744b).

Covers the fail-closed validators (cycle / depth / icon) required by
docs/knowledge/nested-nav-menu-design.md §2, §5.1, §5.2, §6, and the
group-list construction (§1, §3).
"""
from pathlib import Path

import pytest
from ruamel.yaml import YAML

from build_user_schema import build_user_schema
from generate_types import extract_entities
from nav_config import (
    NAV_ICON_ALLOWLIST,
    NavValidationError,
    build_nav_config,
    derive_group_label,
    group_i18n_key,
    upsert_nav_group_i18n,
)


def _entity(model: str, definition_key: str | None = None) -> dict:
    return {
        'parent': model,
        'model': model,
        'definition_key': definition_key or model,
        'children': [],
        'generate_config': {'list': True},
    }


def _schema(definitions: dict, nav_groups: dict | None = None) -> dict:
    schema = {'definitions': definitions}
    if nav_groups is not None:
        schema['x-nav-groups'] = nav_groups
    return schema


# ---------------------------------------------------------------------------
# §5.1 Label derivation
# ---------------------------------------------------------------------------

@pytest.mark.parametrize('slug,expected', [
    ('inventory_group', 'Inventory Group'),
    ('logistics', 'Logistics'),
    ('purchasing_and_procurement', 'Purchasing And Procurement'),
])
def test_derive_group_label(slug, expected):
    assert derive_group_label(slug) == expected


def test_group_i18n_key():
    assert group_i18n_key('inventory_group') == 'nav.groups.inventory_group'


# ---------------------------------------------------------------------------
# §5.2 i18n upsert idempotency (design doc's own pseudocode test, ported)
# ---------------------------------------------------------------------------

def test_upsert_preserves_human_edit():
    messages: dict = {}

    added = upsert_nav_group_i18n(messages, 'inventory_group', 'Inventory Group')
    assert added is True
    assert messages['Nav']['groups']['inventory_group'] == 'Inventory Group'

    messages['Nav']['groups']['inventory_group'] = '在庫管理'

    added_again = upsert_nav_group_i18n(messages, 'inventory_group', 'Inventory Group')
    assert added_again is False
    assert messages['Nav']['groups']['inventory_group'] == '在庫管理'


# ---------------------------------------------------------------------------
# §2 Cycle detection (fail-closed)
# ---------------------------------------------------------------------------

def test_cycle_detected():
    schema = _schema(
        definitions={},
        nav_groups={'a': {'parent': 'b'}, 'b': {'parent': 'a'}},
    )
    with pytest.raises(NavValidationError, match='cycle detected'):
        build_nav_config([], schema)


def test_self_cycle_detected():
    schema = _schema(definitions={}, nav_groups={'a': {'parent': 'a'}})
    with pytest.raises(NavValidationError, match='cycle detected'):
        build_nav_config([], schema)


# ---------------------------------------------------------------------------
# §2 Max depth guard (fail-closed)
# ---------------------------------------------------------------------------

def _build_chain_schema(depth: int) -> dict:
    """A linear chain of `depth` nav groups: g0 -> g1 -> ... -> g{depth-1}."""
    nav_groups = {'g0': {}}
    for i in range(1, depth):
        nav_groups[f'g{i}'] = {'parent': f'g{i - 1}'}
    return _schema(definitions={}, nav_groups=nav_groups)


def test_max_depth_exceeded():
    schema = _build_chain_schema(depth=9)  # 9-level group chain
    with pytest.raises(NavValidationError, match='depth exceeds maximum'):
        build_nav_config([], schema)


def test_max_depth_at_limit_is_allowed():
    schema = _build_chain_schema(depth=8)
    result = build_nav_config([], schema)
    assert len(result['groups']) == 8


def test_depth_error_names_the_chain_and_depth():
    schema = _build_chain_schema(depth=9)
    with pytest.raises(NavValidationError) as exc_info:
        build_nav_config([], schema)
    msg = str(exc_info.value)
    assert 'g0 -> g1' in msg
    assert '(depth 9)' in msg


# ---------------------------------------------------------------------------
# §2 Unknown parent slug referenced from x-nav-groups (fail-closed)
# ---------------------------------------------------------------------------

def test_unknown_parent_slug_rejected():
    schema = _schema(definitions={}, nav_groups={'a': {'parent': 'ghost'}})
    with pytest.raises(NavValidationError, match="not defined in x-nav-groups"):
        build_nav_config([], schema)


# ---------------------------------------------------------------------------
# §6 Icon allowlist (fail-closed for unknown names)
# ---------------------------------------------------------------------------

def test_unknown_icon_rejected():
    schema = _schema(
        definitions={},
        nav_groups={'inventory_group': {'icon': 'TotallyMadeUpIcon'}},
    )
    with pytest.raises(NavValidationError, match="Unknown nav icon 'TotallyMadeUpIcon'"):
        build_nav_config([], schema)


def test_known_icon_accepted():
    schema = _schema(
        definitions={},
        nav_groups={'inventory_group': {'icon': 'Inventory2'}},
    )
    result = build_nav_config([], schema)
    assert result['groups'][0]['icon'] == 'Inventory2'


def test_every_allowlisted_icon_is_accepted():
    for icon in NAV_ICON_ALLOWLIST:
        schema = _schema(definitions={}, nav_groups={'g': {'icon': icon}})
        result = build_nav_config([], schema)
        assert result['groups'][0]['icon'] == icon


# ---------------------------------------------------------------------------
# §1/§3 Group construction: implicit groups, ordering, entity_group mapping
# ---------------------------------------------------------------------------

def _entity_with_nav(model: str, parent: str, order: int | None = None) -> tuple[dict, dict]:
    """Returns (entity, raw_definition) — raw_definition carries x-nav."""
    x_nav = {'parent': parent}
    if order is not None:
        x_nav['order'] = order
    return _entity(model), {'x-nav': x_nav}


def test_default_schema_produces_no_groups():
    """Golden-diff-zero precondition: no x-nav anywhere -> empty group list."""
    entities = [_entity('widget')]
    schema = _schema(definitions={'widget': {}})
    result = build_nav_config(entities, schema)
    assert result['groups'] == []
    assert result['entity_group'] == {}


def test_implicit_group_needs_no_x_nav_groups_entry():
    """Option A (recommended): a group referenced only via entity x-nav.parent
    needs no companion x-nav-groups entry — label/i18n are derived from the slug."""
    entity, defn = _entity_with_nav('inventory_reservation', 'inventory_group', order=2)
    schema = _schema(definitions={'inventory_reservation': defn})
    result = build_nav_config([entity], schema)
    assert len(result['groups']) == 1
    group = result['groups'][0]
    assert group['slug'] == 'inventory_group'
    assert group['label'] == 'Inventory Group'
    assert group['i18n_key'] == 'nav.groups.inventory_group'
    assert group['parent'] is None
    assert result['entity_group']['inventory_reservation'] == {'group': 'inventory_group', 'order': 2}


def test_group_order_is_min_of_child_orders():
    e1, d1 = _entity_with_nav('inventory_transaction', 'inventory_group', order=1)
    e2, d2 = _entity_with_nav('inventory_reservation', 'inventory_group', order=2)
    schema = _schema(definitions={'inventory_transaction': d1, 'inventory_reservation': d2})
    result = build_nav_config([e1, e2], schema)
    assert result['groups'][0]['order'] == 1


def test_entity_without_order_defaults_last():
    entity, defn = _entity_with_nav('inventory_reservation', 'inventory_group')
    schema = _schema(definitions={'inventory_reservation': defn})
    result = build_nav_config([entity], schema)
    assert result['entity_group']['inventory_reservation']['order'] == 999
    assert result['groups'][0]['order'] == 999


def test_group_to_group_hierarchy_via_x_nav_groups():
    """§2: x-nav-groups is additive and only required for group-to-group nesting."""
    e1, d1 = _entity_with_nav('inventory_reservation', 'inventory_group', order=2)
    e2, d2 = _entity_with_nav('inventory_transaction', 'inventory_group', order=1)
    schema = _schema(
        definitions={'inventory_reservation': d1, 'inventory_transaction': d2},
        nav_groups={
            'logistics_group': {'order': 5},
            'inventory_group': {'parent': 'logistics_group', 'order': 1},
            'purchasing_group': {'parent': 'logistics_group', 'order': 2},
        },
    )
    result = build_nav_config([e1, e2], schema)
    by_slug = {g['slug']: g for g in result['groups']}
    assert by_slug['inventory_group']['parent'] == 'logistics_group'
    assert by_slug['purchasing_group']['parent'] == 'logistics_group'
    assert by_slug['logistics_group']['parent'] is None
    # explicit order in x-nav-groups wins over the min-child-order default
    assert by_slug['inventory_group']['order'] == 1


def test_typo_warning_for_single_reference_slug(capsys):
    entity, defn = _entity_with_nav('widget', 'probably_a_typo_grup')
    schema = _schema(definitions={'widget': defn})
    build_nav_config([entity], schema)
    captured = capsys.readouterr()
    assert 'WARNING' in captured.out
    assert 'probably_a_typo_grup' in captured.out


def test_no_typo_warning_when_multiple_entities_reference_slug(capsys):
    e1, d1 = _entity_with_nav('widget_a', 'inventory_group')
    e2, d2 = _entity_with_nav('widget_b', 'inventory_group')
    schema = _schema(definitions={'widget_a': d1, 'widget_b': d2})
    build_nav_config([e1, e2], schema)
    captured = capsys.readouterr()
    assert 'WARNING' not in captured.out


def test_no_typo_warning_when_group_declared_in_x_nav_groups(capsys):
    entity, defn = _entity_with_nav('widget', 'inventory_group')
    schema = _schema(
        definitions={'widget': defn},
        nav_groups={'inventory_group': {'order': 1}},
    )
    build_nav_config([entity], schema)
    captured = capsys.readouterr()
    assert 'WARNING' not in captured.out


# ---------------------------------------------------------------------------
# Regression: x-nav must survive build_user_schema.py's Stage-4 raw/view
# split for a PAIRED entity (one with its own x-generate, e.g. 'organization'
# in the default schema) — not just in hand-built pytest schema dicts.
#
# Found via cmd_744 proj_c testbed verification: x-nav was silently dropped
# for every paired entity because (a) build_user_schema.py's
# _ENTITY_LEVEL_DATA_KEYS allowlist (the Category C keys copied onto the
# raw '__'-prefixed entity) omitted 'x-nav', and (b) even after fixing (a),
# _entity_nav()'s raw-entity fallback was gated on
# entity['model'] != entity['parent'], which is False for the common case
# of a paired entity whose model equals its own parent — silently skipping
# the fallback that would have found it. Both entity_group.get(...) being
# empty (no 'group:'/'order:' tag on the generated navLink) and the group's
# own order falling back to 999 (no child order contributed) were the
# observable symptoms in the actual generated lib/site-config.ts.
# ---------------------------------------------------------------------------

_REPO_ROOT = Path(__file__).parent.parent
_PRISMA_SCHEMA_PATH = _REPO_ROOT.parent / 'prisma' / 'schema.prisma'


def test_x_nav_survives_raw_view_split_for_paired_entity(tmp_path):
    """'organization' is a paired entity (PAIRED_ENTITIES in
    test_build_user_schema_roundtrip.py) in the live default schema — its
    own x-generate triggers the raw/view split. Declaring x-nav on it here
    must make it through build_user_schema.py to the raw entity, and
    nav_config.build_nav_config (fed via generate_types.extract_entities,
    the same path generate.py itself uses) must resolve it from there."""
    yaml = YAML()
    yaml.preserve_quotes = True
    with (_REPO_ROOT / 'json_schema.yaml').open('r', encoding='utf-8') as f:
        user_schema = yaml.load(f)

    assert 'x-nav' not in user_schema['definitions']['organization'], (
        'default schema must not declare x-nav on organization (golden-diff-zero, §9)'
    )
    user_schema['definitions']['organization']['x-nav'] = {'parent': 'admin_group', 'order': 1}

    in_path = tmp_path / 'json_schema.yaml'
    with in_path.open('w', encoding='utf-8') as f:
        yaml.dump(user_schema, f)
    out_path = tmp_path / '.generated' / 'json_schema.yaml'

    build_user_schema(in_path, _PRISMA_SCHEMA_PATH, out_path)

    built = YAML(typ='safe').load(out_path.read_text(encoding='utf-8'))
    assert built['definitions']['__organization'].get('x-nav') == {
        'parent': 'admin_group', 'order': 1,
    }, "x-nav must survive onto the raw '__organization' entity"

    entities = extract_entities(built)
    org_entity = next(e for e in entities if e['model'] == 'organization')
    result = build_nav_config(entities, built)
    assert result['entity_group'].get('organization') == {'group': 'admin_group', 'order': 1}, (
        f"build_nav_config must resolve organization's x-nav via extract_entities' own "
        f"definition_key ({org_entity['definition_key']!r}) / model ({org_entity['model']!r})"
    )


# ---------------------------------------------------------------------------
# cmd_813 ①: x-nav resolved at VIEW unit (proxy views sharing one model can
# sit in different groups/orders independently), with fallback to the raw
# model's x-nav when a view declares none of its own.
# ---------------------------------------------------------------------------

def _proxy_entity(parent: str, model: str) -> dict:
    return {
        'parent': parent,
        'model': model,
        'definition_key': parent,
        'children': [],
        'generate_config': {'list': True},
    }


def test_two_proxy_views_sharing_model_get_independent_groups():
    """setting1/setting2-shaped case: same model, two views, each with its
    own x-nav declared directly under its own (pass-through) definitions
    key — must resolve to two different groups/orders, not collapse onto
    one shared model-keyed entry (cmd_813 ①, cmd_812 Q4)."""
    view_a = _proxy_entity('view_a', 'shared_model')
    view_b = _proxy_entity('view_b', 'shared_model')
    schema = _schema(definitions={
        'view_a': {'x-nav': {'parent': 'group_a', 'order': 1}},
        'view_b': {'x-nav': {'parent': 'group_b', 'order': 5}},
    })
    result = build_nav_config([view_a, view_b], schema)
    assert result['entity_group']['view_a'] == {'group': 'group_a', 'order': 1}
    assert result['entity_group']['view_b'] == {'group': 'group_b', 'order': 5}
    assert 'shared_model' not in result['entity_group']


def test_proxy_view_without_own_x_nav_falls_back_to_raw_model():
    """A proxy view with no view-level x-nav of its own still resolves the
    raw model's x-nav — the fallback cmd_813 ① explicitly requires keeping
    (do not drop the raw-model reference entirely)."""
    view = _proxy_entity('view_a', 'shared_model')
    schema = _schema(definitions={
        '__shared_model': {'x-nav': {'parent': 'model_group', 'order': 2}},
        'view_a': {},
    })
    result = build_nav_config([view], schema)
    assert result['entity_group']['view_a'] == {'group': 'model_group', 'order': 2}


def test_proxy_view_own_x_nav_overrides_raw_model_x_nav():
    """When both the view and its raw model declare x-nav, the view-level
    declaration wins (view unit takes priority; model is the fallback)."""
    view = _proxy_entity('view_a', 'shared_model')
    schema = _schema(definitions={
        '__shared_model': {'x-nav': {'parent': 'model_group', 'order': 2}},
        'view_a': {'x-nav': {'parent': 'view_group', 'order': 9}},
    })
    result = build_nav_config([view], schema)
    assert result['entity_group']['view_a'] == {'group': 'view_group', 'order': 9}
