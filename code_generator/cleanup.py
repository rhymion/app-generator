#!/usr/bin/env python3
"""
cleanup.py — Remove files and entries created by the code generator.

For fully overwritten files: deletes them entirely.
For appended files (messages/*.json, lib/site-config.ts,
app/[locale]/@sidebar/page.tsx): removes only the generated entries,
preserving manual content.

Stubs (form_validation.ts, service_validation.ts) are deleted unless
--keep-stubs is passed, since they may contain user customizations.

Usage (run from code_generator/):
    python cleanup.py <schema.yaml> <output-dir> [--keep-stubs]

Examples:
    python cleanup.py json_schema_db_table.yaml ..
    python cleanup.py json_schema_db_table.yaml .. --keep-stubs
"""
import json
import re
import sys
from pathlib import Path

import yaml

from generate_types import extract_entities
from helpers.naming import to_camel_case
from helpers.schema_helpers import filter_fields

_SYSTEM_PROPS = {'id', 'created_at', 'updated_at', 'creator_id', 'updater_id'}


# ---------------------------------------------------------------------------
# File helpers
# ---------------------------------------------------------------------------

def _delete(path: Path) -> None:
    if path.exists():
        path.unlink()
        print(f'  Deleted {path}')


def _try_rmdir(path: Path) -> None:
    """Remove directory if it exists and is empty."""
    try:
        if path.is_dir() and not any(path.iterdir()):
            path.rmdir()
            print(f'  Removed empty dir {path}')
    except Exception:
        pass


def _rmdir_tree(path: Path) -> None:
    """Recursively remove empty directories bottom-up."""
    if not path.is_dir():
        return
    for child in list(path.iterdir()):
        if child.is_dir():
            _rmdir_tree(child)
    _try_rmdir(path)


# ---------------------------------------------------------------------------
# Key collection (mirrors generators_i18n.py)
# ---------------------------------------------------------------------------

def _collect_field_keys(entities: list, schema: dict) -> set:
    keys = set()
    for entity in entities:
        model = entity['model']
        gen_cfg = entity['generate_config']
        model_def = schema['definitions'].get(model, {})
        props = filter_fields(model_def.get('properties', {}), gen_cfg.get('fields'))
        for prop_name, prop in props.items():
            if prop_name in _SYSTEM_PROPS:
                continue
            rel = prop.get('x-relationship', {})
            if rel.get('type') == 'many-to-one':
                base = prop_name[:-3] if prop_name.endswith('_id') else prop_name
                keys.add(to_camel_case(base))
            else:
                keys.add(to_camel_case(prop_name))
        for child in entity.get('children', []):
            keys.add(to_camel_case(child['property_name']))
    return keys


# ---------------------------------------------------------------------------
# Appended-file cleaners
# ---------------------------------------------------------------------------

def _clean_messages(path: Path, entity_label_keys: set, nav_keys: set, field_keys: set) -> None:
    if not path.exists():
        return
    with open(path, encoding='utf-8') as f:
        data = json.load(f)

    changed = False
    for section, keys in [
        ('EntityLabel', entity_label_keys),
        ('Nav',         nav_keys),
        ('Fields',      field_keys),
    ]:
        if section not in data:
            continue
        for key in list(data[section].keys()):
            if key in keys:
                del data[section][key]
                changed = True
        if not data[section]:
            del data[section]

    if changed:
        with open(path, 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
            f.write('\n')
        print(f'  Cleaned {path}')
    else:
        print(f'  No changes: {path}')


def _clean_site_config(path: Path, nav_hrefs: list) -> None:
    if not path.exists():
        return
    content = path.read_text(encoding='utf-8')
    original = content
    for href in nav_hrefs:
        # Matches: { label: "...", href: "/parent" },  (with leading whitespace / newline)
        content = re.sub(
            r'[ \t]*\{ label: "[^"]*", href: "' + re.escape(href) + r'" \},\n?',
            '',
            content,
        )
    if content != original:
        path.write_text(content, encoding='utf-8')
        print(f'  Cleaned {path}')
    else:
        print(f'  No changes: {path}')


def _clean_sidebar(path: Path, nav_hrefs: list) -> None:
    if not path.exists():
        return
    content = path.read_text(encoding='utf-8')
    original = content
    for href in nav_hrefs:
        # Matches:   "/parent": "camelKey",  (with leading whitespace / newline)
        content = re.sub(
            r'[ \t]*"' + re.escape(href) + r'":\s*"[^"]+",\n?',
            '',
            content,
        )
    if content != original:
        path.write_text(content, encoding='utf-8')
        print(f'  Cleaned {path}')
    else:
        print(f'  No changes: {path}')


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def cleanup(schema_path: str, output_dir: str, keep_stubs: bool = False) -> None:
    with open(schema_path) as f:
        schema = yaml.safe_load(f)

    entities = extract_entities(schema)
    if not entities:
        print('No entities found in schema.', file=sys.stderr)
        return

    out = Path(output_dir)
    test_entities = [e for e in entities if e['generate_config'].get('test')]

    print(f'Found {len(entities)} entities in {schema_path}')

    # -------------------------------------------------------------------------
    # Per-entity file deletion
    # -------------------------------------------------------------------------
    for entity in entities:
        parent     = entity['parent']
        gen_cfg    = entity.get('generate_config', {})
        children   = entity.get('children', [])

        can_list   = gen_cfg.get('list', True)
        can_view   = gen_cfg.get('view', True)
        can_new    = gen_cfg.get('new', True)
        can_edit   = gen_cfg.get('edit', True)
        can_delete = gen_cfg.get('delete', True)
        can_api    = gen_cfg.get('api', False)
        can_test   = gen_cfg.get('test', False)

        lib_dir        = out / 'lib'        / parent
        components_dir = out / 'components' / parent
        app_dir        = out / 'app' / '[locale]' / parent
        api_dir        = out / 'app' / 'api' / parent

        print(f'\nCleaning: {parent}')

        # lib/
        _delete(lib_dir / 'types.ts')
        _delete(lib_dir / 'getters.ts')
        if can_new or can_edit or can_delete:
            _delete(lib_dir / 'service.ts')
            _delete(lib_dir / 'actions.ts')
            if not keep_stubs:
                _delete(lib_dir / 'service_validation.ts')
        _delete(lib_dir / 'chart-getters.ts')  # safe if not present

        # components/
        if can_new or can_edit:
            _delete(components_dir / 'FormUpsert.tsx')
            if not keep_stubs:
                _delete(components_dir / 'form_validation.ts')
        if can_view:
            _delete(components_dir / 'FormView.tsx')
        if children and (can_view or can_edit):
            _delete(components_dir / 'column_def.tsx')

        # app/[locale]/ pages (try all; _delete is a no-op if absent)
        _delete(app_dir / 'page.tsx')
        _delete(app_dir / 'chart' / 'page.tsx')
        if can_new:
            _delete(app_dir / 'new' / 'page.tsx')
        if can_edit:
            _delete(app_dir / 'edit' / '[id]' / 'page.tsx')
        if can_view:
            _delete(app_dir / 'view' / '[id]' / 'page.tsx')

        # app/api/
        if can_api:
            _delete(api_dir / 'route.ts')
            _delete(api_dir / '[id]' / 'route.ts')
            _delete(api_dir / 'bulk' / 'route.ts')

        # docs/
        _delete(out / 'docs' / 'generated' / f'{parent}.md')
        _delete(out / 'app' / '[locale]' / 'docs' / parent / 'page.mdx')

        # Cypress tests
        if can_test:
            _delete(out / 'cypress' / 'support' / parent / 'helper.ts')
            _delete(out / 'cypress' / 'e2e' / f'{parent}.cy.ts')
            if can_api:
                _delete(out / 'cypress' / 'e2e' / 'api' / f'{parent}.cy.ts')

        # Remove empty entity directories
        _rmdir_tree(lib_dir)
        _rmdir_tree(components_dir)
        _rmdir_tree(app_dir)
        if can_api:
            _rmdir_tree(api_dir)
        _rmdir_tree(out / 'app' / '[locale]' / 'docs' / parent)
        if can_test:
            _rmdir_tree(out / 'cypress' / 'support' / parent)

    # -------------------------------------------------------------------------
    # Once-only files
    # -------------------------------------------------------------------------
    print('\nCleaning once-only files...')
    _delete(out / 'docs' / 'generated' / 'index.md')
    _delete(out / 'app' / '[locale]' / 'docs' / 'page.mdx')
    if test_entities:
        _delete(out / 'cypress' / 'support' / 'generated-tasks.ts')

    _try_rmdir(out / 'docs' / 'generated')
    _try_rmdir(out / 'app' / '[locale]' / 'docs')

    # -------------------------------------------------------------------------
    # Appended files — remove generated entries only
    # -------------------------------------------------------------------------
    print('\nCleaning appended files...')

    nav_entities = [
        e for e in entities
        if e['parent'] == e['model'] and e['generate_config'].get('list', True)
    ]
    entity_label_keys = {to_camel_case(e['parent']) for e in entities}
    nav_keys          = {to_camel_case(e['parent']) for e in nav_entities}
    field_keys        = _collect_field_keys(entities, schema)
    nav_hrefs         = [f'/{e["parent"]}' for e in nav_entities]

    for lang_file in sorted((out / 'messages').glob('*.json')):
        _clean_messages(lang_file, entity_label_keys, nav_keys, field_keys)

    _clean_site_config(out / 'lib' / 'site-config.ts', nav_hrefs)
    _clean_sidebar(out / 'app' / '[locale]' / '@sidebar' / 'page.tsx', nav_hrefs)

    print('\nCleanup complete!')


if __name__ == '__main__':
    args = [a for a in sys.argv[1:] if not a.startswith('-')]
    flags = [a for a in sys.argv[1:] if a.startswith('-')]

    if len(args) < 2:
        print('Usage: python cleanup.py <schema.yaml> <output-dir> [--keep-stubs]')
        print('Example: python cleanup.py json_schema_db_table.yaml ..')
        sys.exit(1)

    cleanup(args[0], args[1], keep_stubs='--keep-stubs' in flags)
