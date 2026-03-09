"""
generators_test.py — Cypress E2E test code generation.

Port of templates-test.ts to Python.

Generates:
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
            return '01/15/2025'
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
        return f"{indent}cy.fillDateTime('{label}', '{value}');"
    elif cat == 'boolean':
        return f"{indent}cy.setCheckbox('{label}', {value});"
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
    else:
        return f"{indent}cy.clearAutocomplete('{label}');"


def gen_assert_command(field: dict, value: str, indent: str) -> str:
    cat = field['category']
    label = field['label']
    if cat in ('text', 'number', 'datetime', 'autocomplete'):
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

def gen_child_datagrid_object(child_meta: dict, action: str) -> str:
    fields = child_meta['required_fields'] if action == 'create' else child_meta['fields']
    title = child_meta['names']['title']
    entries = []
    for field in fields:
        value = cypress_create_value(field, title) if action == 'create' else cypress_edit_value(field, title)
        if field['category'] in ('boolean', 'number'):
            entries.append(f"{field['prop_name']}: {value}")
        else:
            entries.append(f"{field['prop_name']}: '{value}'")
    return '{ ' + ', '.join(entries) + ' }'


def gen_child_full_datagrid_object(child_meta: dict) -> str:
    title = child_meta['names']['title']
    entries = []
    for field in child_meta['fields']:
        value = cypress_create_value(field, title)
        if field['category'] in ('boolean', 'number'):
            entries.append(f"{field['prop_name']}: {value}")
        else:
            entries.append(f"{field['prop_name']}: '{value}'")
    return '{ ' + ', '.join(entries) + ' }'


# ---------------------------------------------------------------------------
# generateTestHelper
# ---------------------------------------------------------------------------

def generate_test_helper(
    parent: str,
    children: list,
    schema: dict,
    model_name: str,
    definition_key: str,
    generate_config: dict,
) -> str:
    parent_def = schema['definitions'].get(model_name)
    if not parent_def or not parent_def.get('properties'):
        return '// No properties found for entity\n'

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

    lines = []

    # Header
    lines.append('// AUTO-GENERATED - DO NOT EDIT')
    lines.append("import { prisma } from '../db-helpers';")
    lines.append("import { TEST_CREDENTIALS } from '../test-credentials';")
    lines.append('')

    # getTestUser
    lines.append('async function getTestUser() {')
    lines.append('  const testUser = await prisma.user_account.findUnique({')
    lines.append('    where: { email: TEST_CREDENTIALS.email },')
    lines.append('  });')
    lines.append("  if (!testUser) throw new Error('Test user not found. Make sure db:seed has run first.');")
    lines.append('  return testUser;')
    lines.append('}')
    lines.append('')

    # populateDependencies
    lines.append(f'export async function populate{pascal}Dependencies() {{')
    if not deps:
        lines.append('  return {};')
    else:
        lines.append('  const testUser = await getTestUser();')
        for dep in deps:
            dep_def = schema['definitions'].get(dep['target'] + '_detail', {})
            dep_title = to_title_case(dep['target'])
            data_fields = [f"name: 'Test {dep_title}'"]
            for fk in dep['fk_deps']:
                data_fields.append(f"{fk['prop_name']}: {fk['dep_var_name']}.id")
            data_fields.append('creator_id: testUser.id')
            data_fields.append('updater_id: testUser.id')

            x_rels = dep_def.get('x-relationships', {})
            if x_rels.get('user_accounts', {}).get('target') == 'user_account':
                data_fields.append(
                    '\n      user_accounts: {\n'
                    '        connect: [testUser.id].map((id) => ({ id }))\n'
                    '      }\n   '
                )

            data_str = ', '.join(data_fields)
            lines.append(f'  const {dep["var_name"]} = await prisma.{dep["target"]}.create({{')
            lines.append(f'    data: {{ {data_str} }},')
            lines.append('  });')

        return_obj = ', '.join(d['var_name'] for d in deps)
        lines.append(f'  return {{ {return_obj} }};')
    lines.append('}')
    lines.append('')

    # populateData (required fields only)
    lines.append(f'export async function populate{pascal}Data(length: number) {{')
    lines.append('  const testUser = await getTestUser();')
    if deps:
        lines.append(f'  const deps = await populate{pascal}Dependencies();')
    lines.append('  const records = [];')
    lines.append('  for (let i = 1; i <= length; i++) {')
    lines.append(f'    const record = await prisma.{model_name}.create({{')
    lines.append('      data: {')

    for field in required_field_metas:
        if field['category'] == 'autocomplete':
            dep = next((d for d in entity_fk_deps if d['prop_name'] == field['prop_name']), None)
            if dep:
                lines.append(f"        {field['prop_name']}: deps.{dep['dep_var_name']}.id,")
        else:
            lines.append(f"        {field['prop_name']}: {prisma_value(field, 'i', title)},")

    lines.append('        creator_id: testUser.id,')
    lines.append('        updater_id: testUser.id,')
    lines.append('      },')
    lines.append('    });')
    lines.append('    records.push(record);')
    lines.append('  }')
    lines.append('  return records;')
    lines.append('}')
    lines.append('')

    # populateFullData (all fields)
    if optional_field_metas:
        lines.append(f'export async function populate{pascal}FullData(length: number) {{')
        lines.append('  const testUser = await getTestUser();')
        if deps:
            lines.append(f'  const deps = await populate{pascal}Dependencies();')
        lines.append('  const records = [];')
        lines.append('  for (let i = 1; i <= length; i++) {')
        lines.append(f'    const record = await prisma.{model_name}.create({{')
        lines.append('      data: {')

        for field in fields:
            if field['category'] == 'autocomplete':
                dep = next((d for d in entity_fk_deps if d['prop_name'] == field['prop_name']), None)
                if dep:
                    lines.append(f"        {field['prop_name']}: deps.{dep['dep_var_name']}.id,")
            else:
                lines.append(f"        {field['prop_name']}: {prisma_value(field, 'i', title)},")

        lines.append('        creator_id: testUser.id,')
        lines.append('        updater_id: testUser.id,')
        lines.append('      },')
        lines.append('    });')
        lines.append('    records.push(record);')
        lines.append('  }')
        lines.append('  return records;')
        lines.append('}')
        lines.append('')
    else:
        lines.append(f'export const populate{pascal}FullData = populate{pascal}Data;')
        lines.append('')

    # Child populate functions (one-to-many DataGrid children)
    for child_meta in datagrid_children:
        child_name = child_meta['child']['name']
        child_pascal = to_pascal_case(child_name)
        child_title = to_title_case(child_name)
        child_def = schema['definitions'].get(child_name, {})

        lines.append(f'export async function populate{pascal}{child_pascal}Data(parentId: string, length: number) {{')
        lines.append('  const records = [];')
        lines.append('  for (let i = 1; i <= length; i++) {')
        lines.append(f'    const record = await prisma.{child_name}.create({{')
        lines.append('      data: {')
        lines.append(f'        {child_meta["parent_fk_prop"]}: parentId,')

        if child_def.get('properties', {}).get('order'):
            lines.append('        order: i,')

        for field in child_meta['fields']:
            lines.append(f"        {field['prop_name']}: {prisma_value(field, 'i', child_title)},")

        lines.append('      },')
        lines.append('    });')
        lines.append('    records.push(record);')
        lines.append('  }')
        lines.append('  return records;')
        lines.append('}')
        lines.append('')

    return '\n'.join(lines) + '\n'


# ---------------------------------------------------------------------------
# generateTestSpec
# ---------------------------------------------------------------------------

def generate_test_spec(
    parent: str,
    children: list,
    schema: dict,
    model_name: str,
    definition_key: str,
    generate_config: dict,
) -> str:
    parent_def = schema['definitions'].get(model_name)
    if not parent_def or not parent_def.get('properties'):
        return '// No properties found for entity\n'

    title = to_title_case(parent)
    pascal = to_pascal_case(parent)
    properties = filter_fields(parent_def['properties'], generate_config.get('fields'))
    required_fields = parent_def.get('required') or []
    relationships = get_parent_relationships(parent_def)
    fields = get_field_metas(properties, required_fields, relationships, generate_config.get('fields'))
    deps = resolve_dependencies(model_name, schema)
    has_deps = bool(deps)

    required_field_metas = [f for f in fields if f['required']]
    optional_field_metas = [f for f in fields if not f['required']]
    non_autocomplete_required = [f for f in required_field_metas if f['category'] != 'autocomplete']

    child_metas = analyze_children(children, schema, model_name)
    datagrid_children = [c for c in child_metas if c['render_type'] == 'datagrid']
    list_children = [c for c in child_metas if c['render_type'] in ('editable-list-text', 'editable-list-autocomplete')]
    has_children = bool(child_metas)
    has_datagrid_children = bool(datagrid_children)

    # Indent inside .then() wrapper vs direct
    I = '        ' if has_deps else '      '
    has_optional = bool(optional_field_metas)

    can_list   = generate_config.get('list', True)
    can_new    = generate_config.get('new', True)
    can_edit   = generate_config.get('edit', True)
    can_delete = generate_config.get('delete', True)
    can_view   = generate_config.get('view', True)

    lines = []

    # Imports
    lines.append('// AUTO-GENERATED - DO NOT EDIT')
    lines.append("import { TEST_CREDENTIALS } from '../support/test-credentials';")
    if has_datagrid_children:
        lines.append("import { fillDataGridRow, assertDataGridEmpty, getDataGridRowCount, assertDataGridRowData } from '../support/datagrid-helpers';")
    else:
        lines.append("import { assertDataGridEmpty, getDataGridRowCount } from '../support/datagrid-helpers';")
    lines.append('')

    # Main describe
    lines.append(f"describe('Testing {title} pages and their behavior', () => {{")

    # beforeEach
    lines.append("  beforeEach(() => {")
    lines.append("    cy.task('db:reset');")
    lines.append("    cy.task('db:seed');")
    lines.append("    Cypress.session.clearAllSavedSessions();")
    lines.append("    cy.clearCookies();")
    lines.append("    cy.clearLocalStorage();")
    lines.append("    cy.visit('/en/');")
    lines.append("    cy.window().then((win) => { win.sessionStorage.clear(); });")
    lines.append("    cy.login(TEST_CREDENTIALS.email, TEST_CREDENTIALS.password);")
    lines.append("  });")
    lines.append('')

    # ---- 1. Display list ----
    if can_list:
        lines.append("  describe('Display list', () => {")

        lines.append("    it('1.1 shows empty state with no items', () => {")
        lines.append(f"      cy.visit('/en/{parent}');")
        lines.append("      assertDataGridEmpty();")
        lines.append("    });")
        lines.append('')

        lines.append("    it('1.2 shows list with one item', () => {")
        lines.append(f"      cy.task('db:populate{pascal}', 1);")
        lines.append(f"      cy.visit('/en/{parent}');")
        lines.append(f"      cy.contains('{title} 1').should('be.visible');")
        lines.append("      getDataGridRowCount().should('eq', 1);")
        lines.append("    });")
        lines.append('')

        lines.append("    it('1.3 shows list with multiple items', () => {")
        lines.append(f"      cy.task('db:populate{pascal}', 3);")
        lines.append(f"      cy.visit('/en/{parent}');")
        lines.append(f"      cy.contains('{title} 1').should('be.visible');")
        lines.append("      getDataGridRowCount().should('eq', 3);")
        lines.append("    });")

        lines.append("  });")
        lines.append('')

    # ---- 2. Create ----
    if can_new:
        lines.append("  describe('Create', () => {")

        # 2.1 minimal data
        lines.append("    it('2.1 creates with minimal data (required fields only)', () => {")
        if has_deps:
            lines.append(f"      cy.task<any>('db:populate{pascal}Dependencies').then((deps) => {{")
        lines.append(f"{I}cy.visit('/en/{parent}');")
        lines.append(f"{I}cy.clickButton('Create New {title}');")

        for line in gen_fill_commands(required_field_metas, title, I):
            lines.append(line)

        # Add required DataGrid children
        detail_def = schema['definitions'].get(definition_key, {})
        detail_required: list = list(detail_def.get('required') or [])
        for item in detail_def.get('allOf', []):
            if item.get('required'):
                detail_required.extend(item['required'])

        for child_meta in datagrid_children:
            if child_meta['child']['property_name'] in detail_required:
                child_title = child_meta['names']['title']
                lines.append(f"{I}// Add required child: {child_title}")
                lines.append(f"{I}cy.clickButton('Add {child_title}');")
                lines.append(f"{I}fillDataGridRow(0, {gen_child_datagrid_object(child_meta, 'create')});")

        lines.append(f"{I}cy.clickButton('Save');")
        lines.append(f"{I}cy.url().should('include', '/{parent}');")
        lines.append(f"{I}cy.contains('Test {title}').should('be.visible');")

        if can_view:
            lines.append(f"{I}// Verify on view page")
            lines.append(f"{I}cy.contains('Test {title}').click();")
            lines.append(f"{I}cy.url().should('include', '/{parent}/view');")
            for line in gen_assert_commands([f for f in required_field_metas if f['category'] != 'boolean'], title, I):
                lines.append(line)

        if has_deps:
            lines.append("      });")
        lines.append("    });")
        lines.append('')

        # 2.2 full data
        lines.append("    it('2.2 creates with full data (all fields and children)', () => {")
        if has_deps:
            lines.append(f"      cy.task<any>('db:populate{pascal}Dependencies').then((deps) => {{")

        for child_meta in list_children:
            rel = child_meta['child'].get('relationship') or {}
            if child_meta['render_type'] == 'editable-list-autocomplete' and rel.get('target'):
                target = rel['target']
                if target != model_name:
                    target_pascal = to_pascal_case(target)
                    lines.append(f"{I}cy.task('db:populate{target_pascal}', 2);")

        lines.append(f"{I}cy.visit('/en/{parent}');")
        lines.append(f"{I}cy.clickButton('Create New {title}');")

        for line in gen_fill_commands(fields, title, I):
            lines.append(line)

        for child_meta in datagrid_children:
            child_title = child_meta['names']['title']
            lines.append(f"{I}// Add child: {child_title}")
            lines.append(f"{I}cy.clickButton('Add {child_title}');")
            lines.append(f"{I}fillDataGridRow(0, {gen_child_full_datagrid_object(child_meta)});")

        for child_meta in list_children:
            rel = child_meta['child'].get('relationship') or {}
            singular_pascal = child_meta['names']['singular_pascal_name']
            child_title = child_meta['names']['title']
            if child_meta['render_type'] == 'editable-list-text':
                lines.append(f"{I}// Add list item: {child_title}")
                lines.append(f"{I}cy.clickButton('Add {singular_pascal}');")
                lines.append(f"{I}cy.get('div[role=\"dialog\"]').find('input').type('Test {child_title} Item');")
                lines.append(f"{I}cy.get('div[role=\"dialog\"]').find('button').contains('Add').click();")
            elif child_meta['render_type'] == 'editable-list-autocomplete' and rel.get('target'):
                target_title = to_title_case(rel['target'])
                lines.append(f"{I}// Add list item: {child_title}")
                lines.append(f"{I}cy.clickButton('Add {singular_pascal}');")
                lines.append(f"{I}cy.get('div[role=\"dialog\"]').find('input').type('{target_title} 1');")
                lines.append(f"{I}cy.get('.MuiAutocomplete-popper li').contains('{target_title} 1').click();")
                lines.append(f"{I}cy.get('div[role=\"dialog\"]').find('button').contains('Add').click();")

        lines.append(f"{I}cy.clickButton('Save');")
        lines.append(f"{I}cy.url().should('include', '/{parent}');")
        lines.append(f"{I}cy.contains('Test {title}').should('be.visible');")

        if can_view:
            lines.append(f"{I}// Verify on view page")
            lines.append(f"{I}cy.contains('Test {title}').click();")
            lines.append(f"{I}cy.url().should('include', '/{parent}/view');")
            for line in gen_assert_commands([f for f in fields if f['category'] != 'boolean'], title, I):
                lines.append(line)

        if has_deps:
            lines.append("      });")
        lines.append("    });")

        lines.append("  });")
        lines.append('')

    # ---- 3. Edit ----
    if can_edit:
        lines.append("  describe('Edit', () => {")

        # 3.1 Add optional data
        if has_optional or has_children:
            lines.append("    it('3.1 adds optional data and child items', () => {")
            lines.append(f"      cy.task<any[]>('db:populate{pascal}', 1).then((records) => {{")

            for child_meta in list_children:
                rel = child_meta['child'].get('relationship') or {}
                if child_meta['render_type'] == 'editable-list-autocomplete' and rel.get('target'):
                    target = rel['target']
                    if target != model_name:
                        target_pascal = to_pascal_case(target)
                        lines.append(f"        cy.task('db:populate{target_pascal}', 2);")

            lines.append(f"        cy.visit('/en/{parent}');")
            lines.append(f"        cy.contains('{title} 1').click();")
            lines.append("        cy.get('[aria-label=\"Edit\"]').click();")
            lines.append(f"        cy.url().should('include', '/{parent}/edit');")

            for field in optional_field_metas:
                if field['category'] != 'autocomplete':
                    value = cypress_create_value(field, title)
                    lines.append(gen_fill_command(field, value, '        '))

            for child_meta in datagrid_children:
                child_title = child_meta['names']['title']
                lines.append(f"        // Add child: {child_title}")
                lines.append(f"        cy.clickButton('Add {child_title}');")
                lines.append(f"        fillDataGridRow(0, {gen_child_datagrid_object(child_meta, 'create')});")

            for child_meta in list_children:
                rel = child_meta['child'].get('relationship') or {}
                singular_pascal = child_meta['names']['singular_pascal_name']
                child_title = child_meta['names']['title']
                if child_meta['render_type'] == 'editable-list-text':
                    lines.append(f"        cy.clickButton('Add {singular_pascal}');")
                    lines.append(f"        cy.get('div[role=\"dialog\"]').find('input').type('Test {child_title} Item');")
                    lines.append(f"        cy.get('div[role=\"dialog\"]').find('button').contains('Add').click();")
                elif child_meta['render_type'] == 'editable-list-autocomplete' and rel.get('target'):
                    target_title = to_title_case(rel['target'])
                    lines.append(f"        cy.clickButton('Add {singular_pascal}');")
                    lines.append(f"        cy.get('div[role=\"dialog\"]').find('input').type('{target_title} 1');")
                    lines.append(f"        cy.get('.MuiAutocomplete-popper li').contains('{target_title} 1').click();")
                    lines.append(f"        cy.get('div[role=\"dialog\"]').find('button').contains('Add').click();")

            lines.append("        cy.clickButton('Save');")
            lines.append(f"        cy.url().should('include', '/{parent}');")
            lines.append(f"        cy.contains('{title} 1').should('be.visible');")

            if can_view:
                lines.append("        // Verify on view page")
                lines.append(f"        cy.contains('{title} 1').click();")
                lines.append(f"        cy.url().should('include', '/{parent}/view');")
                lines.append("        cy.checkField('Name', '" + f"{title} 1" + "');")

            lines.append("      });")
            lines.append("    });")
            lines.append('')

        # 3.2 Remove optional data
        if has_optional or has_children:
            lines.append("    it('3.2 removes optional data and child items', () => {")
            if optional_field_metas:
                lines.append(f"      cy.task<any[]>('db:populate{pascal}Full', 1).then((records) => {{")
            else:
                lines.append(f"      cy.task<any[]>('db:populate{pascal}', 1).then((records) => {{")

            for child_meta in datagrid_children:
                child_pascal = to_pascal_case(child_meta['child']['name'])
                lines.append(f"        cy.task('db:populate{pascal}{child_pascal}', {{ parentId: records[0].id, length: 1 }});")

            lines.append(f"        cy.visit('/en/{parent}');")
            lines.append(f"        cy.contains('{title} 1').click();")
            lines.append("        cy.get('[aria-label=\"Edit\"]').click();")
            lines.append(f"        cy.url().should('include', '/{parent}/edit');")

            for field in optional_field_metas:
                if field['category'] != 'autocomplete':
                    lines.append(gen_clear_command(field, '        '))

            for child_meta in datagrid_children:
                child_title = child_meta['names']['title']
                lines.append(f"        // Delete child: {child_title}")
                lines.append("        cy.selectDataGridRows([0]);")
                lines.append(f"        cy.contains('h2', '{child_title}').parent().find('button[aria-label=\"Delete Selected\"]').click();")
                lines.append("        cy.get('div[role=\"dialog\"]').find('button').contains('Delete').click();")

            lines.append("        cy.clickButton('Save');")
            lines.append(f"        cy.url().should('include', '/{parent}');")
            lines.append(f"        cy.contains('{title} 1').should('be.visible');")

            lines.append("      });")
            lines.append("    });")
            lines.append('')

        # 3.3 Mixed changes
        lines.append("    it('3.3 edits with mixed changes', () => {")
        lines.append(f"      cy.task<any[]>('db:populate{pascal}', 1).then((records) => {{")
        lines.append(f"        cy.visit('/en/{parent}');")
        lines.append(f"        cy.contains('{title} 1').click();")
        lines.append("        cy.get('[aria-label=\"Edit\"]').click();")
        lines.append(f"        cy.clearAndFillField('Name', 'Updated {title}');")

        if optional_field_metas:
            first_opt = optional_field_metas[0]
            if first_opt['category'] != 'autocomplete':
                value = cypress_edit_value(first_opt, title)
                lines.append(gen_fill_command(first_opt, value, '        '))

        lines.append("        cy.clickButton('Save');")
        lines.append(f"        cy.url().should('include', '/{parent}');")
        lines.append(f"        cy.contains('Updated {title}').should('be.visible');")

        if can_view:
            lines.append("        // Verify on view page")
            lines.append(f"        cy.contains('Updated {title}').click();")
            lines.append(f"        cy.url().should('include', '/{parent}/view');")
            lines.append(f"        cy.checkField('Name', 'Updated {title}');")

        lines.append("      });")
        lines.append("    });")

        lines.append("  });")
        lines.append('')

    # ---- 4. Delete ----
    if can_delete:
        lines.append("  describe('Delete', () => {")

        if can_list:
            lines.append("    it('4.1 deletes a single item from list view', () => {")
            lines.append(f"      cy.task('db:populate{pascal}', 2);")
            lines.append(f"      cy.visit('/en/{parent}');")
            lines.append("      cy.selectDataGridRows([0]);")
            lines.append("      cy.get('div').find('button[aria-label=\"Delete Selected\"]').click();")
            lines.append("      cy.get('div[role=\"dialog\"]').find('button').contains('Delete').click();")
            lines.append("      getDataGridRowCount().should('eq', 1);")
            lines.append("    });")
            lines.append('')

            lines.append("    it('4.2 deletes multiple items from list view', () => {")
            lines.append(f"      cy.task('db:populate{pascal}', 3);")
            lines.append(f"      cy.visit('/en/{parent}');")
            lines.append("      cy.selectDataGridRows([0, 1]);")
            lines.append("      cy.get('div').find('button[aria-label=\"Delete Selected\"]').click();")
            lines.append("      cy.get('div[role=\"dialog\"]').find('button').contains('Delete').click();")
            lines.append("      getDataGridRowCount().should('eq', 1);")
            lines.append("    });")
            lines.append('')

        if can_edit:
            lines.append("    it('4.3 deletes an item from edit page', () => {")
            lines.append(f"      cy.task('db:populate{pascal}', 1);")
            lines.append(f"      cy.visit('/en/{parent}');")
            lines.append(f"      cy.contains('{title} 1').click();")
            lines.append("      cy.get('[aria-label=\"Edit\"]').click();")
            lines.append(f"      cy.url().should('include', '/{parent}/edit');")
            lines.append(f"      cy.clickButton('Delete {title}');")
            lines.append("      cy.get('div[role=\"dialog\"]').find('button').contains('Delete').click();")
            lines.append(f"      cy.url().should('include', '/{parent}');")
            lines.append(f"      cy.contains('{title} 1').should('not.exist');")
            lines.append("    });")

        lines.append("  });")
        lines.append('')

    # ---- 5. Fail create ----
    if can_new:
        lines.append("  describe('Fail create', () => {")

        if non_autocomplete_required:
            field_to_skip = next(
                (f for f in non_autocomplete_required if f['prop_name'] == 'name'),
                non_autocomplete_required[0],
            )
            fields_to_fill = [f for f in required_field_metas if f['prop_name'] != field_to_skip['prop_name']]

            lines.append("    it('5.1 fails when required parent field is missing', () => {")
            if has_deps:
                lines.append(f"      cy.task<any>('db:populate{pascal}Dependencies').then((deps) => {{")
            lines.append(f"{I}cy.visit('/en/{parent}/new');")

            for line in gen_fill_commands(fields_to_fill, title, I):
                lines.append(line)

            lines.append(f"{I}cy.clickButton('Save');")
            lines.append(f"{I}cy.url().should('include', '/{parent}/new');")

            if has_deps:
                lines.append("      });")
            lines.append("    });")
            lines.append('')

        # 5.2 required child field missing
        children_with_required = [c for c in datagrid_children if c['required_fields']]
        if children_with_required:
            test_child = children_with_required[0]
            req_child_fields = test_child['required_fields']
            if len(req_child_fields) > 1:
                skip_field = req_child_fields[-1]
                partial_fields = [f for f in req_child_fields if f['prop_name'] != skip_field['prop_name']]
                partial_obj = []
                for field in partial_fields:
                    value = cypress_create_value(field, test_child['names']['title'])
                    if field['category'] in ('boolean', 'number'):
                        partial_obj.append(f"{field['prop_name']}: {value}")
                    else:
                        partial_obj.append(f"{field['prop_name']}: '{value}'")

                lines.append("    it('5.2 fails when required child field is missing', () => {")
                if has_deps:
                    lines.append(f"      cy.task<any>('db:populate{pascal}Dependencies').then((deps) => {{")
                lines.append(f"{I}cy.visit('/en/{parent}/new');")

                for line in gen_fill_commands(required_field_metas, title, I):
                    lines.append(line)

                child_title = test_child['names']['title']
                lines.append(f"{I}cy.clickButton('Add {child_title}');")
                lines.append(f"{I}fillDataGridRow(0, {{ {', '.join(partial_obj)} }});")
                lines.append(f"{I}cy.clickButton('Save');")
                lines.append(f"{I}cy.url().should('include', '/{parent}/new');")

                if has_deps:
                    lines.append("      });")
                lines.append("    });")

        lines.append("  });")
        lines.append('')

    # ---- 6. Fail edit ----
    if can_edit:
        lines.append("  describe('Fail edit', () => {")

        if non_autocomplete_required:
            field_to_clear = next(
                (f for f in non_autocomplete_required if f['prop_name'] == 'name'),
                non_autocomplete_required[0],
            )

            lines.append("    it('6.1 fails when required parent field is cleared', () => {")
            lines.append(f"      cy.task('db:populate{pascal}', 1);")
            lines.append(f"      cy.visit('/en/{parent}');")
            lines.append(f"      cy.contains('{title} 1').click();")
            lines.append("      cy.get('[aria-label=\"Edit\"]').click();")
            lines.append(gen_clear_command(field_to_clear, '      '))
            lines.append("      cy.clickButton('Save');")
            lines.append(f"      cy.url().should('include', '/{parent}/edit');")
            lines.append("    });")
            lines.append('')

        # 6.2 required child field cleared
        children_with_req = [c for c in datagrid_children if c['required_fields']]
        if children_with_req:
            test_child = children_with_req[0]
            child_pascal = to_pascal_case(test_child['child']['name'])
            field_to_clear = next(
                (f for f in test_child['required_fields'] if f['category'] == 'text'),
                test_child['required_fields'][0],
            )

            lines.append("    it('6.2 fails when required child field is cleared', () => {")
            lines.append(f"      cy.task<any[]>('db:populate{pascal}', 1).then((records) => {{")
            lines.append(f"        cy.task('db:populate{pascal}{child_pascal}', {{ parentId: records[0].id, length: 1 }});")
            lines.append(f"        cy.visit('/en/{parent}');")
            lines.append(f"        cy.contains('{title} 1').click();")
            lines.append("        cy.get('[aria-label=\"Edit\"]').click();")
            lines.append("        // Clear required child field")
            lines.append(f"        cy.get('div[role=\"row\"][data-rowindex=\"0\"]').find('div[data-field=\"{field_to_clear['prop_name']}\"]').dblclick();")
            lines.append(f"        cy.get('div[role=\"row\"][data-rowindex=\"0\"]').find('div[data-field=\"{field_to_clear['prop_name']}\"] input').clear().type('{{enter}}');")
            lines.append("        cy.clickButton('Save');")
            lines.append(f"        cy.url().should('include', '/{parent}/edit');")
            lines.append("      });")
            lines.append("    });")

        lines.append("  });")

    lines.append('});')
    lines.append('')

    return '\n'.join(lines)


# ---------------------------------------------------------------------------
# generateTestTasksRegistry
# ---------------------------------------------------------------------------

def generate_test_tasks_registry(entities: list, schema: dict) -> str:
    """Port of generateTestTasksRegistry().

    `entities` is a list of dicts: {parent, model_name, children}.
    """
    lines = []
    lines.append('// AUTO-GENERATED - DO NOT EDIT')
    lines.append('// Import this in cypress.config.ts and spread into on(\'task\', { ...getGeneratedTasks() })')
    lines.append('')
    lines.append('export function getGeneratedTasks() {')
    lines.append('  return {')

    for entity in entities:
        pascal = to_pascal_case(entity['parent'])
        helper_path = f'./{entity["parent"]}/helper'

        lines.append(f"    async 'db:populate{pascal}Dependencies'() {{")
        lines.append(f"      const {{ populate{pascal}Dependencies }} = require('{helper_path}');")
        lines.append(f"      return await populate{pascal}Dependencies();")
        lines.append("    },")

        lines.append(f"    async 'db:populate{pascal}'(length: number) {{")
        lines.append(f"      const {{ populate{pascal}Data }} = require('{helper_path}');")
        lines.append(f"      return await populate{pascal}Data(length);")
        lines.append("    },")

        lines.append(f"    async 'db:populate{pascal}Full'(length: number) {{")
        lines.append(f"      const {{ populate{pascal}FullData }} = require('{helper_path}');")
        lines.append(f"      return await populate{pascal}FullData(length);")
        lines.append("    },")

        child_metas = analyze_children(entity['children'], schema, entity['model_name'])
        datagrid_children = [c for c in child_metas if c['render_type'] == 'datagrid']

        for child_meta in datagrid_children:
            child_pascal = to_pascal_case(child_meta['child']['name'])
            lines.append(f"    async 'db:populate{pascal}{child_pascal}'(params: {{ parentId: string; length?: number }}) {{")
            lines.append(f"      const {{ populate{pascal}{child_pascal}Data }} = require('{helper_path}');")
            lines.append(f"      return await populate{pascal}{child_pascal}Data(params.parentId, params.length || 1);")
            lines.append("    },")

    lines.append('  };')
    lines.append('}')
    lines.append('')

    return '\n'.join(lines)


# ---------------------------------------------------------------------------
# generateApiTestSpec
# ---------------------------------------------------------------------------

def generate_api_test_spec(
    parent: str,
    children: list,
    schema: dict,
    model_name: str | None = None,
    definition_key: str | None = None,
    generate_config: dict | None = None,
) -> str:
    model = model_name or parent
    parent_pascal = to_pascal_case(parent)
    title = to_title_case(parent)
    model_def = schema['definitions'].get(model)
    if not model_def:
        return ''

    gen_cfg = generate_config or {}
    filtered_props = filter_fields(model_def.get('properties') or {}, gen_cfg.get('fields'))
    relationships = get_parent_relationships({**model_def, 'properties': filtered_props})

    required_fields_list = model_def.get('required') or []
    all_field_metas = get_field_metas(filtered_props, required_fields_list, relationships, gen_cfg.get('fields'))

    deps = resolve_dependencies(model, schema)
    entity_fk_deps = get_entity_fk_deps(model, schema, deps)
    has_deps = bool(entity_fk_deps)

    child_metas = analyze_children(children, schema, model)
    api_child_metas = [c for c in child_metas if c['render_type'] != 'file']

    # PUT body props: all filtered props except id/created_at/updated_at/creator_id
    put_body_props = [
        k for k in filtered_props
        if k not in ('id', 'created_at', 'updated_at', 'creator_id')
    ]

    def build_post_body_lines(name_val: str | None, indent: str) -> list[str]:
        out = []
        for field in all_field_metas:
            if not field['required']:
                continue
            if field['category'] == 'autocomplete':
                dep = next((d for d in entity_fk_deps if d['prop_name'] == field['prop_name']), None)
                if dep:
                    out.append(f"{indent}{field['prop_name']}: deps.{dep['dep_var_name']}.id,")
            elif field['prop_name'] == 'name':
                if name_val is not None:
                    out.append(f"{indent}name: {name_val},")
            else:
                out.append(f"{indent}{field['prop_name']}: {api_value(field, title)},")
        for c in api_child_metas:
            out.append(f"{indent}{c['child']['property_name']}: [],")
        return out

    def build_put_body_lines(name_val: str, indent: str) -> list[str]:
        out = []
        for prop in put_body_props:
            if prop == 'name':
                out.append(f"{indent}name: {name_val},")
            else:
                out.append(f"{indent}{prop}: records[0].{prop},")
        for c in api_child_metas:
            out.append(f"{indent}{c['child']['property_name']}: [],")
        return out

    lines = []
    api_path = f'/api/{parent}'

    lines.append('// AUTO-GENERATED - DO NOT EDIT')
    lines.append("import { TEST_API_KEY } from '../../support/test-credentials';")
    lines.append('')
    lines.append(f"const API_BASE = '{api_path}';")
    lines.append('')
    lines.append(f"describe('API: {title}', () => {{")
    lines.append("  beforeEach(() => {")
    lines.append("    cy.task('db:reset');")
    lines.append("    cy.task('db:seed');")
    lines.append("  });")
    lines.append('')

    # --- 1. GET list ---
    if gen_cfg.get('list', True) is not False:
        lines.append(f"  describe('GET {api_path}', () => {{")
        lines.append("    it('1.1 returns empty list when no items', () => {")
        lines.append("      cy.request({ url: API_BASE, headers: { 'X-API-Key': TEST_API_KEY } })")
        lines.append("        .then((res) => {")
        lines.append("          expect(res.status).to.eq(200);")
        lines.append("          expect(res.body).to.deep.eq([]);")
        lines.append("        });")
        lines.append("    });")
        lines.append('')
        lines.append("    it('1.2 returns list with items', () => {")
        lines.append(f"      cy.task('db:populate{parent_pascal}', 1);")
        lines.append("      cy.request({ url: API_BASE, headers: { 'X-API-Key': TEST_API_KEY } })")
        lines.append("        .then((res) => {")
        lines.append("          expect(res.status).to.eq(200);")
        lines.append("          expect(res.body).to.have.length(1);")
        lines.append("        });")
        lines.append("    });")
        lines.append("  });")
        lines.append('')

    # --- 2. GET detail ---
    if gen_cfg.get('view', True) is not False:
        lines.append(f"  describe('GET {api_path}/:id', () => {{")
        lines.append("    it('2.1 returns item detail by id', () => {")
        lines.append(f"      cy.task<any[]>('db:populate{parent_pascal}', 1).then((records) => {{")
        lines.append("        cy.request({ url: `${API_BASE}/${records[0].id}`, headers: { 'X-API-Key': TEST_API_KEY } })")
        lines.append("          .then((res) => {")
        lines.append("            expect(res.status).to.eq(200);")
        lines.append("            expect(res.body.id).to.eq(records[0].id);")
        lines.append("          });")
        lines.append("      });")
        lines.append("    });")
        lines.append('')
        lines.append("    it('2.2 returns 404 for non-existent id', () => {")
        lines.append("      cy.request({ url: `${API_BASE}/non-existent-id`, headers: { 'X-API-Key': TEST_API_KEY }, failOnStatusCode: false })")
        lines.append("        .then((res) => {")
        lines.append("          expect(res.status).to.eq(404);")
        lines.append("        });")
        lines.append("    });")
        lines.append("  });")
        lines.append('')

    # --- 3. POST create + 5.1 fail ---
    if gen_cfg.get('new', True) is not False:
        I = '        ' if has_deps else '      '
        lines.append(f"  describe('POST {api_path}', () => {{")

        # 3.1 success
        lines.append("    it('3.1 creates with required fields, verified by GET', () => {")
        if has_deps:
            lines.append(f"      cy.task<any>('db:populate{parent_pascal}Dependencies').then((deps) => {{")
        lines.append(f"{I}cy.request({{")
        lines.append(f"{I}  method: 'POST',")
        lines.append(f"{I}  url: API_BASE,")
        lines.append(f"{I}  headers: {{ 'X-API-Key': TEST_API_KEY }},")
        lines.append(f"{I}  body: {{")
        for ln in build_post_body_lines(f"'Test {title}'", f'{I}    '):
            lines.append(ln)
        lines.append(f"{I}  }},")
        lines.append(f"{I}}}).then((res) => {{")
        lines.append(f"{I}  expect(res.status).to.eq(201);")
        lines.append(f"{I}  expect(res.body.name).to.eq('Test {title}');")
        lines.append(f"{I}  cy.request({{ url: `${{API_BASE}}/${{res.body.id}}`, headers: {{ 'X-API-Key': TEST_API_KEY }} }})")
        lines.append(f"{I}    .then((getRes) => {{")
        lines.append(f"{I}      expect(getRes.status).to.eq(200);")
        lines.append(f"{I}      expect(getRes.body.name).to.eq('Test {title}');")
        lines.append(f"{I}    }});")
        lines.append(f"{I}}});")
        if has_deps:
            lines.append("      });")
        lines.append("    });")
        lines.append('')

        # 5.1 fail: missing name
        lines.append("    it('5.1 fails when required field name is missing', () => {")
        if has_deps:
            lines.append(f"      cy.task<any>('db:populate{parent_pascal}Dependencies').then((deps) => {{")
        lines.append(f"{I}cy.request({{")
        lines.append(f"{I}  method: 'POST',")
        lines.append(f"{I}  url: API_BASE,")
        lines.append(f"{I}  headers: {{ 'X-API-Key': TEST_API_KEY }},")
        lines.append(f"{I}  body: {{")
        for ln in build_post_body_lines(None, f'{I}    '):
            lines.append(ln)
        lines.append(f"{I}  }},")
        lines.append(f"{I}  failOnStatusCode: false,")
        lines.append(f"{I}}}).then((res) => {{")
        lines.append(f"{I}  expect(res.status).to.be.gte(400);")
        lines.append(f"{I}}});")
        if has_deps:
            lines.append("      });")
        lines.append("    });")
        lines.append("  });")
        lines.append('')

    # --- 4.1 PUT update ---
    if gen_cfg.get('edit', True) is not False:
        lines.append(f"  describe('PUT {api_path}/:id', () => {{")
        lines.append("    it('4.1 updates, verified by GET', () => {")
        lines.append(f"      cy.task<any[]>('db:populate{parent_pascal}', 1).then((records) => {{")
        lines.append("        cy.request({")
        lines.append("          method: 'PUT',")
        lines.append("          url: `${API_BASE}/${records[0].id}`,")
        lines.append("          headers: { 'X-API-Key': TEST_API_KEY },")
        lines.append("          body: {")
        for ln in build_put_body_lines(f"'Updated {title}'", '            '):
            lines.append(ln)
        lines.append("          },")
        lines.append("        }).then((res) => {")
        lines.append("          expect(res.status).to.eq(200);")
        lines.append("          cy.request({ url: `${API_BASE}/${records[0].id}`, headers: { 'X-API-Key': TEST_API_KEY } })")
        lines.append("            .then((getRes) => {")
        lines.append("              expect(getRes.status).to.eq(200);")
        lines.append(f"              expect(getRes.body.name).to.eq('Updated {title}');")
        lines.append("            });")
        lines.append("        });")
        lines.append("      });")
        lines.append("    });")
        lines.append("  });")
        lines.append('')

    # --- 4.2 DELETE ---
    if gen_cfg.get('delete', True) is not False:
        lines.append(f"  describe('DELETE {api_path}/:id', () => {{")
        lines.append("    it('4.2 deletes item, verified by GET returning 404', () => {")
        lines.append(f"      cy.task<any[]>('db:populate{parent_pascal}', 1).then((records) => {{")
        lines.append("        cy.request({")
        lines.append("          method: 'DELETE',")
        lines.append("          url: `${API_BASE}/${records[0].id}`,")
        lines.append("          headers: { 'X-API-Key': TEST_API_KEY },")
        lines.append("        }).then((res) => {")
        lines.append("          expect(res.status).to.eq(204);")
        lines.append("          cy.request({ url: `${API_BASE}/${records[0].id}`, headers: { 'X-API-Key': TEST_API_KEY }, failOnStatusCode: false })")
        lines.append("            .then((getRes) => {")
        lines.append("              expect(getRes.status).to.eq(404);")
        lines.append("            });")
        lines.append("        });")
        lines.append("      });")
        lines.append("    });")
        lines.append("  });")
        lines.append('')

    # --- 6. Auth errors ---
    lines.append("  describe('Authentication errors', () => {")
    lines.append("    it('6.1 returns 401 without API key', () => {")
    lines.append("      cy.request({ url: API_BASE, failOnStatusCode: false })")
    lines.append("        .then((res) => {")
    lines.append("          expect(res.status).to.eq(401);")
    lines.append("        });")
    lines.append("    });")
    lines.append('')
    lines.append("    it('6.2 returns 401 with invalid API key', () => {")
    lines.append("      cy.request({ url: API_BASE, headers: { 'X-API-Key': 'invalid_key' }, failOnStatusCode: false })")
    lines.append("        .then((res) => {")
    lines.append("          expect(res.status).to.eq(401);")
    lines.append("        });")
    lines.append("    });")
    lines.append("  });")
    lines.append('')

    # --- 7. Permission errors ---
    lines.append("  describe('Permission errors', () => {")
    lines.append("    it('7.1 returns 403 for GET list when permission denied', () => {")
    lines.append(f"      cy.task<string>('db:createLimitedApiUser', '{model}').then((limitedKey) => {{")
    lines.append("        cy.request({ url: API_BASE, headers: { 'X-API-Key': limitedKey }, failOnStatusCode: false })")
    lines.append("          .then((res) => {")
    lines.append("            expect(res.status).to.eq(403);")
    lines.append("          });")
    lines.append("      });")
    lines.append("    });")

    if gen_cfg.get('new', True) is not False:
        I7 = '        ' if has_deps else '      '
        lines.append('')
        lines.append("    it('7.2 returns 403 for POST when permission denied', () => {")
        if has_deps:
            lines.append(f"      cy.task<any>('db:populate{parent_pascal}Dependencies').then((deps) => {{")
        lines.append(f"{I7}cy.task<string>('db:createLimitedApiUser', '{model}').then((limitedKey) => {{")
        lines.append(f"{I7}  cy.request({{")
        lines.append(f"{I7}    method: 'POST',")
        lines.append(f"{I7}    url: API_BASE,")
        lines.append(f"{I7}    headers: {{ 'X-API-Key': limitedKey }},")
        lines.append(f"{I7}    body: {{")
        for ln in build_post_body_lines(f"'Test {title}'", f'{I7}      '):
            lines.append(ln)
        lines.append(f"{I7}    }},")
        lines.append(f"{I7}    failOnStatusCode: false,")
        lines.append(f"{I7}  }}).then((res) => {{")
        lines.append(f"{I7}    expect(res.status).to.eq(403);")
        lines.append(f"{I7}  }});")
        lines.append(f"{I7}}});")
        if has_deps:
            lines.append("      });")
        lines.append("    });")

    lines.append("  });")
    lines.append('});')
    lines.append('')

    return '\n'.join(lines)
