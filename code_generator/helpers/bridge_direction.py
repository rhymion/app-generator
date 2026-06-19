"""
bridge_direction.py — FK-on-parent bridge direction IR helpers.

Naming convention: `<model>able` bridge name → child entity is `<model>`.

Examples:
  commentable → child = comment,  parents = [channel, ...]
  channelable → child = channel,  parents = [work, character, scene]
  bookmarkable → child = bookmark,  parents = [work, character, music, channel]
"""


def bridge_child_from_name(bridge_name: str) -> str:
    """Derive child entity name from bridge model name by stripping 'able' suffix."""
    if bridge_name.endswith('able'):
        return bridge_name[:-4]
    return bridge_name


def get_new_form_bridge(entity_def: dict) -> dict | None:
    """Parse new-form x-bridge (object/dict) from entity definition.

    New form:
        x-bridge:
          name: channelable
          child: channel
          parentCardinality: exactlyOne
          parents:
            - role: work_hub
              target: work
              labelField: title

    Returns None if absent or is the old array form.
    """
    x_bridge = entity_def.get('x-bridge')
    if not x_bridge or not isinstance(x_bridge, dict):
        return None
    name = x_bridge.get('name')
    child = x_bridge.get('child')
    if not name or not child:
        return None
    parents_raw = x_bridge.get('parents') or []
    parents = [
        {
            'role': p.get('role', ''),
            'target': p.get('target', ''),
            'label_field': p.get('labelField', 'name'),
        }
        for p in parents_raw
        if isinstance(p, dict) and p.get('target')
    ]
    return {
        'name': name,
        'child': child,
        'cardinality': x_bridge.get('parentCardinality', 'exactlyOne'),
        'parents': parents,
        'parent_targets': [p['target'] for p in parents],
    }


def collect_parent_bridge_fk_props(model: str, schema: dict) -> dict:
    """Return synthetic FK property dicts to inject into a parent entity.

    Scans all entities with new-form x-bridge and returns FK properties for
    bridges where `model` is listed as a parent. The injected FK looks like a
    one-to-one_bridge relation so the existing OTO machinery handles create/include.

    Returns dict of {<bridge_name>_id: prop_def, ...}.
    """
    injected: dict = {}
    for entity_name, entity_def in schema.get('definitions', {}).items():
        if not isinstance(entity_def, dict):
            continue
        if entity_name.endswith('_detail'):
            continue
        bridge = get_new_form_bridge(entity_def)
        if not bridge:
            continue
        if model not in bridge['parent_targets']:
            continue
        bridge_name = bridge['name']
        fk_col = f'{bridge_name}_id'
        injected[fk_col] = {
            'type': 'string',
            'pattern': '^c[a-z0-9]{24,}$',
            'x-relationship': {
                'type': 'one-to-one_bridge',
                'target': bridge_name,
            },
        }
    return injected


def collect_parent_bridge_children(model: str, schema: dict) -> list[dict]:
    """Return the bridge children that should be embedded as a DataGrid on `model`.

    Mirror of collect_parent_bridge_fk_props(): scans all entities with new-form
    x-bridge and returns one descriptor per bridge whose `parents` list contains
    `model`. Used to render a parent-embedded child DataGrid (cmd_167 §4) — the
    parent owns CRUD for these children, bound to its `<bridge>_id`.

    Each descriptor:
        {
          'child':      'channel',            # child entity name
          'bridge_name':'channelable',        # bridge model
          'parent_fk':  'channelable_id',     # FK column on the parent
          'role':       'work_hub',           # this parent's edge role
          'label_field':'title',              # this parent's label field
          'columns':    [ ... x-display.table ... ],   # child grid columns ([] if none)
        }
    """
    defs = schema.get('definitions', {})
    out: list[dict] = []
    for entity_name, entity_def in defs.items():
        if not isinstance(entity_def, dict) or entity_name.endswith('_detail'):
            continue
        bridge = get_new_form_bridge(entity_def)
        if not bridge:
            continue
        match = next((p for p in bridge['parents'] if p['target'] == model), None)
        if not match:
            continue
        columns = (entity_def.get('x-display') or {}).get('table') or []
        out.append({
            'child':       bridge['child'],
            'bridge_name': bridge['name'],
            'parent_fk':   f"{bridge['name']}_id",
            'role':        match['role'],
            'label_field': match['label_field'],
            'columns':     columns,
        })
    return out
