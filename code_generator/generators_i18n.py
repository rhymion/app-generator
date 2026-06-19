"""
generators_i18n.py — Update i18n message files and config files with new entity keys.

Called once after all entities are generated. Only adds missing keys — never
removes or overwrites existing values so manual translations are preserved.

Updates:
  messages/en.json         Nav, EntityLabel, Fields sections
  messages/ja.json         same (placeholder values for manual translation)
  lib/site-config.ts       navLinks array
  app/[locale]/@sidebar/page.tsx  navTranslationKeys object
"""
import json
import re
from pathlib import Path

from helpers.naming import to_camel_case, to_title_case
from helpers.schema_helpers import filter_fields


# ---------------------------------------------------------------------------
# Field key collection
# ---------------------------------------------------------------------------

_SYSTEM_PROPS = {'id', 'created_at', 'updated_at', 'creator_id', 'updater_id'}

# i18n keys (Fields namespace) required by each named custom component.
# When a schema entity uses x-custom-components with one of these names, its
# keys are injected into every language file automatically.
_CUSTOM_COMPONENT_FIELD_KEYS: dict[str, dict[str, str]] = {
    'ApprovalSection': {
        'approve': 'Approve',
        'approvalHistory': 'Approval History',
        'approvalRequests': 'Approval Requests',
        'message': 'Message',
        'reject': 'Reject',
        'resubmit': 'Re-submit',
    },
}


def _collect_field_keys(entities: list, schema: dict) -> dict[str, str]:
    """Return {camelCaseKey: 'Title Case Label'} for every field across all entities."""
    keys: dict[str, str] = {}

    for entity in entities:
        model = entity['model']
        gen_cfg = entity['generate_config']

        model_def = schema['definitions'].get(model, {})
        props = filter_fields(model_def.get('properties', {}), gen_cfg.get('fields'))

        # Bridge-child entities (x-bridge) render read-only parent type/label fields
        # via tf('parentType') / tf('parentLabel'). These are synthetic display fields,
        # not real properties, so emit their i18n keys explicitly to avoid MISSING_MESSAGE.
        _mbridge = model_def.get('x-bridge')
        if isinstance(_mbridge, dict) and _mbridge.get('name'):
            keys.setdefault('parentType', 'Parent Type')
            keys.setdefault('parentLabel', 'Parent Label')

        for prop_name, prop in props.items():
            if prop_name in _SYSTEM_PROPS:
                continue

            rel = prop.get('x-relationship', {})
            rel_type = rel.get('type')
            if rel_type in ('many-to-one', 'one-to-one'):
                # FK field (regular m2o or selector o2o): strip _id suffix for the
                # display key. Generated FormUpsert/FormView use tf('<base>') as the
                # picker label (e.g. medicine.prev_id → tf('prev')).
                base = prop_name[:-3] if prop_name.endswith('_id') else prop_name
                key = to_camel_case(base)
                label = to_title_case(base)
            elif rel_type == 'one-to-one_bridge':
                # Bridge OTO targets (approvable, commentable) are internal records
                # rendered via their own component-level keys, not a field label.
                continue
            else:
                key = to_camel_case(prop_name)
                label = to_title_case(prop_name)

            keys.setdefault(key, label)

        # Custom component keys (e.g. ApprovalSection uses approve/reject/resubmit/…).
        # Entity-level x-custom-components is a list — collect keys for every named component.
        def_key = entity.get('definition_key', '')
        custom_comps = schema['definitions'].get(def_key, {}).get('x-custom-components') or []
        if isinstance(custom_comps, list):
            for custom_comp in custom_comps:
                if not isinstance(custom_comp, dict):
                    continue
                comp_name = custom_comp.get('name', '')
                for comp_key, comp_label in _CUSTOM_COMPONENT_FIELD_KEYS.get(comp_name, {}).items():
                    keys.setdefault(comp_key, comp_label)

        # Child properties: section heading key + column header keys for child tables
        # column_def_context uses the child's unfiltered base definition (excluding id,
        # parent FK, and system timestamps), so we replicate the same exclusion here.
        child_parent_fk = f'{model}_id'
        _child_sys = {'id', 'created_at', 'updated_at', 'creator_id', child_parent_fk}
        for child in entity.get('children', []):
            # Section heading (e.g. "features", "userAccounts")
            prop_name = child['property_name']
            keys.setdefault(to_camel_case(prop_name), to_title_case(prop_name))

            # Column headers for non-comment child tables
            if child.get('output_type') == 'comments':
                continue
            child_def = schema['definitions'].get(child['name'], {})
            for cp_name, cp_prop in child_def.get('properties', {}).items():
                if cp_name in _child_sys:
                    continue
                cp_rel = cp_prop.get('x-relationship', {})
                cp_rel_type = cp_rel.get('type')
                if cp_rel_type in ('many-to-one', 'one-to-one'):
                    base = cp_name[:-3] if cp_name.endswith('_id') else cp_name
                    keys.setdefault(to_camel_case(base), to_title_case(base))
                elif cp_rel_type == 'one-to-one_bridge':
                    continue
                else:
                    keys.setdefault(to_camel_case(cp_name), to_title_case(cp_name))

    return keys


# ---------------------------------------------------------------------------
# JSON file updater
# ---------------------------------------------------------------------------

def _update_json(path: Path, additions: dict[str, dict[str, str]]) -> bool:
    """
    Deep-merge additions into the JSON file at `path`.
    `additions` is {sectionName: {key: value}}.
    Returns True if the file was changed.
    """
    with open(path, encoding='utf-8') as f:
        data = json.load(f)

    changed = False
    for section, entries in additions.items():
        if section not in data:
            data[section] = {}
            changed = True
        for key, value in entries.items():
            if key not in data[section]:
                data[section][key] = value
                changed = True

    # Sort keys within each section that has additions
    for section in additions:
        if section in data:
            sorted_section = dict(sorted(data[section].items(), key=lambda x: x[0].lower()))
            if list(data[section].keys()) != list(sorted_section.keys()):
                data[section] = sorted_section
                changed = True

    if changed:
        with open(path, 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
            f.write('\n')

    return changed


# ---------------------------------------------------------------------------
# site-config.ts updater
# ---------------------------------------------------------------------------

def _update_site_config(path: Path, nav_entities: list) -> bool:
    content = path.read_text(encoding='utf-8')

    existing_hrefs = set(re.findall(r'href:\s*"(/[^"]*)"', content))

    new_lines = []
    for entity in nav_entities:
        href = f'/{entity["parent"]}'
        if href not in existing_hrefs:
            label = to_title_case(entity['parent'])
            new_lines.append(f'    {{ label: "{label}", href: "{href}" }},')

    if not new_lines:
        return False

    insertion = '\n'.join(new_lines)
    content = content.replace(
        '] satisfies NavLink[]',
        f'{insertion}\n  ] satisfies NavLink[]',
    )
    path.write_text(content, encoding='utf-8')
    return True


# ---------------------------------------------------------------------------
# sidebar/page.tsx updater
# ---------------------------------------------------------------------------

def _update_sidebar(path: Path, nav_entities: list) -> bool:
    content = path.read_text(encoding='utf-8')

    # Match entries inside the navTranslationKeys object
    existing_hrefs = set(re.findall(r'"(/[^"]+)":\s*"[^"]+"', content))

    new_lines = []
    for entity in nav_entities:
        href = f'/{entity["parent"]}'
        if href not in existing_hrefs:
            nav_key = to_camel_case(entity['parent'])
            new_lines.append(f'  "{href}": "{nav_key}",')

    if not new_lines:
        return False

    insertion = '\n'.join(new_lines)
    # Insert before the closing '}' of navTranslationKeys
    content = content.replace(
        '};\n\nexport default function Sidebar',
        f'{insertion}\n}};\n\nexport default function Sidebar',
    )
    path.write_text(content, encoding='utf-8')
    return True


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------

def update_i18n_and_config(entities: list, schema: dict, output_dir: Path) -> None:
    """
    Update i18n message files and navigation config for all entities.

    `entities` — the full list returned by extract_entities().
    `output_dir` — project root (same as passed to generate()).
    """
    # Entities that appear in the sidebar nav:
    # must be a "primary" entity (parent == model) with a list page.
    nav_entities = [
        e for e in entities
        if e['parent'] == e['model'] and e['generate_config'].get('list', True)
    ]

    # EntityLabel keys for all entities (including alternate-model entities like setting*)
    entity_label_entries = {
        to_camel_case(e['parent']): to_title_case(e['parent'])
        for e in entities
    }

    # Nav keys (same set as nav_entities)
    nav_entries = {
        to_camel_case(e['parent']): to_title_case(e['parent'])
        for e in nav_entities
    }

    # Field keys across all entities
    field_keys = _collect_field_keys(entities, schema)

    # --- messages/*.json ---
    messages_dir = output_dir / 'messages'
    for lang_file in sorted(messages_dir.glob('*.json')):
        additions: dict[str, dict[str, str]] = {
            'EntityLabel': entity_label_entries,
            'Nav': nav_entries,
            'Fields': field_keys,
        }
        changed = _update_json(lang_file, additions)
        status = 'Updated' if changed else 'No changes'
        print(f'  {status}: {lang_file.relative_to(output_dir)}')

    # --- lib/site-config.ts ---
    site_config = output_dir / 'lib' / 'site-config.ts'
    if site_config.exists():
        changed = _update_site_config(site_config, nav_entities)
        status = 'Updated' if changed else 'No changes'
        print(f'  {status}: {site_config.relative_to(output_dir)}')

    # --- app/[locale]/@sidebar/page.tsx ---
    sidebar = output_dir / 'app' / '[locale]' / '@sidebar' / 'page.tsx'
    if sidebar.exists():
        changed = _update_sidebar(sidebar, nav_entities)
        status = 'Updated' if changed else 'No changes'
        print(f'  {status}: {sidebar.relative_to(output_dir)}')
