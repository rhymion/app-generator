"""
generators_i18n.py — Update i18n message files and config files with new entity keys.

Called once after all entities are generated. Only adds missing keys — never
removes or overwrites existing values so manual translations are preserved.

Updates:
  messages/en.json         Nav, EntityLabel, Fields, <nativeEnum namespace> sections
  messages/ja.json         same (placeholder values for manual translation)
  lib/site-config.ts       navLinks array
  app/[locale]/@sidebar/page.tsx  navTranslationKeys object
"""
import json
import re
from pathlib import Path

from helpers.naming import to_camel_case, to_title_case
from helpers.schema_helpers import filter_fields
from nav_config import build_nav_config, upsert_nav_group_i18n

# The locale whose messages/*.json values ARE the schema-computed defaults
# (see i18n/routing.ts defaultLocale). Every other locale file's newly-added
# key carries that same English text as an untranslated placeholder.
_SOURCE_LOCALE_FILENAME = 'en.json'


def _raw_def(entity_name: str, schema: dict) -> dict:
    """Resolve a bare/view model name to its raw entity dict (mirrors
    generators.py's `_raw_def` — duplicated locally to avoid a cross-module
    import for one helper)."""
    defs = schema.get('definitions', {})
    return defs.get(f'__{entity_name}', {}) or defs.get(entity_name, {})


def _native_enum_key(v) -> str:
    """camelCase message key for a nativeEnum value (Prisma enum members are
    PascalCase, e.g. 'TerminalRejected' -> 'terminalRejected')."""
    s = str(v)
    return s[0].lower() + s[1:] if s else s


def _humanize_enum_value(v) -> str:
    """'TerminalRejected' -> 'Terminal Rejected', 'partially_received' ->
    'Partially Received' (split on PascalCase boundaries and underscores,
    Title Case each word). Placeholder text only — same convention as
    _collect_field_keys, whose English label is written into every language
    file pending translation."""
    s = str(v)
    s = re.sub(r'(?<=[a-z0-9])(?=[A-Z])', ' ', s).replace('_', ' ')
    words = s.split()
    return ' '.join(w[0].upper() + w[1:].lower() for w in words) if words else str(v)


def _collect_native_enum_namespaces(schema: dict) -> dict[str, dict[str, str]]:
    """Return {namespace: {camelKey: 'Humanized Label'}} for every nativeEnum
    field (`_prisma_native_enum_type`) across all entities — regardless of
    whether the entity has generated list/view/upsert pages, since a
    hand-written component (or a future x-generate flip) may still need the
    translation. Namespace defaults to the Prisma enum block name;
    `x-enum-namespace` overrides it when set (mirrors generators.py)."""
    result: dict[str, dict[str, str]] = {}
    seen_bases = set()
    for def_key in schema.get('definitions', {}):
        base = def_key[2:] if def_key.startswith('__') else def_key
        if base in seen_bases:
            continue
        seen_bases.add(base)
        props = _raw_def(base, schema).get('properties', {})
        for prop in props.values():
            native_type = prop.get('_prisma_native_enum_type')
            enum_vals = prop.get('enum')
            if not native_type or not isinstance(enum_vals, list):
                continue
            ns = prop.get('x-enum-namespace') or native_type
            ns_entries = result.setdefault(ns, {})
            for v in enum_vals:
                ns_entries.setdefault(_native_enum_key(v), _humanize_enum_value(v))
    return result


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

# i18n keys owned by a dedicated namespace section (not Fields) that a named
# custom component contributes. {component_name: {namespace: {key: label}}}.
# Unlike _CUSTOM_COMPONENT_FIELD_KEYS (merged into Fields), these keep their
# own top-level section so the component's translations stay grouped together.
_CUSTOM_COMPONENT_SECTIONS: dict[str, dict[str, dict[str, str]]] = {
    'CopyShiftsButton': {
        'ShiftTemplate': {
            'copyToShifts': 'Copy to Shifts',
            'copyToShiftsExplanation': 'Copy Shift Templates to Shifts',
        },
    },
}


def _collect_custom_component_sections(entities: list, schema: dict) -> dict[str, dict[str, str]]:
    """Return {namespace: {key: label}} contributed via _CUSTOM_COMPONENT_SECTIONS
    by every entity's x-custom-components list."""
    result: dict[str, dict[str, str]] = {}
    for entity in entities:
        def_key = entity.get('definition_key', '')
        custom_comps = schema['definitions'].get(def_key, {}).get('x-custom-components') or []
        if not isinstance(custom_comps, list):
            continue
        for custom_comp in custom_comps:
            if not isinstance(custom_comp, dict):
                continue
            comp_name = custom_comp.get('name', '')
            for ns, ns_keys in _CUSTOM_COMPONENT_SECTIONS.get(comp_name, {}).items():
                ns_entries = result.setdefault(ns, {})
                for key, label in ns_keys.items():
                    ns_entries.setdefault(key, label)
    return result


def _collect_field_keys(entities: list, schema: dict) -> dict[str, str]:
    """Return {camelCaseKey: 'Title Case Label'} for every field across all entities."""
    keys: dict[str, str] = {}

    for entity in entities:
        model = entity['model']
        gen_cfg = entity['generate_config']

        model_def = schema['definitions'].get(model, {})
        raw_model_def = _raw_def(model, schema)
        props = filter_fields(raw_model_def.get('properties', {}), gen_cfg.get('fields'))

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
            child_def = _raw_def(child['name'], schema)
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
# Enum label map merge (file-wins overlay)
# ---------------------------------------------------------------------------

def _merge_file_wins_messages(
    schema_fields: dict[str, str],
    schema_ns: dict[str, dict[str, str]],
    file_msgs: dict | None,
) -> tuple[dict[str, str], dict[str, dict[str, str]]]:
    """Merge schema-computed enum label defaults with an existing messages/en.json,
    file values winning — same merge semantics as `_update_json` (existing keys
    preserved, missing keys filled with schema defaults).

    This is what makes generate() idempotent while still honoring consumer
    translations: run 1 (no file) produces the schema defaults; _update_json
    writes those defaults into messages/en.json; run 2 (file present) overlays
    those same values back on top of themselves, so the merged result is
    identical to run 1. A consumer's custom translation overlays the schema
    default instead, so specs and the app render the same (custom) value.
    """
    if not file_msgs:
        return dict(schema_fields), {k: dict(v) for k, v in schema_ns.items()}

    merged_fields = {**schema_fields, **file_msgs.get('Fields', {})}
    merged_ns: dict[str, dict[str, str]] = {}
    for ns_key, ns_defaults in schema_ns.items():
        merged_ns[ns_key] = {**ns_defaults, **file_msgs.get(ns_key, {})}
    # Preserve any namespace sections in the file not covered by schema (e.g. prj/ custom)
    for ns_key, ns_vals in file_msgs.items():
        if ns_key not in merged_ns and isinstance(ns_vals, dict):
            merged_ns[ns_key] = ns_vals
    return merged_fields, merged_ns


# ---------------------------------------------------------------------------
# JSON file updater
# ---------------------------------------------------------------------------

def _update_json(path: Path, additions: dict[str, dict[str, str]]) -> tuple[bool, dict[str, list[str]]]:
    """
    Deep-merge additions into the JSON file at `path`.
    `additions` is {sectionName: {key: value}}.
    Returns (changed, added_keys) where `added_keys` is {sectionName: [key, ...]}
    for every key that did not already exist in the file (i.e. was actually
    written by this call, as opposed to a key the file already had).
    """
    with open(path, encoding='utf-8') as f:
        data = json.load(f)

    changed = False
    added_keys: dict[str, list[str]] = {}
    for section, entries in additions.items():
        if section not in data:
            data[section] = {}
            changed = True
        for key, value in entries.items():
            if key not in data[section]:
                data[section][key] = value
                changed = True
                added_keys.setdefault(section, []).append(key)

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

    return changed, added_keys


# ---------------------------------------------------------------------------
# messages/*.json — Nav.groups.<slug> upsert (nested, unlike the flat
# Fields/EntityLabel/Nav sections `_update_json` handles)
# ---------------------------------------------------------------------------

def _update_nav_group_i18n_file(path: Path, groups: list) -> tuple[bool, list[str]]:
    """Upsert messages['Nav']['groups'][slug] for every nav group — never
    overwrites an existing value (see nav_config.upsert_nav_group_i18n).
    Returns (changed, added_slugs)."""
    if not groups:
        return False, []

    with open(path, encoding='utf-8') as f:
        messages = json.load(f)

    changed = False
    added: list[str] = []
    for group in groups:
        if upsert_nav_group_i18n(messages, group['slug'], group['label']):
            changed = True
            added.append(group['slug'])

    if changed:
        # Keep Nav.groups sorted the same way _update_json sorts other sections.
        messages['Nav']['groups'] = dict(sorted(messages['Nav']['groups'].items(), key=lambda x: x[0].lower()))
        with open(path, 'w', encoding='utf-8') as f:
            json.dump(messages, f, indent=2, ensure_ascii=False)
            f.write('\n')

    return changed, added


# ---------------------------------------------------------------------------
# site-config.ts updater
# ---------------------------------------------------------------------------

def _update_site_config(path: Path, nav_entities: list, nav_config: dict) -> bool:
    content = path.read_text(encoding='utf-8')

    existing_hrefs = set(re.findall(r'href:\s*"(/[^"]*)"', content))
    entity_group = nav_config['entity_group']

    new_link_lines = []
    for entity in nav_entities:
        href = f'/{entity["parent"]}'
        if href in existing_hrefs:
            continue
        label = to_title_case(entity['parent'])
        group_info = entity_group.get(entity['model'])
        if group_info:
            new_link_lines.append(
                f'    {{ label: "{label}", href: "{href}", '
                f'group: "{group_info["group"]}", order: {group_info["order"]} }},'
            )
        else:
            new_link_lines.append(f'    {{ label: "{label}", href: "{href}" }},')

    existing_group_slugs = set(re.findall(r'slug:\s*"([^"]*)"', content))
    new_group_lines = []
    for group in nav_config['groups']:
        if group['slug'] in existing_group_slugs:
            continue
        fields = [f'slug: "{group["slug"]}"', f'labelKey: "groups.{group["slug"]}"', f'order: {group["order"]}']
        if group.get('icon'):
            fields.append(f'icon: "{group["icon"]}"')
        if group.get('parent'):
            fields.append(f'parent: "{group["parent"]}"')
        new_group_lines.append(f'    {{ {", ".join(fields)} }},')

    if not new_link_lines and not new_group_lines:
        return False

    if new_link_lines:
        insertion = '\n'.join(new_link_lines)
        content = content.replace(
            '] satisfies NavLink[]',
            f'{insertion}\n  ] satisfies NavLink[]',
        )
    if new_group_lines:
        insertion = '\n'.join(new_group_lines)
        content = content.replace(
            '] satisfies NavGroup[]',
            f'{insertion}\n  ] satisfies NavGroup[]',
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

    # Nested sidebar navigation groups (x-nav.parent / x-nav-groups). Raises
    # NavValidationError (fail-closed) for a cycle, excess depth, or unknown
    # icon name — propagates to the caller, aborting generation.
    nav_config = build_nav_config(entities, schema)

    # nativeEnum option keys (one section per Prisma enum / x-enum-namespace)
    native_enum_ns = _collect_native_enum_namespaces(schema)

    # Component-owned namespace sections (e.g. ShiftTemplate.* for CopyShiftsButton)
    custom_component_ns = _collect_custom_component_sections(entities, schema)

    # Merge namespace-keyed sections rather than spreading (a spread would let a
    # colliding namespace clobber the other's entries entirely instead of merging).
    namespace_sections: dict[str, dict[str, str]] = {}
    for ns_map in (native_enum_ns, custom_component_ns):
        for ns, ns_entries in ns_map.items():
            namespace_sections.setdefault(ns, {}).update(ns_entries)

    # --- messages/*.json ---
    # `_SOURCE_LOCALE_FILENAME` is the locale whose values ARE the schema
    # defaults (see module docstring / i18n/routing.ts defaultLocale). Any key
    # newly added to a *different* locale file carries that same English
    # default text as a placeholder — it has never been translated. Surface
    # those so a partial translation gap is visible in the build log instead
    # of silently looking like a successful, fully-translated run (cmd_560).
    untranslated_report: dict[str, dict[str, list[str]]] = {}
    messages_dir = output_dir / 'messages'
    for lang_file in sorted(messages_dir.glob('*.json')):
        additions: dict[str, dict[str, str]] = {
            'EntityLabel': entity_label_entries,
            'Nav': nav_entries,
            'Fields': field_keys,
            **namespace_sections,
        }
        changed, added_keys = _update_json(lang_file, additions)

        nav_groups_changed, added_group_slugs = _update_nav_group_i18n_file(lang_file, nav_config['groups'])
        if added_group_slugs:
            added_keys.setdefault('Nav', []).extend(f'groups.{slug}' for slug in added_group_slugs)
        changed = changed or nav_groups_changed

        status = 'Updated' if changed else 'No changes'
        print(f'  {status}: {lang_file.relative_to(output_dir)}')
        if lang_file.name != _SOURCE_LOCALE_FILENAME and added_keys:
            untranslated_report[lang_file.name] = added_keys

    if untranslated_report:
        print(f'\n  WARNING: untranslated keys added (English placeholder, needs manual translation):')
        for filename, sections in untranslated_report.items():
            for section, keys in sections.items():
                print(f'    {filename} [{section}]: {", ".join(sorted(keys))}')

    # --- lib/site-config.ts ---
    site_config = output_dir / 'lib' / 'site-config.ts'
    if site_config.exists():
        changed = _update_site_config(site_config, nav_entities, nav_config)
        status = 'Updated' if changed else 'No changes'
        print(f'  {status}: {site_config.relative_to(output_dir)}')

    # --- app/[locale]/@sidebar/page.tsx ---
    sidebar = output_dir / 'app' / '[locale]' / '@sidebar' / 'page.tsx'
    if sidebar.exists():
        changed = _update_sidebar(sidebar, nav_entities)
        status = 'Updated' if changed else 'No changes'
        print(f'  {status}: {sidebar.relative_to(output_dir)}')
