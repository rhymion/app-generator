#!/usr/bin/env python3
"""
POC: generate lib/{entity}/types.ts using Python + Jinja2.

Usage:
    cd code_generator/py
    python generate_types.py ../../json_schema_db_table.yaml ../../

This replaces the generateTypes() function in templates.ts with:
  - context.py     : pure data preparation (EntityContext dataclass)
  - templates/     : Jinja2 templates (the output shape, readable as near-TypeScript)
  - this file      : schema extraction + orchestration
"""
import sys
import os
import re
from pathlib import Path
from dataclasses import asdict

import yaml
from jinja2 import Environment, FileSystemLoader

from helpers.naming import to_pascal_case, to_camel_case
from context import build_entity_context


# ---------------------------------------------------------------------------
# Jinja2 environment
# ---------------------------------------------------------------------------

def _make_env() -> Environment:
    here = Path(__file__).parent
    env = Environment(
        loader=FileSystemLoader(here / 'templates'),
        trim_blocks=True,      # removes the newline after a block tag
        lstrip_blocks=True,    # strips leading whitespace before block tags
        keep_trailing_newline=True,
    )
    env.filters['pascal_case'] = to_pascal_case
    env.filters['camel_case'] = to_camel_case
    return env


# ---------------------------------------------------------------------------
# Schema extraction (port of extractEntities / extractChildren in generate.ts)
# ---------------------------------------------------------------------------

def _extract_children(defn: dict, schema: dict) -> list[dict]:
    props = defn.get('properties')
    if not props:
        for item in defn.get('allOf', []):
            if 'properties' in item:
                props = item['properties']
                break

    x_relationships = defn.get('x-relationships', {})
    children = []

    for prop_name, prop in (props or {}).items():
        if prop.get('type') == 'array' and (prop.get('items') or {}).get('$ref'):
            child_name = prop['items']['$ref'].split('/')[-1]
            relationship = None
            if prop_name in x_relationships:
                rel_info = x_relationships[prop_name]
                relationship = {
                    'type': rel_info['type'],
                    'target': rel_info.get('target', child_name),
                    'label_field': rel_info.get('labelField', 'name'),
                    'secondary_label_field': rel_info.get('secondaryLabelField'),
                }
            children.append({
                'name': child_name,
                'property_name': prop_name,
                'output_type': prop.get('x-outputType') or prop.get('outputType'),
                'file_type': prop.get('x-fileType'),
                'relationship': relationship,
            })

    return children


def extract_entities(schema: dict) -> list[dict]:
    """Port of extractEntities() from generate.ts."""
    defs = schema['definitions']

    base_models = {
        key for key, defn in defs.items()
        if not key.endswith('_detail')
        and not key.endswith('_input')
        and (defn.get('properties') or {}).get('id') is not None
    }

    all_children: set[str] = set()
    child_to_parents: dict[str, list[str]] = {}
    results = []

    for def_key, defn in defs.items():
        # Resolve modelName from allOf $ref
        model_name = None
        for item in defn.get('allOf', []):
            ref_target = (item.get('$ref') or '').split('/')[-1]
            if ref_target in base_models:
                model_name = ref_target
                break

        # Skip x-internal entities — no pages, no embedding, custom API only
        x_internal = defn.get('x-internal') or (model_name and defs.get(model_name, {}).get('x-internal'))
        if x_internal:
            continue

        # Find x-generate: on this def, on the base model (for _detail keys), or on base model directly
        x_generate = (
            defn.get('x-generate')
            or (def_key.endswith('_detail') and model_name and defs.get(model_name, {}).get('x-generate'))
            or (def_key in base_models and defs[def_key].get('x-generate'))
        )

        if not x_generate:
            continue
        if not model_name and def_key not in base_models:
            continue

        entity_name = re.sub(r'_detail$', '', def_key) if def_key.endswith('_detail') else def_key
        if not model_name:
            model_name = entity_name

        children = _extract_children(defn, schema)

        for child in children:
            all_children.add(child['name'])
            child_to_parents.setdefault(child['name'], []).append(model_name)

        generate_config = {
            'list':       x_generate.get('list',   True) is not False,
            'view':       x_generate.get('view',   True) is not False,
            'new':        x_generate.get('new',    True) is not False,
            'edit':       x_generate.get('edit',   True) is not False,
            'delete':     x_generate.get('delete', True) is not False,
            'api':        x_generate.get('api')  is True,
            'test':       x_generate.get('test') is True,
            'fields':     x_generate.get('fields'),
            'invalidate': x_generate.get('invalidate', False),
            # cmd_330: opt-out flags (default True = backward compat)
            'import':     x_generate.get('import', True) is not False,
            'export':     x_generate.get('export', True) is not False,
        }

        # Skip entities where all user-facing flags are explicitly False (internal models)
        core_flags = ['list', 'view', 'new', 'edit', 'delete', 'api']
        if all(x_generate.get(f) is False for f in core_flags):
            continue

        results.append({
            'parent': entity_name,
            'model': model_name,
            'definition_key': def_key,
            'children': children,
            'generate_config': generate_config,
        })

    # Detect many-to-many pairs
    m2m_pairs: set[str] = set()
    for child, parents_list in child_to_parents.items():
        for parent_model in parents_list:
            if child in child_to_parents.get(parent_model, []):
                m2m_pairs.add('<->'.join(sorted([parent_model, child])))

    # Validate: if a generated entity appears as a child, it must use x-outputType:
    # list — UNLESS the child entity is read-only (its x-generate disables new,
    # edit AND delete). A read-only child (e.g. an approval-only detail page that
    # only lets users approve/reject in the view) may appear with a non-list
    # x-outputType such as 'None', since it never renders a mutable list DataGrid.
    generated_models = {e['model'] for e in results}
    model_to_config = {e['model']: e['generate_config'] for e in results}
    for entity in results:
        for child in entity['children']:
            if child['name'] in generated_models and child['output_type'] != 'list':
                child_cfg = model_to_config.get(child['name'], {})
                if not (child_cfg.get('new') or child_cfg.get('edit') or child_cfg.get('delete')):
                    continue
                raise ValueError(
                    f"Entity '{child['name']}' has x-generate but appears as a child of "
                    f"'{entity['parent']}' with x-outputType: '{child['output_type']}' "
                    f"(must be 'list', or the child must disable new/edit/delete)"
                )

    # Filter out entities that are pure children (not in any m2m pair),
    # unless they have an explicit _detail definition (which opts them in to standalone generation)
    def _should_include(entity: dict) -> bool:
        m = entity['model']
        if m not in all_children:
            return True
        if entity['definition_key'].endswith('_detail'):
            return True
        return any(m in pair.split('<->') for pair in m2m_pairs)

    return [e for e in results if _should_include(e)]


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def generate_types_for_schema(schema_path: str, output_dir: str) -> None:
    with open(schema_path) as f:
        schema = yaml.safe_load(f)

    entities = extract_entities(schema)
    if not entities:
        print('No entities found in schema', file=sys.stderr)
        return

    env = _make_env()
    template = env.get_template('types.ts.jinja2')

    print(f'Found {len(entities)} entities in {schema_path}')

    for entity in entities:
        ctx = build_entity_context(entity, schema)

        # Render — context fields become template variables
        output = template.render(**asdict(ctx))

        out_path = Path(output_dir) / 'lib' / ctx.parent / 'types.ts'
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(output)
        print(f'  Wrote {out_path}')


def extract_named_constants(schema: dict) -> list[dict]:
    """Extract named constants from x-internal entities with integer enum fields.

    Returns a list of {const_name, entity_name, prop_name, items: [{value, label}]}.
    Naming: {PARENT}_{ENTITY}_TYPES where PARENT is the first non-user FK target,
    or {ENTITY}_TYPES when no suitable parent FK is found.
    """
    defs = schema.get('definitions', {})
    constants = []

    for entity_name, defn in defs.items():
        if entity_name.endswith('_detail') or entity_name.endswith('_input'):
            continue
        x_internal = defn.get('x-internal')
        if not x_internal:
            continue

        props = defn.get('properties', {})

        # Derive parent prefix from the first non-user many-to-one FK
        parent_name = None
        for prop_name, prop_def in props.items():
            rel = prop_def.get('x-relationship', {})
            if rel.get('type') == 'many-to-one' and rel.get('target') not in ('user',):
                parent_name = rel['target']
                break

        for prop_name, prop_def in props.items():
            if prop_def.get('type') != 'integer':
                continue
            enum_vals = prop_def.get('enum')
            if not isinstance(enum_vals, list):
                continue

            if parent_name:
                const_name = f"{parent_name.upper()}_{entity_name.upper()}_TYPES"
            else:
                const_name = f"{entity_name.upper()}_TYPES"

            items = [{'value': i, 'label': str(v)} for i, v in enumerate(enum_vals)]
            constants.append({
                'const_name': const_name,
                'entity_name': entity_name,
                'prop_name': prop_name,
                'items': items,
            })

    return constants


if __name__ == '__main__':
    if len(sys.argv) < 3:
        print('Usage: python generate_types.py <schema.yaml> <output-dir>')
        print('Example: python generate_types.py ../../json_schema_db_table.yaml ../..')
        sys.exit(1)

    generate_types_for_schema(sys.argv[1], sys.argv[2])
    print('Done.')
