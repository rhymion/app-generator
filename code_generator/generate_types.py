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
            'list':   x_generate.get('list',   True) is not False,
            'view':   x_generate.get('view',   True) is not False,
            'new':    x_generate.get('new',    True) is not False,
            'edit':   x_generate.get('edit',   True) is not False,
            'delete': x_generate.get('delete', True) is not False,
            'api':    x_generate.get('api')  is True,
            'test':   x_generate.get('test') is True,
            'fields': x_generate.get('fields'),
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

    # Validate: if a generated entity appears as a child, it must use x-outputType: list
    generated_models = {e['model'] for e in results}
    for entity in results:
        for child in entity['children']:
            if child['name'] in generated_models and child['output_type'] != 'list':
                raise ValueError(
                    f"Entity '{child['name']}' has x-generate but appears as a child of "
                    f"'{entity['parent']}' with x-outputType: '{child['output_type']}' "
                    f"(must be 'list')"
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


if __name__ == '__main__':
    if len(sys.argv) < 3:
        print('Usage: python generate_types.py <schema.yaml> <output-dir>')
        print('Example: python generate_types.py ../../json_schema_db_table.yaml ../..')
        sys.exit(1)

    generate_types_for_schema(sys.argv[1], sys.argv[2])
    print('Done.')
