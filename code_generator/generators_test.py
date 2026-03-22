"""
generators_test.py — Cypress E2E test code generation.

Builds Jinja2 template contexts for:
  - cypress/support/{entity}/helper.ts  (Prisma data population helpers)
  - cypress/e2e/{entity}.cy.ts          (E2E test spec)
  - cypress/support/generated-tasks.ts  (task registry for cypress.config.ts)
  - cypress/e2e/api/{entity}.cy.ts      (API test spec)
"""
import re

from helpers.naming import (
    to_camel_case, to_pascal_case, to_title_case, safe_var_name, singularize,
)
from helpers.schema_helpers import filter_fields, get_parent_relationships


# ---------------------------------------------------------------------------
# Child naming helpers (port of getChildNames from child-helpers.ts)
# ---------------------------------------------------------------------------

def get_child_names(child: dict) -> dict:
    property_name = child['property_name']
    var_name = safe_var_name(property_name)
    pascal_name = to_pascal_case(property_name)
    return {
        'var_name': var_name,
        'pascal_name': pascal_name,
        'singular_var_name': singularize(var_name),
        'singular_pascal_name': singularize(pascal_name),
        'title': to_title_case(property_name),
        'form_key': singularize(property_name),
        'columns_fn_name': f'{property_name}_columns',
    }


# ---------------------------------------------------------------------------
# Dependency resolution
# ---------------------------------------------------------------------------

def _get_primary_display_field_name(model_def: dict) -> str | None:
    """Returns the primary display field name from x-display.table, or None."""
    table = model_def.get('x-display', {}).get('table', [])
    for item in table:
        for field_name, cfg in item.items():
            if cfg.get('primary'):
                return field_name
    return None


def _get_dep_extra_required_fields(dep_target: str, schema: dict) -> list[dict]:
    """Return required non-system, non-name, non-FK fields for a dep entity.

    Used to emit extra required fields (e.g. code, price for product) when
    creating the dep record in populateDependencies().
    """
    dep_def = schema['definitions'].get(dep_target)
    if not dep_def:
        return []
    props = dep_def.get('properties', {})
    required = set(dep_def.get('required') or [])
    rel_props = {r['prop_name'] for r in get_parent_relationships(dep_def)}
    exclude = {'id', 'created_at', 'updated_at', 'creator_id', 'updater_id'} | rel_props

    result = []
    for prop_name, prop in props.items():
        if prop_name not in required or prop_name in exclude:
            continue
        prop_type = prop.get('type')
        actual = next((t for t in prop_type if t != 'null'), None) if isinstance(prop_type, list) else prop_type
        fmt = prop.get('format')
        if prop_name == 'name':
            val = f"'Test {to_title_case(dep_target)}'"
            val_unique = f'`Test {to_title_case(dep_target)} ${{i}}`'
        elif actual == 'string' and fmt in ('date', 'date-time', 'time'):
            val = 'new Date(2025, 0, 1).toISOString()'
            val_unique = val
        elif actual in ('integer', 'number'):
            mn = prop.get('minimum', 0)
            val = f'Math.max({mn}, 100)' if mn else '100'
            val_unique = val
        else:
            val = f'`TEST-{prop_name.upper()}-${{Date.now()}}`'
            val_unique = f'`TEST-{prop_name.upper()}-${{Date.now()}}-${{i}}`'
        result.append({'prop_name': prop_name, 'prisma_val': val, 'prisma_val_unique': val_unique})
    return result


def resolve_dependencies(model_name: str, schema: dict) -> list[dict]:
    """Port of resolveDependencies().

    Returns list of {target, var_name, fk_deps} for all transitive FK
    dependencies (excluding user_account, self, updater_id, assignee_id).
    """
    visited: set[str] = set()
    result: list[dict] = []

    def _resolve(model: str) -> None:
        if model in visited:
            return
        visited.add(model)

        model_def = schema['definitions'].get(model)
        if not model_def or not model_def.get('properties'):
            return

        rels = get_parent_relationships(model_def)
        relevant = [
            r for r in rels
            if r['target'] != 'user_account'
            and r['target'] != model
            and r['prop_name'] != 'updater_id'
            and r['prop_name'] != 'assignee_id'
        ]

        for rel in relevant:
            _resolve(rel['target'])

        if model != model_name and not any(d['target'] == model for d in result):
            fk_deps = [
                {'prop_name': r['prop_name'], 'dep_var_name': to_camel_case(r['target'])}
                for r in relevant
                if any(d['target'] == r['target'] for d in result)
            ]
            result.append({'target': model, 'var_name': to_camel_case(model), 'fk_deps': fk_deps})

    _resolve(model_name)
    return result


def get_entity_fk_deps(model_name: str, schema: dict, deps: list[dict]) -> list[dict]:
    """Port of getEntityFkDeps().

    Returns the direct FK deps of model_name that appear in the resolved deps list.
    """
    model_def = schema['definitions'].get(model_name)
    if not model_def:
        return []

    rels = get_parent_relationships(model_def)
    return [
        {'prop_name': r['prop_name'], 'dep_var_name': to_camel_case(r['target'])}
        for r in rels
        if r['target'] != 'user_account'
        and r['target'] != model_name
        and r['prop_name'] != 'updater_id'
        and r['prop_name'] != 'assignee_id'
        and any(d['target'] == r['target'] for d in deps)
    ]


# ---------------------------------------------------------------------------
# Field analysis
# ---------------------------------------------------------------------------

def get_field_metas(
    properties: dict,
    required_fields: list,
    relationships: list,
    fields_filter: list | None = None,
) -> list[dict]:
    """Port of getFieldMetas().

    Returns list of FieldMeta dicts with keys:
      prop_name, label, category, required,
      enum_values, format, dep_target, min, max
    """
    filtered = filter_fields(properties, fields_filter)
    exclude_keys = {'id', 'created_at', 'updated_at', 'creator_id', 'updater_id'}
    metas = []

    for prop_name, prop in filtered.items():
        if prop_name in exclude_keys:
            continue

        base = {
            'prop_name': prop_name,
            'enum_values': None,
            'format': None,
            'dep_target': None,
            'min': None,
            'max': None,
        }

        rel = next((r for r in relationships if r['prop_name'] == prop_name), None)
        if rel:
            if rel['target'] == 'user_account':
                continue
            metas.append({
                **base,
                'label': to_title_case(re.sub(r'_id$', '', prop_name)),
                'category': 'autocomplete',
                'required': prop_name in required_fields,
                'dep_target': rel['target'],
            })
            continue

        prop_type_raw = prop.get('type')
        if isinstance(prop_type_raw, list):
            prop_type = next((t for t in prop_type_raw if t != 'null'), None)
        else:
            prop_type = prop_type_raw
        fmt = prop.get('format')

        if prop_type == 'string' and fmt == 'uri':
            continue  # image/file field — skip
        elif prop_type == 'string' and fmt in ('date', 'date-time', 'time'):
            metas.append({
                **base,
                'label': to_title_case(prop_name),
                'category': 'datetime',
                'required': prop_name in required_fields,
                'format': fmt,
            })
        elif prop_type in ('integer', 'number'):
            if prop.get('enum'):
                # Integer field with string enum labels → rendered as Autocomplete select
                metas.append({
                    **base,
                    'label': to_title_case(prop_name),
                    'category': 'enum',
                    'required': prop_name in required_fields,
                    'enum_values': prop.get('enum'),
                })
            else:
                metas.append({
                    **base,
                    'label': to_title_case(prop_name),
                    'category': 'number',
                    'required': prop_name in required_fields,
                    'min': prop.get('minimum'),
                    'max': prop.get('maximum'),
                })
        elif prop_type == 'boolean':
            metas.append({
                **base,
                'label': to_title_case(prop_name),
                'category': 'boolean',
                'required': prop_name in required_fields,
            })
        else:
            metas.append({
                **base,
                'label': to_title_case(prop_name),
                'category': 'text',
                'required': prop_name in required_fields,
                'enum_values': prop.get('enum'),
            })

    return metas


def get_child_render_type(child: dict) -> str:
    """Port of getChildRenderType()."""
    if child.get('file_type'):
        return 'file'
    rel = child.get('relationship') or {}
    if rel.get('type') == 'many-to-many':
        return 'editable-list-autocomplete'
    if child.get('output_type') == 'list':
        return 'editable-list-text'
    if child.get('output_type') == 'comments':
        return 'comments'
    return 'datagrid'


def analyze_children(children: list, schema: dict, parent_model_name: str) -> list[dict]:
    """Port of analyzeChildren()."""
    result = []
    for child in children:
        render_type = get_child_render_type(child)
        if render_type == 'file':
            continue

        child_def = schema['definitions'].get(child['name'])
        if not child_def or not child_def.get('properties'):
            continue

        names = get_child_names(child)
        child_required = child_def.get('required') or []
        parent_fk_prop = f'{parent_model_name}_id'

        child_rels = get_parent_relationships(child_def)
        exclude_keys = {'id', parent_fk_prop, 'order'}
        child_properties = {k: v for k, v in child_def['properties'].items() if k not in exclude_keys}

        fields = get_field_metas(child_properties, child_required, child_rels)

        result.append({
            'child': child,
            'names': names,
            'render_type': render_type,
            'fields': fields,
            'required_fields': [f for f in fields if f['required']],
            'optional_fields': [f for f in fields if not f['required']],
            'parent_fk_prop': parent_fk_prop,
        })
    return result


# ---------------------------------------------------------------------------
# Test data value generators
# ---------------------------------------------------------------------------

def prisma_value(field: dict, index: str, entity_title: str) -> str:
    """Generate a TypeScript expression for Prisma test data."""
    cat = field['category']
    prop_name = field['prop_name']

    if cat == 'text':
        if prop_name == 'name':
            return f'`{entity_title} ${{{index}}}`'
        if field.get('enum_values'):
            return f"'{field['enum_values'][0]}'"
        return f'`Test {field["label"]} ${{{index}}}`'

    elif cat == 'enum':
        # Integer enum: store integer index 0 (first option)
        return '0'

    elif cat == 'number':
        val = f'{index} * 100'
        mn = field.get('min')
        mx = field.get('max')
        if mn is not None and mx is not None:
            return f'Math.min({mx}, Math.max({mn}, {val}))'
        if mn is not None:
            return f'Math.max({mn}, {val})'
        return val

    elif cat == 'boolean':
        return f'{index} % 2 === 0'

    elif cat == 'datetime':
        fmt = field.get('format')
        if fmt == 'date':
            return f'new Date(2025, 0, {index}).toISOString()'
        if any(kw in prop_name for kw in ('end', 'logout', 'finish')):
            return f'new Date(2025, 0, {index}, 17, 0).toISOString()'
        return f'new Date(2025, 0, {index}, 9, 0).toISOString()'

    return ''  # autocomplete — handled via deps


def cypress_create_value(field: dict, entity_title: str) -> str:
    """Generate a Cypress create (first fill) value."""
    cat = field['category']
    prop_name = field['prop_name']

    if cat == 'text':
        if prop_name == 'name':
            return f'Test {entity_title}'
        if field.get('enum_values'):
            return field['enum_values'][0]
        return f'Test {field["label"]}'

    elif cat == 'enum':
        return field['enum_values'][0]

    elif cat == 'number':
        val = 100
        mn = field.get('min')
        mx = field.get('max')
        if mn is not None:
            val = max(mn, val)
        if mx is not None:
            val = min(mx, val)
        return str(val)

    elif cat == 'boolean':
        return 'true'

    elif cat == 'datetime':
        fmt = field.get('format')
        if fmt == 'date':
            if any(kw in prop_name for kw in ('end', 'logout', 'finish')):
                return '01/16/2025'
            return '01/15/2025'
        if fmt == 'time':
            if any(kw in prop_name for kw in ('end', 'logout', 'finish')):
                return '05:00 PM'
            return '09:00 AM'
        if any(kw in prop_name for kw in ('end', 'logout', 'finish')):
            return '01/15/2025 05:00 PM'
        return '01/15/2025 09:00 AM'

    return ''  # autocomplete


def cypress_edit_value(field: dict, entity_title: str) -> str:
    """Generate a Cypress edit (updated) value."""
    cat = field['category']
    prop_name = field['prop_name']

    if cat == 'text':
        if prop_name == 'name':
            return f'Updated {entity_title}'
        enum_values = field.get('enum_values')
        if enum_values:
            return enum_values[1] if len(enum_values) > 1 else enum_values[0]
        return f'Updated {field["label"]}'

    elif cat == 'enum':
        return field['enum_values'][1] if len(field['enum_values']) > 1 else field['enum_values'][0]

    elif cat == 'number':
        val = 200
        mn = field.get('min')
        mx = field.get('max')
        if mn is not None:
            val = max(mn, val)
        if mx is not None:
            val = min(mx, val)
        return str(val)

    elif cat == 'boolean':
        return 'false'

    elif cat == 'datetime':
        fmt = field.get('format')
        if fmt == 'date':
            return '06/15/2025'
        if any(kw in prop_name for kw in ('end', 'logout', 'finish')):
            return '06/15/2025 06:00 PM'
        return '06/15/2025 02:00 PM'

    return ''  # autocomplete


def api_value(field: dict, entity_title: str) -> str:
    """Generate a value for API test request bodies (TypeScript literal string)."""
    cat = field['category']
    prop_name = field['prop_name']

    if cat == 'text':
        if prop_name == 'name':
            return f"'Test {entity_title}'"
        if field.get('enum_values'):
            return f"'{field['enum_values'][0]}'"
        return f"'Test {field['label']}'"

    elif cat == 'enum':
        return '0'

    elif cat == 'number':
        val = 100
        mn = field.get('min')
        mx = field.get('max')
        if mn is not None:
            val = max(mn, val)
        if mx is not None:
            val = min(mx, val)
        return str(val)

    elif cat == 'boolean':
        return 'true'

    elif cat == 'datetime':
        if any(kw in prop_name for kw in ('end', 'logout', 'finish')):
            return "'2025-01-15T17:00:00.000Z'"
        return "'2025-01-15T09:00:00.000Z'"

    return ''  # autocomplete


# ---------------------------------------------------------------------------
# Cypress command generators
# ---------------------------------------------------------------------------

def gen_fill_command(field: dict, value: str, indent: str) -> str:
    cat = field['category']
    label = field['label']
    if cat in ('text', 'number'):
        return f"{indent}cy.fillField('{label}', '{value}');"
    elif cat == 'datetime':
        fmt = field.get('format')
        if fmt == 'date':
            return f"{indent}cy.fillDate('{label}', '{value}');"
        elif fmt == 'time':
            return f"{indent}cy.fillTime('{label}', '{value}');"
        return f"{indent}cy.fillDateTime('{label}', '{value}');"
    elif cat == 'boolean':
        return f"{indent}cy.setCheckbox('{label}', {value});"
    elif cat == 'enum':
        return f"{indent}cy.selectAutocomplete('{label}', '{value}');"
    else:
        return f"{indent}cy.selectAutocomplete('{label}', '{value}');"


def gen_clear_command(field: dict, indent: str) -> str:
    cat = field['category']
    label = field['label']
    if cat in ('text', 'number'):
        return f"{indent}cy.clearField('{label}');"
    elif cat == 'datetime':
        return f"{indent}cy.clearDateTime('{label}');"
    elif cat == 'boolean':
        return f"{indent}cy.setCheckbox('{label}', false);"
    elif cat == 'enum':
        return f"{indent}cy.clearAutocomplete('{label}');"
    else:
        return f"{indent}cy.clearAutocomplete('{label}');"


def gen_assert_command(field: dict, value: str, indent: str) -> str:
    cat = field['category']
    label = field['label']
    if cat in ('text', 'number', 'datetime', 'autocomplete', 'enum'):
        return f"{indent}cy.checkField('{label}', '{value}');"
    else:
        return f"{indent}cy.setCheckbox('{label}', {value}); // verify checkbox state"


def gen_fill_commands(fields: list, entity_title: str, indent: str) -> list[str]:
    lines = []
    for field in fields:
        if field['category'] == 'autocomplete':
            dep_target = field.get('dep_target')
            if dep_target:
                dep_var = to_camel_case(dep_target)
                lines.append(f"{indent}cy.selectAutocomplete('{field['label']}', deps.{dep_var}.name);")
        else:
            value = cypress_create_value(field, entity_title)
            lines.append(gen_fill_command(field, value, indent))
    return lines


def gen_assert_commands(fields: list, entity_title: str, indent: str) -> list[str]:
    lines = []
    for field in fields:
        if field['category'] == 'autocomplete':
            dep_target = field.get('dep_target')
            if dep_target:
                dep_title = to_title_case(dep_target)
                lines.append(f"{indent}cy.checkField('{field['label']}', 'Test {dep_title}');")
        else:
            value = cypress_create_value(field, entity_title)
            lines.append(gen_assert_command(field, value, indent))
    return lines


# ---------------------------------------------------------------------------
# Child DataGrid object helpers
# ---------------------------------------------------------------------------

def _child_scalar_entries(fields: list, title: str, value_fn) -> list[str]:
    """Return JS object entries for scalar (non-autocomplete) datagrid child fields."""
    entries = []
    for field in fields:
        if field['category'] in ('autocomplete', 'enum'):
            continue
        value = value_fn(field, title)
        if field['category'] in ('boolean', 'number'):
            entries.append(f"{field['prop_name']}: {value}")
        else:
            entries.append(f"{field['prop_name']}: '{value}'")
    return entries


def gen_child_datagrid_object(child_meta: dict, action: str) -> str:
    """Generate fillDataGridRow object (scalar fields only; FK fields use selectDataGridSingleSelect)."""
    fields = child_meta['required_fields'] if action == 'create' else child_meta['fields']
    title = child_meta['names']['title']
    value_fn = cypress_create_value if action == 'create' else cypress_edit_value
    entries = _child_scalar_entries(fields, title, value_fn)
    return '{ ' + ', '.join(entries) + ' }'


def gen_child_full_datagrid_object(child_meta: dict) -> str:
    """Generate fillDataGridRow object for all fields (scalar only)."""
    entries = _child_scalar_entries(child_meta['fields'], child_meta['names']['title'], cypress_create_value)
    return '{ ' + ', '.join(entries) + ' }'


def gen_child_datagrid_fk_fields(fields: list, exclude_parent_model: str = '') -> list[dict]:
    """Return [{field, label}] for FK (singleSelect) fields in a datagrid child.

    Excludes self-referential FKs (dep_target == exclude_parent_model) because
    the parent entity doesn't exist yet when creating its children inline.
    """
    return [
        {'field': f['prop_name'], 'label': f"Test {to_title_case(f['dep_target'])}"}
        for f in fields
        if f['category'] == 'autocomplete'
        and f.get('dep_target')
        and f.get('dep_target') != exclude_parent_model
    ]



# ---------------------------------------------------------------------------
# Context builders (Jinja2 template contexts)
# ---------------------------------------------------------------------------

def test_helper_context(
    parent: str,
    children: list,
    schema: dict,
    model_name: str,
    definition_key: str,
    generate_config: dict,
) -> dict:
    parent_def = schema['definitions'].get(model_name)
    if not parent_def or not parent_def.get('properties'):
        return {}

    title = to_title_case(parent)
    pascal = to_pascal_case(parent)
    properties = filter_fields(parent_def['properties'], generate_config.get('fields'))
    required_fields = parent_def.get('required') or []
    relationships = get_parent_relationships(parent_def)
    fields = get_field_metas(properties, required_fields, relationships, generate_config.get('fields'))
    deps = resolve_dependencies(model_name, schema)
    entity_fk_deps = get_entity_fk_deps(model_name, schema, deps)

    required_field_metas = [f for f in fields if f['required']]
    optional_field_metas = [f for f in fields if not f['required']]

    child_metas = analyze_children(children, schema, model_name)
    datagrid_children = [c for c in child_metas if c['render_type'] == 'datagrid']
    comment_children_meta = [c for c in child_metas if c['render_type'] == 'comments']

    # Detect primary display field (for needs_second on FK primary deps)
    primary_field_name_h = _get_primary_display_field_name(parent_def)
    primary_is_fk_h = bool(
        primary_field_name_h
        and f'{primary_field_name_h}_id' in (parent_def.get('properties') or {})
    )
    primary_fk_dep_target = primary_field_name_h if primary_is_fk_h else None

    # Extend deps to include FK deps needed by datagrid children
    # (e.g. purchase_per_item needs product, but parent purchase_order doesn't)
    existing_dep_targets = {d['target'] for d in deps}
    for child_meta in datagrid_children:
        for field in child_meta['fields']:
            target = field.get('dep_target')
            if (field['category'] == 'autocomplete'
                    and target
                    and target != 'user_account'
                    and target != model_name
                    and target not in existing_dep_targets):
                deps.append({'target': target, 'var_name': to_camel_case(target), 'fk_deps': []})
                existing_dep_targets.add(target)

    # Collect user_account FK fields required by the parent (e.g. customer_id)
    # and add each as a separate user_account dep (creates a distinct user)
    ua_dep_fields = []  # [{prop_name, dep_var_name}] for use in populateData
    for r in relationships:
        if (r['target'] == 'user_account'
                and r['prop_name'] in required_fields
                and r['prop_name'] not in ('creator_id', 'updater_id')):
            prop_stem = re.sub(r'_id$', '', r['prop_name'])
            var_name = to_camel_case(prop_stem)
            deps.append({'target': 'user_account', 'var_name': var_name, 'prop_stem': prop_stem, 'fk_deps': [], 'is_user_account': True})
            ua_dep_fields.append({'prop_name': r['prop_name'], 'dep_var_name': var_name})

    # Add self-referential optional FK deps (e.g. procedure.parent_id → creates a base record)
    if not any(d['target'] == model_name for d in deps):
        for r in relationships:
            if r['target'] == model_name and r['prop_name'] not in ('updater_id', 'assignee_id'):
                var_name = to_camel_case(model_name)
                deps.append({'target': model_name, 'var_name': var_name, 'fk_deps': [], 'is_self_reference': True})
                entity_fk_deps.append({'prop_name': r['prop_name'], 'dep_var_name': var_name})
                break  # one self-ref dep covers the common case

    # Enrich deps with title, has_user_accounts, extra required fields, and needs_second
    enriched_deps = []
    for dep in deps:
        is_ua = dep.get('is_user_account', False)
        is_self_ref = dep.get('is_self_reference', False)
        if is_ua:
            enriched_deps.append({
                **dep,
                # Use prop_stem-based title (e.g. 'Customer' for customer_id, not 'User Account')
                'title': to_title_case(dep.get('prop_stem', dep['var_name'])),
                'has_user_accounts': False,
                'extra_required_fields': [],
                'needs_second': False,
            })
        elif is_self_ref:
            enriched_deps.append({
                **dep,
                'title': to_title_case(dep['target']),
                'has_user_accounts': False,
                'extra_required_fields': _get_dep_extra_required_fields(dep['target'], schema),
                'needs_second': False,
            })
        else:
            dep_def = schema['definitions'].get(dep['target'] + '_detail', {})
            x_rels = dep_def.get('x-relationships', {})
            enriched_deps.append({
                **dep,
                'title': to_title_case(dep['target']),
                'has_user_accounts': x_rels.get('user_accounts', {}).get('target') == 'user_account',
                'extra_required_fields': _get_dep_extra_required_fields(dep['target'], schema),
                'needs_second': dep['target'] == primary_fk_dep_target,
            })

    # Compute deps_return including second instances for FK primary deps
    deps_return_parts = []
    for dep in enriched_deps:
        deps_return_parts.append(dep['var_name'])
        if dep.get('needs_second'):
            deps_return_parts.append(f"{dep['var_name']}2")
    deps_return = ', '.join(deps_return_parts)

    def _enrich_field_prisma(field: dict, entity_title: str) -> dict:
        f = dict(field)
        if f['category'] == 'autocomplete':
            dep = next((d for d in entity_fk_deps if d['prop_name'] == f['prop_name']), None)
            f['dep_var_name'] = dep['dep_var_name'] if dep else None
            f['prisma_val'] = None
        else:
            f['prisma_val'] = prisma_value(f, 'i', entity_title)
            f['dep_var_name'] = None
        return f

    required_fields_prisma = [_enrich_field_prisma(f, title) for f in required_field_metas]
    all_fields_prisma = [_enrich_field_prisma(f, title) for f in fields]

    enriched_datagrid_children = []
    for child_meta in datagrid_children:
        child_name = child_meta['child']['name']
        child_pascal = to_pascal_case(child_name)
        child_title = to_title_case(child_name)
        child_def = schema['definitions'].get(child_name, {})
        has_fk_deps = False
        child_fields_prisma = []
        for f in child_meta['fields']:
            target = f.get('dep_target')
            if f['category'] == 'autocomplete' and target and target != 'user_account':
                if target == model_name:
                    # Self-referential FK: parent doesn't exist yet — use null
                    child_fields_prisma.append({**f, 'prisma_val': 'null'})
                else:
                    has_fk_deps = True
                    child_fields_prisma.append({**f, 'prisma_val': f'deps.{to_camel_case(target)}.id'})
            else:
                child_fields_prisma.append({**f, 'prisma_val': prisma_value(f, 'i', child_title)})
        enriched_datagrid_children.append({
            'model_name': child_name,
            'pascal': child_pascal,
            'parent_fk_prop': child_meta['parent_fk_prop'],
            'has_order': bool(child_def.get('properties', {}).get('order')),
            'fields_prisma': child_fields_prisma,
            'has_fk_deps': has_fk_deps,
        })

    enriched_comment_children = []
    for child_meta in comment_children_meta:
        child_name = child_meta['child']['name']
        enriched_comment_children.append({
            'model_name': child_name,
            'pascal': to_pascal_case(child_name),
            'parent_fk_prop': child_meta['parent_fk_prop'],
        })

    primary_fk_dep = next((d for d in enriched_deps if d.get('needs_second')), None)
    # Also detect when the primary display FK is a user_account field
    if primary_fk_dep is None and primary_fk_dep_target == 'user_account':
        primary_fk_dep = next(
            (d for d in enriched_deps
             if d.get('is_user_account') and d['var_name'] == to_camel_case(primary_fk_dep_target)),
            None,
        )

    # populateData/populateFullData need deps only when there are FK fields NOT covered
    # by the inline primary_fk_dep creation (or user_account deps).
    primary_fk_dep_var = primary_fk_dep['var_name'] if primary_fk_dep else None
    primary_fk_ua_dep_var = primary_fk_dep_var if (primary_fk_dep and primary_fk_dep.get('is_user_account')) else None
    non_primary_ua_dep_fields = [f for f in ua_dep_fields if f['dep_var_name'] != primary_fk_ua_dep_var]
    needs_deps_in_populate = bool(non_primary_ua_dep_fields) or any(
        f['category'] == 'autocomplete' and f['dep_var_name'] and f['dep_var_name'] != primary_fk_dep_var
        for f in required_fields_prisma
    )
    # populateFullData also needs deps when there are optional FK fields
    needs_deps_in_populate_full = bool(ua_dep_fields) or any(
        f['category'] == 'autocomplete' and f.get('dep_var_name')
        for f in all_fields_prisma
    )

    return {
        'pascal': pascal,
        'title': title,
        'model_name': model_name,
        'deps': enriched_deps,
        'deps_return': deps_return,
        'has_parent_deps': bool(entity_fk_deps) or bool(ua_dep_fields),
        'needs_deps_in_populate': needs_deps_in_populate,
        'needs_deps_in_populate_full': needs_deps_in_populate_full,
        'ua_dep_fields': ua_dep_fields,
        'required_fields_prisma': required_fields_prisma,
        'all_fields_prisma': all_fields_prisma,
        'has_optional': bool(optional_field_metas),
        'datagrid_children': enriched_datagrid_children,
        'comment_children': enriched_comment_children,
        'primary_fk_dep': primary_fk_dep,
    }


def test_spec_context(
    parent: str,
    children: list,
    schema: dict,
    model_name: str,
    definition_key: str,
    generate_config: dict,
) -> dict:
    parent_def = schema['definitions'].get(model_name)
    if not parent_def or not parent_def.get('properties'):
        return {}

    title = to_title_case(parent)
    pascal = to_pascal_case(parent)
    properties = filter_fields(parent_def['properties'], generate_config.get('fields'))
    required_fields = parent_def.get('required') or []
    relationships = get_parent_relationships(parent_def)
    fields = get_field_metas(properties, required_fields, relationships, generate_config.get('fields'))
    deps = resolve_dependencies(model_name, schema)

    # User_account FK fields required by the entity (e.g. customer_id → Customer autocomplete)
    ua_dep_fields_spec = []
    for r in relationships:
        if (r['target'] == 'user_account'
                and r['prop_name'] in required_fields
                and r['prop_name'] not in ('creator_id', 'updater_id')):
            var_name = to_camel_case(re.sub(r'_id$', '', r['prop_name']))
            field_label = to_title_case(re.sub(r'_id$', '', r['prop_name']))
            ua_dep_fields_spec.append({
                'prop_name': r['prop_name'],
                'dep_var_name': var_name,
                'label': field_label,
                'dep_name': f'Test {field_label}',
            })

    # Include self-referential optional FK deps in has_deps
    if not any(d['target'] == model_name for d in deps):
        for r in relationships:
            if r['target'] == model_name and r['prop_name'] not in ('updater_id', 'assignee_id'):
                deps.append({'target': model_name, 'var_name': to_camel_case(model_name)})
                break

    has_deps = bool(deps) or bool(ua_dep_fields_spec)

    required_field_metas = [f for f in fields if f['required']]
    optional_field_metas = [f for f in fields if not f['required']]
    non_autocomplete_required = [f for f in required_field_metas if f['category'] != 'autocomplete']

    child_metas = analyze_children(children, schema, model_name)
    datagrid_children = [c for c in child_metas if c['render_type'] == 'datagrid']
    list_children = [c for c in child_metas if c['render_type'] in ('editable-list-text', 'editable-list-autocomplete')]
    comment_children = [c for c in child_metas if c['render_type'] == 'comments']

    can_list   = generate_config.get('list', True)
    can_new    = generate_config.get('new', True)
    can_edit   = generate_config.get('edit', True)
    can_delete = generate_config.get('delete', True)
    can_view   = generate_config.get('view', True)

    # Indentation for .then((deps) => {}) wrapper in sections 2 and 5
    I = '        ' if has_deps else '      '

    # Pre-compute fill/assert command lists (indent already baked in)
    required_fill_cmds = gen_fill_commands(required_field_metas, title, I)
    all_fill_cmds = gen_fill_commands(fields, title, I)
    required_assert_cmds_no_bool = gen_assert_commands(
        [f for f in required_field_metas if f['category'] != 'boolean'], title, I)
    all_assert_cmds_no_bool = gen_assert_commands(
        [f for f in fields if f['category'] != 'boolean'], title, I)

    # Append user_account FK fill/assert commands
    for ua in ua_dep_fields_spec:
        required_fill_cmds.append(f"{I}cy.selectAutocomplete('{ua['label']}', deps.{ua['dep_var_name']}.name);")
        all_fill_cmds.append(f"{I}cy.selectAutocomplete('{ua['label']}', deps.{ua['dep_var_name']}.name);")
        required_assert_cmds_no_bool.append(f"{I}cy.checkField('{ua['label']}', '{ua['dep_name']}');")
        all_assert_cmds_no_bool.append(f"{I}cy.checkField('{ua['label']}', '{ua['dep_name']}');")

    # Compute list identifiers based on primary display field.
    # Priority: FK primary → explicit non-name primary → name → fallback.
    prim = _get_primary_display_field_name(parent_def)
    prim_is_fk = bool(prim and f'{prim}_id' in (parent_def.get('properties') or {}))
    has_name = any(f['prop_name'] == 'name' for f in fields)
    prim_meta = next((f for f in fields if f['prop_name'] == prim), None) if prim else None

    if prim_is_fk:
        dep_title = to_title_case(prim)
        list_id_1 = f'Test {dep_title} 1'
        after_create_id = None
        after_create_id_is_expr = True
        primary_dep_var_for_list = to_camel_case(prim)
        list_id_updated = list_id_1
        has_edit_primary = False
        edit_field_label = None
        edit_update_value = None
        check_field_label = dep_title
        check_field_value_1 = list_id_1
        check_field_updated = list_id_1
    elif prim and prim != 'name' and prim_meta:
        # Explicit non-name primary field (e.g., product.code).
        # Link in the list is on this column, so use it for all click navigation.
        lbl = prim_meta.get('label', to_title_case(prim))
        list_id_1 = f'Test {lbl} 1'
        after_create_id = cypress_create_value(prim_meta, title)
        after_create_id_is_expr = False
        primary_dep_var_for_list = None
        list_id_updated = f'Updated {lbl}'
        has_edit_primary = True
        edit_field_label = lbl
        edit_update_value = f'Updated {lbl}'
        check_field_label = lbl
        check_field_value_1 = list_id_1
        check_field_updated = list_id_updated
    elif has_name:
        list_id_1 = f'{title} 1'
        after_create_id = f'Test {title}'
        after_create_id_is_expr = False
        primary_dep_var_for_list = None
        list_id_updated = f'Updated {title}'
        has_edit_primary = True
        edit_field_label = 'Name'
        edit_update_value = f'Updated {title}'
        check_field_label = 'Name'
        check_field_value_1 = f'{title} 1'
        check_field_updated = f'Updated {title}'
    else:
        list_id_1 = f'{title} 1'
        after_create_id = f'Test {title}'
        after_create_id_is_expr = False
        primary_dep_var_for_list = None
        list_id_updated = f'Updated {title}'
        has_edit_primary = True
        edit_field_label = 'Name'
        edit_update_value = f'Updated {title}'
        check_field_label = 'Name'
        check_field_value_1 = f'{title} 1'
        check_field_updated = f'Updated {title}'

    # detail_required: which children are required in the parent form
    detail_def = schema['definitions'].get(definition_key, {})
    detail_required: list = list(detail_def.get('required') or [])
    for item in detail_def.get('allOf', []):
        if item.get('required'):
            detail_required.extend(item['required'])

    # Datagrid children data
    datagrid_children_data = []
    for child_meta in datagrid_children:
        child_name = child_meta['child']['name']
        fk_create_fields = gen_child_datagrid_fk_fields(child_meta['required_fields'], model_name)
        fk_full_fields = gen_child_datagrid_fk_fields(child_meta['fields'], model_name)
        datagrid_children_data.append({
            'title': child_meta['names']['title'],
            'pascal': to_pascal_case(child_name),
            'is_required_in_parent': child_meta['child']['property_name'] in detail_required,
            'create_obj': gen_child_datagrid_object(child_meta, 'create'),
            'full_create_obj': gen_child_full_datagrid_object(child_meta),
            'fk_create_fields': fk_create_fields,
            'fk_full_fields': fk_full_fields,
        })

    # List children data
    list_children_data = []
    for child_meta in list_children:
        rel = child_meta['child'].get('relationship') or {}
        rel_target = rel.get('target', '')
        list_children_data.append({
            'singular_pascal': child_meta['names']['singular_pascal_name'],
            'title': child_meta['names']['title'],
            'render_type': child_meta['render_type'],
            'rel_target': rel_target,
            'rel_target_title': to_title_case(rel_target) if rel_target else '',
            'target_pascal': to_pascal_case(rel_target) if rel_target else '',
            'is_external_target': bool(rel_target and rel_target != model_name),
        })

    # Comment children data
    comment_children_data = []
    for child_meta in comment_children:
        child_name = child_meta['child']['name']
        comment_children_data.append({
            'title': child_meta['names']['title'],
            'pascal': to_pascal_case(child_name),
        })

    # Section 3.1: optional fill commands (8-space indent, non-autocomplete only)
    opt_fill_cmds_3_1 = [
        gen_fill_command(f, cypress_create_value(f, title), '        ')
        for f in optional_field_metas
        if f['category'] != 'autocomplete'
    ]

    # Section 3.2: optional clear commands (8-space indent, non-autocomplete only)
    opt_clear_cmds_3_2 = [
        gen_clear_command(f, '        ')
        for f in optional_field_metas
        if f['category'] != 'autocomplete'
    ]

    # Section 3.3: edit value for first non-autocomplete optional field
    edit_fill_cmd_3_3 = None
    if optional_field_metas:
        first_opt = optional_field_metas[0]
        if first_opt['category'] != 'autocomplete':
            edit_fill_cmd_3_3 = gen_fill_command(first_opt, cypress_edit_value(first_opt, title), '        ')

    # Section 5.1: fill all required fields except one
    fail_create_5_1 = None
    if non_autocomplete_required:
        field_to_skip = next(
            (f for f in non_autocomplete_required if f['prop_name'] == 'name'),
            non_autocomplete_required[0],
        )
        fields_to_fill_5_1 = [f for f in required_field_metas if f['prop_name'] != field_to_skip['prop_name']]
        fail_create_5_1 = {'fill_cmds': gen_fill_commands(fields_to_fill_5_1, title, I)}

    # Section 5.2: missing scalar required child field; 5.3: missing FK required child field
    fail_create_5_2_scalar = None
    fail_create_5_2_fk = None
    children_with_required = [c for c in datagrid_children if c['required_fields']]
    if children_with_required:
        test_child = children_with_required[0]
        req_child_fields = test_child['required_fields']
        child_title = test_child['names']['title']
        scalar_required = [f for f in req_child_fields if f['category'] != 'autocomplete']
        fk_required = [f for f in req_child_fields if f['category'] == 'autocomplete']

        # 5.2: add child with all FK fields selected but one scalar field missing
        if scalar_required:
            skip_scalar = scalar_required[0]
            partial_scalar = [f for f in scalar_required if f['prop_name'] != skip_scalar['prop_name']]
            entries = _child_scalar_entries(partial_scalar, child_title, cypress_create_value)
            fail_create_5_2_scalar = {
                'title': child_title,
                'partial_obj': ('{ ' + ', '.join(entries) + ' }') if entries else None,
                'fk_fields': gen_child_datagrid_fk_fields(fk_required, model_name),
                'fill_cmds': gen_fill_commands(required_field_metas, title, I),
            }

        # 5.3: add child with all scalar fields filled but no FK selection
        if fk_required:
            entries = _child_scalar_entries(scalar_required, child_title, cypress_create_value)
            fail_create_5_2_fk = {
                'title': child_title,
                'partial_obj': ('{ ' + ', '.join(entries) + ' }') if entries else None,
                'fill_cmds': gen_fill_commands(required_field_metas, title, I),
            }

    # Section 6.1: clear a required field
    fail_edit_6_1 = None
    if non_autocomplete_required:
        field_to_clear = next(
            (f for f in non_autocomplete_required if f['prop_name'] == 'name'),
            non_autocomplete_required[0],
        )
        fail_edit_6_1 = {
        'clear_cmd': gen_clear_command(field_to_clear, '      '),
        'clear_cmd_nested': gen_clear_command(field_to_clear, '        '),
    }

    # Section 6.2: clear a non-FK required child field (singleSelect cannot be cleared via input)
    fail_edit_6_2 = None
    children_with_req = [c for c in datagrid_children if c['required_fields']]
    if children_with_req:
        test_child = children_with_req[0]
        child_field_to_clear = next(
            (f for f in test_child['required_fields'] if f['category'] != 'autocomplete'),
            None,
        )
        if child_field_to_clear:
            fail_edit_6_2 = {
                'child_pascal': to_pascal_case(test_child['child']['name']),
                'field_prop_name': child_field_to_clear['prop_name'],
            }

    return {
        'parent': parent,
        'pascal': pascal,
        'title': title,
        'model_name': model_name,
        'can_list': can_list,
        'can_new': can_new,
        'can_edit': can_edit,
        'can_delete': can_delete,
        'can_view': can_view,
        'has_deps': has_deps,
        'has_optional': bool(optional_field_metas),
        'has_children': bool(child_metas),
        'has_datagrid_children': bool(datagrid_children),
        'has_datagrid_fk_children': any(c['fk_create_fields'] or c['fk_full_fields'] for c in datagrid_children_data),
        'I': I,
        'required_fill_cmds': required_fill_cmds,
        'all_fill_cmds': all_fill_cmds,
        'required_assert_cmds_no_bool': required_assert_cmds_no_bool,
        'all_assert_cmds_no_bool': all_assert_cmds_no_bool,
        'datagrid_children_data': datagrid_children_data,
        'list_children_data': list_children_data,
        'comment_children_data': comment_children_data,
        'opt_fill_cmds_3_1': opt_fill_cmds_3_1,
        'opt_clear_cmds_3_2': opt_clear_cmds_3_2,
        'edit_fill_cmd_3_3': edit_fill_cmd_3_3,
        'fail_create_5_1': fail_create_5_1,
        'fail_create_5_2_scalar': fail_create_5_2_scalar,
        'fail_create_5_2_fk': fail_create_5_2_fk,
        'fail_edit_6_1': fail_edit_6_1,
        'fail_edit_6_2': fail_edit_6_2,
        # List identifiers
        'list_id_1': list_id_1,
        'after_create_id': after_create_id,
        'after_create_id_is_expr': after_create_id_is_expr,
        'primary_dep_var_for_list': primary_dep_var_for_list,
        'list_id_updated': list_id_updated,
        'has_edit_primary': has_edit_primary,
        'edit_field_label': edit_field_label,
        'edit_update_value': edit_update_value,
        'check_field_label': check_field_label,
        'check_field_value_1': check_field_value_1,
        'check_field_updated': check_field_updated,
    }


def test_tasks_registry_context(entities: list, schema: dict) -> dict:
    """Build context for the generated-tasks.ts registry template.

    `entities` is a list of dicts: {parent, model_name, children}.
    """
    enriched_entities = []
    has_user_account_populate = False
    for entity in entities:
        parent = entity['parent']
        pascal = to_pascal_case(parent)
        child_metas = analyze_children(entity['children'], schema, entity['model_name'])
        datagrid_children = [c for c in child_metas if c['render_type'] == 'datagrid']
        list_children = [c for c in child_metas if c['render_type'] in ('editable-list-autocomplete', 'editable-list-text')]
        comment_children_registry = [c for c in child_metas if c['render_type'] == 'comments']
        for lc in list_children:
            rel = lc['child'].get('relationship') or {}
            if rel.get('target') == 'user_account':
                has_user_account_populate = True
        enriched_entities.append({
            'parent': parent,
            'pascal': pascal,
            'helper_path': f'./{parent}/helper',
            'datagrid_children': [
                {'pascal': to_pascal_case(c['child']['name'])}
                for c in datagrid_children
            ],
            'comment_children': [
                {'pascal': to_pascal_case(c['child']['name'])}
                for c in comment_children_registry
            ],
        })
    return {'entities': enriched_entities, 'has_user_account_populate': has_user_account_populate}


def test_api_spec_context(
    parent: str,
    children: list,
    schema: dict,
    model_name: str | None = None,
    definition_key: str | None = None,
    generate_config: dict | None = None,
) -> dict:
    model = model_name or parent
    parent_pascal = to_pascal_case(parent)
    title = to_title_case(parent)
    api_path = f'/api/{parent}'

    model_def = schema['definitions'].get(model)
    if not model_def:
        return {}

    gen_cfg = generate_config or {}
    filtered_props = filter_fields(model_def.get('properties') or {}, gen_cfg.get('fields'))
    relationships = get_parent_relationships({**model_def, 'properties': filtered_props})

    required_fields_list = model_def.get('required') or []
    all_field_metas = get_field_metas(filtered_props, required_fields_list, relationships, gen_cfg.get('fields'))

    deps = resolve_dependencies(model, schema)
    entity_fk_deps = get_entity_fk_deps(model, schema, deps)

    child_metas = analyze_children(children, schema, model)
    api_child_metas = [c for c in child_metas if c['render_type'] != 'file']

    put_body_props = [
        k for k in filtered_props
        if k not in ('id', 'created_at', 'updated_at', 'creator_id')
    ]

    # Primary display field detection
    primary_field_name = _get_primary_display_field_name(model_def)
    primary_is_fk = bool(
        primary_field_name
        and f'{primary_field_name}_id' in (model_def.get('properties') or {})
    )
    primary_dep_var = to_camel_case(primary_field_name) if primary_is_fk else None

    # Detect if primary FK target is user_account (per-iteration creation in populateData)
    primary_fk_rel = next(
        (r for r in relationships if r['prop_name'] == f'{primary_field_name}_id'),
        None,
    ) if primary_is_fk else None
    primary_fk_is_ua = primary_is_fk and bool(primary_fk_rel) and primary_fk_rel['target'] == 'user_account'

    # User_account FK fields required by the entity (e.g. customer_id)
    ua_fk_fields_for_api = [
        {'prop_name': r['prop_name'], 'var_name': to_camel_case(re.sub(r'_id$', '', r['prop_name']))}
        for r in relationships
        if r['target'] == 'user_account'
        and r['prop_name'] in required_fields_list
        and r['prop_name'] not in ('creator_id', 'updater_id')
    ]

    has_deps = bool(entity_fk_deps) or bool(ua_fk_fields_for_api)

    I = '        ' if has_deps else '      '

    # When primary FK is user_account, find a non-FK field to use for PUT update validation
    ua_update_field = None
    ua_update_expr = None
    if primary_fk_is_ua:
        candidates = [
            f for f in all_field_metas
            if f['prop_name'] in put_body_props
            and f['category'] in ('enum', 'number')
            and f['prop_name'] not in ('creator_id', 'updater_id')
        ]
        for f in candidates:
            if f['category'] == 'enum':
                ua_update_field = f
                n = len(f['enum_values'])
                ua_update_expr = f'(records[0].{f["prop_name"]} + 1) % {n}'
                break
        if not ua_update_field:
            for f in candidates:
                if f['category'] == 'number' and f.get('max') is not None:
                    ua_update_field = f
                    mn = f.get('min', 0)
                    if mn == 0:
                        ua_update_expr = f'(records[0].{f["prop_name"]} + 1) % {f["max"] + 1}'
                    else:
                        ua_update_expr = f'Math.min({f["max"]}, records[0].{f["prop_name"]} + 1)'
                    break
        if not ua_update_field and candidates:
            ua_update_field = candidates[0]
            ua_update_expr = f'records[0].{candidates[0]["prop_name"]} + 100'

    # Compute assertions for 3.1 and 4.1 based on primary display field
    # Fallback: use 'name' field if no x-display primary is set
    has_name_field = any(f['prop_name'] == 'name' for f in all_field_metas)
    if primary_fk_is_ua and ua_update_field:
        assert_create = f'expect(getRes.body.{primary_field_name}.name).to.eq(deps.{primary_dep_var}.name);'
        assert_update = f'expect(getRes.body.{ua_update_field["prop_name"]}).to.eq({ua_update_expr});'
    elif primary_is_fk:
        assert_create = f'expect(getRes.body.{primary_field_name}.name).to.eq(deps.{primary_dep_var}.name);'
        assert_update = f'expect(getRes.body.{primary_field_name}.name).to.eq(deps.{primary_dep_var}2.name);'
    elif primary_field_name:
        primary_meta = next((f for f in all_field_metas if f['prop_name'] == primary_field_name), None)
        if primary_meta:
            create_val = api_value(primary_meta, title)
            update_label = primary_meta.get('label', to_title_case(primary_field_name))
            assert_create = f"expect(getRes.body.{primary_field_name}).to.eq({create_val});"
            assert_update = f"expect(getRes.body.{primary_field_name}).to.eq('Updated {update_label}');"
        else:
            assert_create = 'expect(getRes.body.id).to.exist;'
            assert_update = 'expect(getRes.body.id).to.eq(records[0].id);'
    elif has_name_field:
        assert_create = f"expect(getRes.body.name).to.eq('Test {title}');"
        assert_update = f"expect(getRes.body.name).to.eq('Updated {title}');"
    else:
        assert_create = 'expect(getRes.body.id).to.exist;'
        assert_update = 'expect(getRes.body.id).to.eq(records[0].id);'

    # For the name-fallback case, _put_body_impl also needs to change 'name'
    has_name_fallback = has_name_field and not primary_field_name and not primary_is_fk

    # 5.1: choose which required non-autocomplete field to omit
    non_ac_required = [f for f in all_field_metas if f['required'] and f['category'] != 'autocomplete']
    field_to_skip_5_1 = None
    if non_ac_required:
        field_to_skip_5_1 = next(
            (f['prop_name'] for f in non_ac_required if f['prop_name'] == 'name'),
            non_ac_required[0]['prop_name'],
        )

    def _post_body_impl(skip_field: str | None, indent: str) -> list[str]:
        out = []
        for field in all_field_metas:
            if not field['required']:
                continue
            if field['prop_name'] == skip_field:
                continue
            if field['category'] == 'autocomplete':
                dep = next((d for d in entity_fk_deps if d['prop_name'] == field['prop_name']), None)
                if dep:
                    out.append(f"{indent}{field['prop_name']}: deps.{dep['dep_var_name']}.id,")
            else:
                out.append(f"{indent}{field['prop_name']}: {api_value(field, title)},")
        for ua in ua_fk_fields_for_api:
            if ua['prop_name'] != skip_field:
                out.append(f"{indent}{ua['prop_name']}: deps.{ua['var_name']}.id,")
        for c in api_child_metas:
            out.append(f"{indent}{c['child']['property_name']}: [],")
        return out

    def _put_body_impl(indent: str) -> list[str]:
        out = []
        for prop in put_body_props:
            if primary_is_fk and not primary_fk_is_ua and prop == f'{primary_field_name}_id':
                out.append(f"{indent}{prop}: deps.{primary_dep_var}2.id,")
            elif primary_fk_is_ua and ua_update_field and prop == ua_update_field['prop_name']:
                out.append(f"{indent}{prop}: {ua_update_expr},")
            elif not primary_is_fk and primary_field_name and prop == primary_field_name:
                primary_meta = next((f for f in all_field_metas if f['prop_name'] == prop), None)
                update_label = primary_meta.get('label', to_title_case(prop)) if primary_meta else to_title_case(prop)
                out.append(f"{indent}{prop}: 'Updated {update_label}',")
            elif has_name_fallback and prop == 'name':
                out.append(f"{indent}name: 'Updated {title}',")
            else:
                out.append(f"{indent}{prop}: records[0].{prop},")
        for c in api_child_metas:
            out.append(f"{indent}{c['child']['property_name']}: [],")
        return out

    return {
        'parent': parent,
        'pascal': parent_pascal,
        'title': title,
        'model': model,
        'api_path': api_path,
        'has_deps': has_deps,
        'primary_is_fk': primary_is_fk,
        'primary_fk_is_ua': primary_fk_is_ua,
        'can_list': gen_cfg.get('list', True) is not False,
        'can_view': gen_cfg.get('view', True) is not False,
        'can_new': gen_cfg.get('new', True) is not False,
        'can_edit': gen_cfg.get('edit', True) is not False,
        'can_delete': gen_cfg.get('delete', True) is not False,
        'I': I,
        'I7': I,  # same indentation level as I for section 7
        'assert_create': assert_create,
        'assert_update': assert_update,
        'post_body_create': _post_body_impl(None, f'{I}    '),
        'post_body_missing_field': _post_body_impl(field_to_skip_5_1, f'{I}    '),
        'put_body_update': _put_body_impl('            '),
        'put_body_update_fk': _put_body_impl('              '),
        'i7_post_body': _post_body_impl(None, f'{I}      '),
        # Bulk test bodies — two extra spaces of indent (inside array item `{`)
        'bulk_post_body_valid':   _post_body_impl(None,               f'{I}      '),
        'bulk_post_body_invalid': _post_body_impl(field_to_skip_5_1, f'{I}      '),
        # Bulk PUT: non-FK inside one `.then((records)=>`, FK inside two `.then` blocks
        'bulk_put_body_valid':    _put_body_impl('              '),   # 14 spaces
        'bulk_put_body_valid_fk': _put_body_impl('                '), # 16 spaces
    }
