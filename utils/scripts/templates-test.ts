/**
 * Cypress E2E test code generation templates
 *
 * Generates:
 * - Test helper files (cypress/support/{entity}/helper.ts) for data population
 * - Test spec files (cypress/e2e/{entity}.cy.ts) with comprehensive test cases
 * - Task registry (cypress/support/generated-tasks.ts) for cypress.config.ts integration
 */

import type { Schema, SchemaProperty } from './types';
import type { ChildInfo } from './helpers/child-helpers';
import type { ParentRelationshipMeta } from './helpers/schema-helpers';
import { toCamelCase, toPascalCase, toTitleCase } from './helpers/naming';
import { getParentRelationships, filterFields } from './helpers/schema-helpers';
import { getChildNames } from './helpers/child-helpers';

// ========================================
// Internal Types
// ========================================

interface GenerateConfig {
  list: boolean;
  view: boolean;
  new: boolean;
  edit: boolean;
  delete: boolean;
  api: boolean;
  test: boolean;
  fields?: string[];
}

interface DependencyStep {
  target: string;
  varName: string;
  fkDeps: { propName: string; depVarName: string }[];
}

interface FieldMeta {
  propName: string;
  label: string;
  category: 'text' | 'number' | 'datetime' | 'boolean' | 'autocomplete';
  required: boolean;
  enumValues?: string[];
  format?: string;
  depTarget?: string;
  min?: number;
  max?: number;
}

type ChildRenderType = 'datagrid' | 'editable-list-autocomplete' | 'editable-list-text' | 'file';

interface ChildMeta {
  child: ChildInfo;
  names: ReturnType<typeof getChildNames>;
  renderType: ChildRenderType;
  fields: FieldMeta[];
  requiredFields: FieldMeta[];
  optionalFields: FieldMeta[];
  parentFkProp: string; // FK property name back to parent (e.g., 'xxxxx_xxxxx_id')
}

// ========================================
// Dependency Resolution
// ========================================

function resolveDependencies(modelName: string, schema: Schema): DependencyStep[] {
  const visited = new Set<string>();
  const result: DependencyStep[] = [];

  function resolve(model: string) {
    if (visited.has(model)) return;
    visited.add(model);

    const modelDef = schema.definitions[model];
    if (!modelDef?.properties) return;

    const rels = getParentRelationships(modelDef);
    const relevantRels = rels.filter(r =>
      r.target !== 'user_account' &&
      r.target !== model &&
      r.propName !== 'updater_id' &&
      r.propName !== 'assignee_id'
    );

    for (const rel of relevantRels) {
      resolve(rel.target);
    }

    if (model !== modelName && !result.some(d => d.target === model)) {
      const fkDeps = relevantRels
        .filter(r => result.some(d => d.target === r.target))
        .map(r => ({ propName: r.propName, depVarName: toCamelCase(r.target) }));

      result.push({ target: model, varName: toCamelCase(model), fkDeps });
    }
  }

  resolve(modelName);
  return result;
}

/** Get the FK relationships of the entity itself (not transitive deps) */
function getEntityFkDeps(modelName: string, schema: Schema, deps: DependencyStep[]): { propName: string; depVarName: string }[] {
  const modelDef = schema.definitions[modelName];
  if (!modelDef) return [];

  const rels = getParentRelationships(modelDef);
  return rels
    .filter(r =>
      r.target !== 'user_account' &&
      r.target !== modelName &&
      r.propName !== 'updater_id' &&
      r.propName !== 'assignee_id'
    )
    .filter(r => deps.some(d => d.target === r.target))
    .map(r => ({ propName: r.propName, depVarName: toCamelCase(r.target) }));
}

// ========================================
// Field Analysis
// ========================================

function getFieldMetas(
  properties: Record<string, SchemaProperty>,
  requiredFields: string[],
  relationships: ParentRelationshipMeta[],
  fieldsFilter?: string[]
): FieldMeta[] {
  const filtered = filterFields(properties, fieldsFilter);
  const excludeKeys = new Set(['id', 'created_at', 'updated_at', 'creator_id', 'updater_id']);
  const metas: FieldMeta[] = [];

  for (const [propName, prop] of Object.entries(filtered)) {
    if (excludeKeys.has(propName)) continue;

    const rel = relationships.find(r => r.propName === propName);
    if (rel) {
      // Skip self-referential and user_account FKs
      if (rel.target === 'user_account') continue;
      metas.push({
        propName,
        label: toTitleCase(propName.replace(/_id$/, '')),
        category: 'autocomplete',
        required: requiredFields.includes(propName),
        depTarget: rel.target,
      });
      continue;
    }

    const propType = Array.isArray(prop.type) ? prop.type.find(t => t !== 'null') : prop.type;
    const format = (prop as any).format;

    if (propType === 'string' && format === 'uri') {
      // Image URL field - skip (file upload)
      continue;
    } else if (propType === 'string' && (format === 'date' || format === 'date-time' || format === 'time')) {
      metas.push({ propName, label: toTitleCase(propName), category: 'datetime', required: requiredFields.includes(propName), format });
    } else if (propType === 'integer' || propType === 'number') {
      const min = prop.minimum;
      const max = (prop as any).maximum;
      metas.push({ propName, label: toTitleCase(propName), category: 'number', required: requiredFields.includes(propName), min, max });
    } else if (propType === 'boolean') {
      metas.push({ propName, label: toTitleCase(propName), category: 'boolean', required: requiredFields.includes(propName) });
    } else {
      metas.push({ propName, label: toTitleCase(propName), category: 'text', required: requiredFields.includes(propName), enumValues: prop.enum });
    }
  }

  return metas;
}

function getChildRenderType(child: ChildInfo): ChildRenderType {
  if (child.fileType) return 'file';
  if (child.relationship?.type === 'many-to-many') return 'editable-list-autocomplete';
  if (child.outputType === 'list') return 'editable-list-text';
  return 'datagrid';
}

function analyzeChildren(
  children: ChildInfo[],
  schema: Schema,
  parentModelName: string
): ChildMeta[] {
  return children
    .map(child => {
      const renderType = getChildRenderType(child);
      if (renderType === 'file') return null; // Skip file children

      const childDef = schema.definitions[child.name];
      if (!childDef?.properties) return null;

      const names = getChildNames(child);
      const childRequired = childDef.required || [];

      // Find FK property back to parent
      const parentFkProp = `${parentModelName}_id`;

      // For DataGrid children, get editable field metas
      const childRels = getParentRelationships(childDef);
      const excludeKeys = new Set(['id', parentFkProp, 'order']);
      const childProperties: Record<string, SchemaProperty> = {};
      for (const [k, v] of Object.entries(childDef.properties)) {
        if (!excludeKeys.has(k)) childProperties[k] = v;
      }

      const fields = getFieldMetas(childProperties, childRequired, childRels);

      return {
        child,
        names,
        renderType,
        fields,
        requiredFields: fields.filter(f => f.required),
        optionalFields: fields.filter(f => !f.required),
        parentFkProp,
      } as ChildMeta;
    })
    .filter((c): c is ChildMeta => c !== null);
}

// ========================================
// Test Data Values
// ========================================

function prismaValue(field: FieldMeta, index: string, entityTitle: string): string {
  switch (field.category) {
    case 'text':
      if (field.propName === 'name') return `\`${entityTitle} \${${index}}\``;
      if (field.enumValues?.length) return `'${field.enumValues[0]}'`;
      return `\`Test ${field.label} \${${index}}\``;
    case 'number': {
      const val = `${index} * 100`;
      if (field.min !== undefined && field.max !== undefined) {
        return `Math.min(${field.max}, Math.max(${field.min}, ${val}))`;
      }
      if (field.min !== undefined) return `Math.max(${field.min}, ${val})`;
      return val;
    }
    case 'boolean':
      return `${index} % 2 === 0`;
    case 'datetime':
      if (field.format === 'date') return `new Date(2025, 0, ${index}).toISOString()`;
      if (field.propName.includes('end') || field.propName.includes('logout') || field.propName.includes('finish')) {
        return `new Date(2025, 0, ${index}, 17, 0).toISOString()`;
      }
      return `new Date(2025, 0, ${index}, 9, 0).toISOString()`;
    case 'autocomplete':
      return ''; // Handled via dependencies
  }
}

function cypressCreateValue(field: FieldMeta, entityTitle: string): string {
  switch (field.category) {
    case 'text':
      if (field.propName === 'name') return `Test ${entityTitle}`;
      if (field.enumValues?.length) return field.enumValues[0];
      return `Test ${field.label}`;
    case 'number': {
      let val = 100;
      if (field.min !== undefined) val = Math.max(field.min, val);
      if (field.max !== undefined) val = Math.min(field.max, val);
      return String(val);
    }
    case 'boolean':
      return 'true';
    case 'datetime':
      if (field.format === 'date') return '01/15/2025';
      if (field.propName.includes('end') || field.propName.includes('logout') || field.propName.includes('finish')) {
        return '01/15/2025 05:00 PM';
      }
      return '01/15/2025 09:00 AM';
    case 'autocomplete':
      return ''; // Handled via dependencies
  }
}

function cypressEditValue(field: FieldMeta, entityTitle: string): string {
  switch (field.category) {
    case 'text':
      if (field.propName === 'name') return `Updated ${entityTitle}`;
      if (field.enumValues?.length) return field.enumValues[field.enumValues.length > 1 ? 1 : 0];
      return `Updated ${field.label}`;
    case 'number': {
      let val = 200;
      if (field.min !== undefined) val = Math.max(field.min, val);
      if (field.max !== undefined) val = Math.min(field.max, val);
      return String(val);
    }
    case 'boolean':
      return 'false';
    case 'datetime':
      if (field.format === 'date') return '06/15/2025';
      if (field.propName.includes('end') || field.propName.includes('logout') || field.propName.includes('finish')) {
        return '06/15/2025 06:00 PM';
      }
      return '06/15/2025 02:00 PM';
    case 'autocomplete':
      return '';
  }
}

// ========================================
// Cypress Command Generation
// ========================================

function genFillCommand(field: FieldMeta, value: string, indent: string): string {
  switch (field.category) {
    case 'text':
    case 'number':
      return `${indent}cy.fillField('${field.label}', '${value}');`;
    case 'datetime':
      return `${indent}cy.fillDateTime('${field.label}', '${value}');`;
    case 'boolean':
      return `${indent}cy.setCheckbox('${field.label}', ${value});`;
    case 'autocomplete':
      return `${indent}cy.selectAutocomplete('${field.label}', '${value}');`;
  }
}

function genClearAndFillCommand(field: FieldMeta, value: string, indent: string): string {
  switch (field.category) {
    case 'text':
    case 'number':
      return `${indent}cy.clearAndFillField('${field.label}', '${value}');`;
    case 'datetime':
      return `${indent}cy.fillDateTime('${field.label}', '${value}');`;
    case 'boolean':
      return `${indent}cy.setCheckbox('${field.label}', ${value});`;
    case 'autocomplete':
      return `${indent}cy.selectAutocomplete('${field.label}', '${value}');`;
  }
}

function genClearCommand(field: FieldMeta, indent: string): string {
  switch (field.category) {
    case 'text':
    case 'number':
      return `${indent}cy.clearField('${field.label}');`;
    case 'datetime':
      return `${indent}cy.clearDateTime('${field.label}');`;
    case 'boolean':
      return `${indent}cy.setCheckbox('${field.label}', false);`;
    case 'autocomplete':
      return `${indent}cy.clearAutocomplete('${field.label}');`;
  }
}

function genAssertCommand(field: FieldMeta, value: string, indent: string): string {
  switch (field.category) {
    case 'text':
    case 'number':
    case 'datetime':
    case 'autocomplete':
      return `${indent}cy.checkField('${field.label}', '${value}');`;
    case 'boolean':
      return `${indent}cy.setCheckbox('${field.label}', ${value}); // verify checkbox state`;
  }
}

/** Generate fill commands for a set of fields */
function genFillCommands(fields: FieldMeta[], entityTitle: string, indent: string, deps?: DependencyStep[]): string[] {
  const lines: string[] = [];
  for (const field of fields) {
    if (field.category === 'autocomplete') {
      const depTarget = field.depTarget;
      if (depTarget) {
        const depVarName = toCamelCase(depTarget);
        lines.push(`${indent}cy.selectAutocomplete('${field.label}', deps.${depVarName}.name);`);
      }
    } else {
      const value = cypressCreateValue(field, entityTitle);
      lines.push(genFillCommand(field, value, indent));
    }
  }
  return lines;
}

/** Generate assert commands for view page verification */
function genAssertCommands(fields: FieldMeta[], entityTitle: string, indent: string): string[] {
  const lines: string[] = [];
  for (const field of fields) {
    if (field.category === 'autocomplete') {
      const depTarget = field.depTarget;
      if (depTarget) {
        const depTitle = toTitleCase(depTarget);
        lines.push(`${indent}cy.checkField('${field.label}', 'Test ${depTitle}');`);
      }
    } else {
      const value = cypressCreateValue(field, entityTitle);
      lines.push(genAssertCommand(field, value, indent));
    }
  }
  return lines;
}

// ========================================
// Child DataGrid Helpers
// ========================================

function genChildDataGridObject(childMeta: ChildMeta, action: 'create' | 'edit'): string {
  const fields = action === 'create' ? childMeta.requiredFields : childMeta.fields;
  const entries: string[] = [];
  for (const field of fields) {
    let value: string;
    if (action === 'create') {
      value = cypressCreateValue(field, childMeta.names.title);
    } else {
      value = cypressEditValue(field, childMeta.names.title);
    }
    if (field.category === 'boolean') {
      entries.push(`${field.propName}: ${value}`);
    } else if (field.category === 'number') {
      entries.push(`${field.propName}: ${value}`);
    } else {
      entries.push(`${field.propName}: '${value}'`);
    }
  }
  return `{ ${entries.join(', ')} }`;
}

function genChildFullDataGridObject(childMeta: ChildMeta): string {
  const entries: string[] = [];
  for (const field of childMeta.fields) {
    const value = cypressCreateValue(field, childMeta.names.title);
    if (field.category === 'boolean') {
      entries.push(`${field.propName}: ${value}`);
    } else if (field.category === 'number') {
      entries.push(`${field.propName}: ${value}`);
    } else {
      entries.push(`${field.propName}: '${value}'`);
    }
  }
  return `{ ${entries.join(', ')} }`;
}

// ========================================
// generateTestHelper
// ========================================

export function generateTestHelper(
  parent: string,
  children: ChildInfo[],
  schema: Schema,
  modelName: string,
  definitionKey: string,
  generateConfig: GenerateConfig
): string {
  const parentDef = schema.definitions[modelName];
  if (!parentDef?.properties) return '// No properties found for entity\n';

  const title = toTitleCase(parent);
  const pascal = toPascalCase(parent);
  const properties = filterFields(parentDef.properties, generateConfig.fields);
  const requiredFields = parentDef.required || [];
  const relationships = getParentRelationships(parentDef);
  const fields = getFieldMetas(properties, requiredFields, relationships, generateConfig.fields);
  const deps = resolveDependencies(modelName, schema);
  const entityFkDeps = getEntityFkDeps(modelName, schema, deps);

  const requiredFieldMetas = fields.filter(f => f.required);
  const optionalFieldMetas = fields.filter(f => !f.required);

  const childMetas = analyzeChildren(children, schema, modelName);
  const dataGridChildren = childMetas.filter(c => c.renderType === 'datagrid');

  const lines: string[] = [];

  // Header
  lines.push(`// AUTO-GENERATED - DO NOT EDIT`);
  lines.push(`import { prisma } from '../db-helpers';`);
  lines.push(`import { TEST_CREDENTIALS } from '../test-credentials';`);
  lines.push('');

  // getTestUser helper
  lines.push(`async function getTestUser() {`);
  lines.push(`  const testUser = await prisma.user_account.findUnique({`);
  lines.push(`    where: { email: TEST_CREDENTIALS.email },`);
  lines.push(`  });`);
  lines.push(`  if (!testUser) throw new Error('Test user not found. Make sure db:seed has run first.');`);
  lines.push(`  return testUser;`);
  lines.push(`}`);
  lines.push('');

  // populateDependencies
  lines.push(`export async function populate${pascal}Dependencies() {`);
  if (deps.length === 0) {
    lines.push(`  return {};`);
  } else {
    lines.push(`  const testUser = await getTestUser();`);
    for (const dep of deps) {
      const depDef = schema.definitions[dep.target + "_detail"];
      const depTitle = toTitleCase(dep.target);
      const dataFields: string[] = [`name: 'Test ${depTitle}'`];
      for (const fk of dep.fkDeps) {
        dataFields.push(`${fk.propName}: ${fk.depVarName}.id`);
      }
      dataFields.push(`creator_id: testUser.id`);
      dataFields.push(`updater_id: testUser.id`);
      if (depDef['x-relationships']?.user_accounts?.target === 'user_account') {
        dataFields.push(`
      user_accounts: {
        connect: [testUser.id].map((id) => ({ id }))
      }
   `);
      }

      lines.push(`  const ${dep.varName} = await prisma.${dep.target}.create({`);
      lines.push(`    data: { ${dataFields.join(', ')} },`);
      lines.push(`  });`);
    }
    const returnObj = deps.map(d => d.varName).join(', ');
    lines.push(`  return { ${returnObj} };`);
  }
  lines.push(`}`);
  lines.push('');

  // populateData (required fields only)
  lines.push(`export async function populate${pascal}Data(length: number) {`);
  lines.push(`  const testUser = await getTestUser();`);
  if (deps.length > 0) {
    lines.push(`  const deps = await populate${pascal}Dependencies();`);
  }
  lines.push(`  const records = [];`);
  lines.push(`  for (let i = 1; i <= length; i++) {`);
  lines.push(`    const record = await prisma.${modelName}.create({`);
  lines.push(`      data: {`);

  // Required fields
  for (const field of requiredFieldMetas) {
    if (field.category === 'autocomplete') {
      const dep = entityFkDeps.find(d => d.propName === field.propName);
      if (dep) {
        lines.push(`        ${field.propName}: deps.${dep.depVarName}.id,`);
      }
    } else {
      lines.push(`        ${field.propName}: ${prismaValue(field, 'i', title)},`);
    }
  }
  lines.push(`        creator_id: testUser.id,`);
  lines.push(`        updater_id: testUser.id,`);
  lines.push(`      },`);
  lines.push(`    });`);
  lines.push(`    records.push(record);`);
  lines.push(`  }`);
  lines.push(`  return records;`);
  lines.push(`}`);
  lines.push('');

  // populateFullData (all fields)
  if (optionalFieldMetas.length > 0) {
    lines.push(`export async function populate${pascal}FullData(length: number) {`);
    lines.push(`  const testUser = await getTestUser();`);
    if (deps.length > 0) {
      lines.push(`  const deps = await populate${pascal}Dependencies();`);
    }
    lines.push(`  const records = [];`);
    lines.push(`  for (let i = 1; i <= length; i++) {`);
    lines.push(`    const record = await prisma.${modelName}.create({`);
    lines.push(`      data: {`);

    for (const field of fields) {
      if (field.category === 'autocomplete') {
        const dep = entityFkDeps.find(d => d.propName === field.propName);
        if (dep) {
          lines.push(`        ${field.propName}: deps.${dep.depVarName}.id,`);
        }
      } else {
        lines.push(`        ${field.propName}: ${prismaValue(field, 'i', title)},`);
      }
    }
    lines.push(`        creator_id: testUser.id,`);
    lines.push(`        updater_id: testUser.id,`);
    lines.push(`      },`);
    lines.push(`    });`);
    lines.push(`    records.push(record);`);
    lines.push(`  }`);
    lines.push(`  return records;`);
    lines.push(`}`);
    lines.push('');
  } else {
    // No optional fields, FullData is same as Data
    lines.push(`export const populate${pascal}FullData = populate${pascal}Data;`);
    lines.push('');
  }

  // Child populate functions (for one-to-many DataGrid children)
  for (const childMeta of dataGridChildren) {
    const childPascal = toPascalCase(childMeta.child.name);
    const childTitle = toTitleCase(childMeta.child.name);
    const childDef = schema.definitions[childMeta.child.name];
    const childRequired = childDef?.required || [];

    lines.push(`export async function populate${pascal}${childPascal}Data(parentId: string, length: number) {`);
    lines.push(`  const records = [];`);
    lines.push(`  for (let i = 1; i <= length; i++) {`);
    lines.push(`    const record = await prisma.${childMeta.child.name}.create({`);
    lines.push(`      data: {`);
    lines.push(`        ${childMeta.parentFkProp}: parentId,`);

    // Check if child has order field
    if (childDef?.properties?.order) {
      lines.push(`        order: i,`);
    }

    for (const field of childMeta.fields) {
      lines.push(`        ${field.propName}: ${prismaValue(field, 'i', childTitle)},`);
    }

    lines.push(`      },`);
    lines.push(`    });`);
    lines.push(`    records.push(record);`);
    lines.push(`  }`);
    lines.push(`  return records;`);
    lines.push(`}`);
    lines.push('');
  }

  return lines.join('\n') + '\n';
}

// ========================================
// generateTestSpec
// ========================================

export function generateTestSpec(
  parent: string,
  children: ChildInfo[],
  schema: Schema,
  modelName: string,
  definitionKey: string,
  generateConfig: GenerateConfig
): string {
  const parentDef = schema.definitions[modelName];
  if (!parentDef?.properties) return '// No properties found for entity\n';

  const title = toTitleCase(parent);
  const pascal = toPascalCase(parent);
  const properties = filterFields(parentDef.properties, generateConfig.fields);
  const requiredFields = parentDef.required || [];
  const relationships = getParentRelationships(parentDef);
  const fields = getFieldMetas(properties, requiredFields, relationships, generateConfig.fields);
  const deps = resolveDependencies(modelName, schema);
  const hasDeps = deps.length > 0;

  const requiredFieldMetas = fields.filter(f => f.required);
  const optionalFieldMetas = fields.filter(f => !f.required);
  const nonAutocompletRequired = requiredFieldMetas.filter(f => f.category !== 'autocomplete');

  const childMetas = analyzeChildren(children, schema, modelName);
  const dataGridChildren = childMetas.filter(c => c.renderType === 'datagrid');
  const listChildren = childMetas.filter(c => c.renderType === 'editable-list-text' || c.renderType === 'editable-list-autocomplete');
  const hasChildren = childMetas.length > 0;
  const hasDataGridChildren = dataGridChildren.length > 0;

  // Determine indent for tests with dependencies (wrapped in .then)
  const I = hasDeps ? '        ' : '      '; // indent inside .then vs direct
  const hasOptional = optionalFieldMetas.length > 0;

  const lines: string[] = [];

  // Imports
  lines.push(`// AUTO-GENERATED - DO NOT EDIT`);
  lines.push(`import { TEST_CREDENTIALS } from '../support/test-credentials';`);
  if (hasDataGridChildren) {
    lines.push(`import { fillDataGridRow, assertDataGridEmpty, getDataGridRowCount, assertDataGridRowData } from '../support/datagrid-helpers';`);
  } else {
    lines.push(`import { assertDataGridEmpty, getDataGridRowCount } from '../support/datagrid-helpers';`);
  }
  lines.push('');

  // Main describe
  lines.push(`describe('Testing ${title} pages and their behavior', () => {`);

  // beforeEach
  lines.push(`  beforeEach(() => {`);
  lines.push(`    cy.task('db:reset');`);
  lines.push(`    cy.task('db:seed');`);
  lines.push(`    Cypress.session.clearAllSavedSessions();`);
  lines.push(`    cy.clearCookies();`);
  lines.push(`    cy.clearLocalStorage();`);
  lines.push(`    cy.visit('/');`);
  lines.push(`    cy.window().then((win) => { win.sessionStorage.clear(); });`);
  lines.push(`    cy.login(TEST_CREDENTIALS.email, TEST_CREDENTIALS.password);`);
  lines.push(`  });`);
  lines.push('');

  // ---- 1. Display list ----
  if (generateConfig.list) {
    lines.push(`  describe('Display list', () => {`);

    // 1.1 Empty state
    lines.push(`    it('1.1 shows empty state with no items', () => {`);
    lines.push(`      cy.visit('/${parent}');`);
    lines.push(`      assertDataGridEmpty();`);
    lines.push(`    });`);
    lines.push('');

    // 1.2 One item
    lines.push(`    it('1.2 shows list with one item', () => {`);
    lines.push(`      cy.task('db:populate${pascal}', 1);`);
    lines.push(`      cy.visit('/${parent}');`);
    lines.push(`      cy.contains('${title} 1').should('be.visible');`);
    lines.push(`      getDataGridRowCount().should('eq', 1);`);
    lines.push(`    });`);
    lines.push('');

    // 1.3 Multiple items
    lines.push(`    it('1.3 shows list with multiple items', () => {`);
    lines.push(`      cy.task('db:populate${pascal}', 3);`);
    lines.push(`      cy.visit('/${parent}');`);
    lines.push(`      cy.contains('${title} 1').should('be.visible');`);
    lines.push(`      getDataGridRowCount().should('eq', 3);`);
    lines.push(`    });`);

    lines.push(`  });`);
    lines.push('');
  }

  // ---- 2. Create ----
  if (generateConfig.new) {
    lines.push(`  describe('Create', () => {`);

    // 2.1 Create with minimal data
    lines.push(`    it('2.1 creates with minimal data (required fields only)', () => {`);
    if (hasDeps) {
      lines.push(`      cy.task<any>('db:populate${pascal}Dependencies').then((deps) => {`);
    }
    lines.push(`${I}cy.visit('/${parent}');`);
    lines.push(`${I}cy.clickButton('Create New ${title}');`);

    // Fill required fields
    for (const line of genFillCommands(requiredFieldMetas, title, I, deps)) {
      lines.push(line);
    }

    // For DataGrid children that are required in the detail, add minimal rows
    const detailDef = schema.definitions[definitionKey];
    const detailRequired = detailDef?.required || [];
    if (detailDef?.allOf) {
      const allOfReq = detailDef.allOf.find((item: any) => item.required);
      if (allOfReq?.required) {
        detailRequired.push(...allOfReq.required);
      }
    }

    for (const childMeta of dataGridChildren) {
      if (detailRequired.includes(childMeta.child.propertyName)) {
        lines.push(`${I}// Add required child: ${childMeta.names.title}`);
        lines.push(`${I}cy.clickButton('Add ${childMeta.names.title}');`);
        lines.push(`${I}fillDataGridRow(0, ${genChildDataGridObject(childMeta, 'create')});`);
      }
    }

    lines.push(`${I}cy.clickButton('Save');`);
    lines.push(`${I}cy.url().should('include', '/${parent}');`);
    lines.push(`${I}cy.contains('Test ${title}').should('be.visible');`);

    // Navigate to view page and verify
    if (generateConfig.view) {
      lines.push(`${I}// Verify on view page`);
      lines.push(`${I}cy.contains('Test ${title}').click();`);
      lines.push(`${I}cy.url().should('include', '/${parent}/view');`);
      for (const line of genAssertCommands(requiredFieldMetas.filter(f => f.category !== 'boolean'), title, I)) {
        lines.push(line);
      }
    }

    if (hasDeps) {
      lines.push(`      });`);
    }
    lines.push(`    });`);
    lines.push('');

    // 2.2 Create with full data
    lines.push(`    it('2.2 creates with full data (all fields and children)', () => {`);
    if (hasDeps) {
      lines.push(`      cy.task<any>('db:populate${pascal}Dependencies').then((deps) => {`);
    }

    // For m2m children, need to populate target entities
    for (const childMeta of listChildren) {
      if (childMeta.renderType === 'editable-list-autocomplete' && childMeta.child.relationship?.target) {
        const target = childMeta.child.relationship.target;
        if (target !== modelName) {  // skip self-referential
          const targetPascal = toPascalCase(target);
          lines.push(`${I}cy.task('db:populate${targetPascal}', 2);`);
        }
      }
    }

    lines.push(`${I}cy.visit('/${parent}');`);
    lines.push(`${I}cy.clickButton('Create New ${title}');`);

    // Fill ALL fields (required + optional)
    for (const line of genFillCommands(fields, title, I, deps)) {
      lines.push(line);
    }

    // Add DataGrid children with full data
    for (const childMeta of dataGridChildren) {
      lines.push(`${I}// Add child: ${childMeta.names.title}`);
      lines.push(`${I}cy.clickButton('Add ${childMeta.names.title}');`);
      lines.push(`${I}fillDataGridRow(0, ${genChildFullDataGridObject(childMeta)});`);
    }

    // Add list children
    for (const childMeta of listChildren) {
      if (childMeta.renderType === 'editable-list-text') {
        lines.push(`${I}// Add list item: ${childMeta.names.title}`);
        lines.push(`${I}cy.clickButton('Add ${childMeta.names.singularPascalName}');`);
        lines.push(`${I}cy.get('div[role="dialog"]').find('input').type('Test ${childMeta.names.title} Item');`);
        lines.push(`${I}cy.get('div[role="dialog"]').find('button').contains('Add').click();`);
      } else if (childMeta.renderType === 'editable-list-autocomplete' && childMeta.child.relationship?.target) {
        const targetTitle = toTitleCase(childMeta.child.relationship.target);
        lines.push(`${I}// Add list item: ${childMeta.names.title}`);
        lines.push(`${I}cy.clickButton('Add ${childMeta.names.singularPascalName}');`);
        lines.push(`${I}cy.get('div[role="dialog"]').find('input').type('${targetTitle} 1');`);
        lines.push(`${I}cy.get('.MuiAutocomplete-popper li').contains('${targetTitle} 1').click();`);
        lines.push(`${I}cy.get('div[role="dialog"]').find('button').contains('Add').click();`);
      }
    }

    lines.push(`${I}cy.clickButton('Save');`);
    lines.push(`${I}cy.url().should('include', '/${parent}');`);
    lines.push(`${I}cy.contains('Test ${title}').should('be.visible');`);

    if (generateConfig.view) {
      lines.push(`${I}// Verify on view page`);
      lines.push(`${I}cy.contains('Test ${title}').click();`);
      lines.push(`${I}cy.url().should('include', '/${parent}/view');`);
      for (const line of genAssertCommands(fields.filter(f => f.category !== 'boolean'), title, I)) {
        lines.push(line);
      }
    }

    if (hasDeps) {
      lines.push(`      });`);
    }
    lines.push(`    });`);

    lines.push(`  });`);
    lines.push('');
  }

  // ---- 3. Edit ----
  if (generateConfig.edit) {
    lines.push(`  describe('Edit', () => {`);

    // 3.1 Add optional data
    if (hasOptional || hasChildren) {
      lines.push(`    it('3.1 adds optional data and child items', () => {`);
      lines.push(`      cy.task<any[]>('db:populate${pascal}', 1).then((records) => {`);

      // For m2m children, populate targets
      for (const childMeta of listChildren) {
        if (childMeta.renderType === 'editable-list-autocomplete' && childMeta.child.relationship?.target) {
          const target = childMeta.child.relationship.target;
          if (target !== modelName) {
            const targetPascal = toPascalCase(target);
            lines.push(`        cy.task('db:populate${targetPascal}', 2);`);
          }
        }
      }

      lines.push(`        cy.visit('/${parent}');`);
      lines.push(`        cy.contains('${title} 1').click();`);
      lines.push(`        cy.contains('Edit').click();`);
      lines.push(`        cy.url().should('include', '/${parent}/edit');`);

      // Fill optional fields
      for (const field of optionalFieldMetas) {
        if (field.category === 'autocomplete') {
          const depTarget = field.depTarget;
          if (depTarget) {
            // Optional autocomplete - need dependency populated
            // Skip if dep not populated
          }
        } else {
          const value = cypressCreateValue(field, title);
          lines.push(genFillCommand(field, value, '        '));
        }
      }

      // Add DataGrid children
      for (const childMeta of dataGridChildren) {
        lines.push(`        // Add child: ${childMeta.names.title}`);
        lines.push(`        cy.clickButton('Add ${childMeta.names.title}');`);
        lines.push(`        fillDataGridRow(0, ${genChildDataGridObject(childMeta, 'create')});`);
      }

      // Add list children
      for (const childMeta of listChildren) {
        if (childMeta.renderType === 'editable-list-text') {
          lines.push(`        cy.clickButton('Add ${childMeta.names.singularPascalName}');`);
          lines.push(`        cy.get('div[role="dialog"]').find('input').type('Test ${childMeta.names.title} Item');`);
          lines.push(`        cy.get('div[role="dialog"]').find('button').contains('Add').click();`);
        } else if (childMeta.renderType === 'editable-list-autocomplete' && childMeta.child.relationship?.target) {
          const targetTitle = toTitleCase(childMeta.child.relationship.target);
          lines.push(`        cy.clickButton('Add ${childMeta.names.singularPascalName}');`);
          lines.push(`        cy.get('div[role="dialog"]').find('input').type('${targetTitle} 1');`);
          lines.push(`        cy.get('.MuiAutocomplete-popper li').contains('${targetTitle} 1').click();`);
          lines.push(`        cy.get('div[role="dialog"]').find('button').contains('Add').click();`);
        }
      }

      lines.push(`        cy.clickButton('Save');`);
      lines.push(`        cy.url().should('include', '/${parent}');`);
      lines.push(`        cy.contains('${title} 1').should('be.visible');`);

      if (generateConfig.view) {
        lines.push(`        // Verify on view page`);
        lines.push(`        cy.contains('${title} 1').click();`);
        lines.push(`        cy.url().should('include', '/${parent}/view');`);
        lines.push(`        cy.checkField('Name', '${title} 1');`);
      }

      lines.push(`      });`);
      lines.push(`    });`);
      lines.push('');
    }

    // 3.2 Remove optional data
    if (hasOptional || hasChildren) {
      lines.push(`    it('3.2 removes optional data and child items', () => {`);
      if (optionalFieldMetas.length > 0) {
        lines.push(`      cy.task<any[]>('db:populate${pascal}Full', 1).then((records) => {`);
      } else {
        lines.push(`      cy.task<any[]>('db:populate${pascal}', 1).then((records) => {`);
      }

      // Populate children
      for (const childMeta of dataGridChildren) {
        const childPascal = toPascalCase(childMeta.child.name);
        lines.push(`        cy.task('db:populate${pascal}${childPascal}', { parentId: records[0].id, length: 1 });`);
      }

      lines.push(`        cy.visit('/${parent}');`);
      lines.push(`        cy.contains('${title} 1').click();`);
      lines.push(`        cy.contains('Edit').click();`);
      lines.push(`        cy.url().should('include', '/${parent}/edit');`);

      // Clear optional fields
      for (const field of optionalFieldMetas) {
        if (field.category !== 'autocomplete') {
          lines.push(genClearCommand(field, '        '));
        }
      }

      // Delete DataGrid children
      for (const childMeta of dataGridChildren) {
        lines.push(`        // Delete child: ${childMeta.names.title}`);
        lines.push(`        cy.selectDataGridRows([0]);`);
        lines.push(`        cy.clickButton('Delete Selected');`);
        lines.push(`        cy.get('div[role="dialog"]').find('button').contains('Delete').click();`);
      }

      lines.push(`        cy.clickButton('Save');`);
      lines.push(`        cy.url().should('include', '/${parent}');`);
      lines.push(`        cy.contains('${title} 1').should('be.visible');`);

      lines.push(`      });`);
      lines.push(`    });`);
      lines.push('');
    }

    // 3.3 Mixed changes
    lines.push(`    it('3.3 edits with mixed changes', () => {`);
    lines.push(`      cy.task<any[]>('db:populate${pascal}', 1).then((records) => {`);
    lines.push(`        cy.visit('/${parent}');`);
    lines.push(`        cy.contains('${title} 1').click();`);
    lines.push(`        cy.contains('Edit').click();`);

    // Change name
    lines.push(`        cy.clearAndFillField('Name', 'Updated ${title}');`);

    // Add first optional field if any
    if (optionalFieldMetas.length > 0) {
      const firstOpt = optionalFieldMetas[0];
      if (firstOpt.category !== 'autocomplete') {
        const value = cypressEditValue(firstOpt, title);
        lines.push(genFillCommand(firstOpt, value, '        '));
      }
    }

    lines.push(`        cy.clickButton('Save');`);
    lines.push(`        cy.url().should('include', '/${parent}');`);
    lines.push(`        cy.contains('Updated ${title}').should('be.visible');`);

    if (generateConfig.view) {
      lines.push(`        // Verify on view page`);
      lines.push(`        cy.contains('Updated ${title}').click();`);
      lines.push(`        cy.url().should('include', '/${parent}/view');`);
      lines.push(`        cy.checkField('Name', 'Updated ${title}');`);
    }

    lines.push(`      });`);
    lines.push(`    });`);

    lines.push(`  });`);
    lines.push('');
  }

  // ---- 4. Delete ----
  if (generateConfig.delete) {
    lines.push(`  describe('Delete', () => {`);

    // 4.1 Delete single from list
    if (generateConfig.list) {
      lines.push(`    it('4.1 deletes a single item from list view', () => {`);
      lines.push(`      cy.task('db:populate${pascal}', 2);`);
      lines.push(`      cy.visit('/${parent}');`);
      lines.push(`      cy.selectDataGridRows([0]);`);
      lines.push(`      cy.clickButton('Delete Selected');`);
      lines.push(`      cy.get('div[role="dialog"]').find('button').contains('Delete').click();`);
      lines.push(`      getDataGridRowCount().should('eq', 1);`);
      lines.push(`    });`);
      lines.push('');

      // 4.2 Delete multiple from list
      lines.push(`    it('4.2 deletes multiple items from list view', () => {`);
      lines.push(`      cy.task('db:populate${pascal}', 3);`);
      lines.push(`      cy.visit('/${parent}');`);
      lines.push(`      cy.selectDataGridRows([0, 1]);`);
      lines.push(`      cy.clickButton('Delete Selected');`);
      lines.push(`      cy.get('div[role="dialog"]').find('button').contains('Delete').click();`);
      lines.push(`      getDataGridRowCount().should('eq', 1);`);
      lines.push(`    });`);
      lines.push('');
    }

    // 4.3 Delete from edit page
    if (generateConfig.edit) {
      lines.push(`    it('4.3 deletes an item from edit page', () => {`);
      lines.push(`      cy.task('db:populate${pascal}', 1);`);
      lines.push(`      cy.visit('/${parent}');`);
      lines.push(`      cy.contains('${title} 1').click();`);
      lines.push(`      cy.contains('Edit').click();`);
      lines.push(`      cy.url().should('include', '/${parent}/edit');`);
      lines.push(`      cy.clickButton('Delete ${title}');`);
      lines.push(`      cy.get('div[role="dialog"]').find('button').contains('Delete').click();`);
      lines.push(`      cy.url().should('include', '/${parent}');`);
      lines.push(`      cy.contains('${title} 1').should('not.exist');`);
      lines.push(`    });`);
    }

    lines.push(`  });`);
    lines.push('');
  }

  // ---- 5. Fail create ----
  if (generateConfig.new) {
    lines.push(`  describe('Fail create', () => {`);

    // 5.1 Required parent field missing
    if (nonAutocompletRequired.length > 0) {
      // Find a required text field to skip (prefer name)
      const fieldToSkip = nonAutocompletRequired.find(f => f.propName === 'name') || nonAutocompletRequired[0];
      const fieldsToFill = requiredFieldMetas.filter(f => f.propName !== fieldToSkip.propName);

      lines.push(`    it('5.1 fails when required parent field is missing', () => {`);
      if (hasDeps) {
        lines.push(`      cy.task<any>('db:populate${pascal}Dependencies').then((deps) => {`);
      }
      lines.push(`${I}cy.visit('/${parent}/new');`);

      // Fill all required fields EXCEPT the one to skip
      for (const line of genFillCommands(fieldsToFill, title, I, deps)) {
        lines.push(line);
      }

      lines.push(`${I}cy.clickButton('Save');`);
      lines.push(`${I}cy.url().should('include', '/${parent}/new');`);

      if (hasDeps) {
        lines.push(`      });`);
      }
      lines.push(`    });`);
      lines.push('');
    }

    // 5.2 Required child field missing (only if has children with required fields)
    const childrenWithRequired = dataGridChildren.filter(c => c.requiredFields.length > 0);
    if (childrenWithRequired.length > 0) {
      const testChild = childrenWithRequired[0];
      // Create a data object with one required field missing
      const reqChildFields = testChild.requiredFields;
      if (reqChildFields.length > 1) {
        const skipField = reqChildFields[reqChildFields.length - 1]; // Skip last required
        const partialFields = reqChildFields.filter(f => f.propName !== skipField.propName);
        const partialObj: string[] = [];
        for (const field of partialFields) {
          const value = cypressCreateValue(field, testChild.names.title);
          if (field.category === 'boolean') {
            partialObj.push(`${field.propName}: ${value}`);
          } else if (field.category === 'number') {
            partialObj.push(`${field.propName}: ${value}`);
          } else {
            partialObj.push(`${field.propName}: '${value}'`);
          }
        }

        lines.push(`    it('5.2 fails when required child field is missing', () => {`);
        if (hasDeps) {
          lines.push(`      cy.task<any>('db:populate${pascal}Dependencies').then((deps) => {`);
        }
        lines.push(`${I}cy.visit('/${parent}/new');`);

        // Fill required parent fields
        for (const line of genFillCommands(requiredFieldMetas, title, I, deps)) {
          lines.push(line);
        }

        // Add child row with missing required field
        lines.push(`${I}cy.clickButton('Add ${testChild.names.title}');`);
        lines.push(`${I}fillDataGridRow(0, { ${partialObj.join(', ')} });`);

        lines.push(`${I}cy.clickButton('Save');`);
        lines.push(`${I}cy.url().should('include', '/${parent}/new');`);

        if (hasDeps) {
          lines.push(`      });`);
        }
        lines.push(`    });`);
      }
    }

    lines.push(`  });`);
    lines.push('');
  }

  // ---- 6. Fail edit ----
  if (generateConfig.edit) {
    lines.push(`  describe('Fail edit', () => {`);

    // 6.1 Required parent field cleared
    if (nonAutocompletRequired.length > 0) {
      const fieldToClear = nonAutocompletRequired.find(f => f.propName === 'name') || nonAutocompletRequired[0];

      lines.push(`    it('6.1 fails when required parent field is cleared', () => {`);
      lines.push(`      cy.task('db:populate${pascal}', 1);`);
      lines.push(`      cy.visit('/${parent}');`);
      lines.push(`      cy.contains('${title} 1').click();`);
      lines.push(`      cy.contains('Edit').click();`);
      lines.push(genClearCommand(fieldToClear, '      '));
      lines.push(`      cy.clickButton('Save');`);
      lines.push(`      cy.url().should('include', '/${parent}/edit');`);
      lines.push(`    });`);
      lines.push('');
    }

    // 6.2 Required child field cleared
    if (dataGridChildren.some(c => c.requiredFields.length > 0)) {
      const testChild = dataGridChildren.find(c => c.requiredFields.length > 0)!;
      const childPascal = toPascalCase(testChild.child.name);
      const fieldToClear = testChild.requiredFields.find(f => f.category === 'text') || testChild.requiredFields[0];

      lines.push(`    it('6.2 fails when required child field is cleared', () => {`);
      lines.push(`      cy.task<any[]>('db:populate${pascal}', 1).then((records) => {`);
      lines.push(`        cy.task('db:populate${pascal}${childPascal}', { parentId: records[0].id, length: 1 });`);
      lines.push(`        cy.visit('/${parent}');`);
      lines.push(`        cy.contains('${title} 1').click();`);
      lines.push(`        cy.contains('Edit').click();`);
      lines.push(`        // Clear required child field`);

      // For DataGrid, we need to double-click the cell and clear it
      lines.push(`        cy.get('div[role="row"][data-rowindex="0"]').find('div[data-field="${fieldToClear.propName}"]').dblclick();`);
      lines.push(`        cy.get('div[role="row"][data-rowindex="0"]').find('div[data-field="${fieldToClear.propName}"] input').clear().type('{enter}');`);

      lines.push(`        cy.clickButton('Save');`);
      lines.push(`        cy.url().should('include', '/${parent}/edit');`);
      lines.push(`      });`);
      lines.push(`    });`);
    }

    lines.push(`  });`);
  }

  lines.push(`});`);
  lines.push('');

  return lines.join('\n');
}

// ========================================
// generateTestTasksRegistry
// ========================================

interface EntityInfo {
  parent: string;
  modelName: string;
  children: ChildInfo[];
}

export function generateTestTasksRegistry(entities: EntityInfo[], schema: Schema): string {
  const lines: string[] = [];

  lines.push(`// AUTO-GENERATED - DO NOT EDIT`);
  lines.push(`// Import this in cypress.config.ts and spread into on('task', { ...getGeneratedTasks() })`);
  lines.push('');
  lines.push(`export function getGeneratedTasks() {`);
  lines.push(`  return {`);

  for (const entity of entities) {
    const pascal = toPascalCase(entity.parent);
    const helperPath = `./${entity.parent}/helper`;

    // Dependencies task
    lines.push(`    async 'db:populate${pascal}Dependencies'() {`);
    lines.push(`      const { populate${pascal}Dependencies } = require('${helperPath}');`);
    lines.push(`      return await populate${pascal}Dependencies();`);
    lines.push(`    },`);

    // Data task
    lines.push(`    async 'db:populate${pascal}'(length: number) {`);
    lines.push(`      const { populate${pascal}Data } = require('${helperPath}');`);
    lines.push(`      return await populate${pascal}Data(length);`);
    lines.push(`    },`);

    // Full data task
    lines.push(`    async 'db:populate${pascal}Full'(length: number) {`);
    lines.push(`      const { populate${pascal}FullData } = require('${helperPath}');`);
    lines.push(`      return await populate${pascal}FullData(length);`);
    lines.push(`    },`);

    // Child data tasks (for one-to-many DataGrid children only)
    const childMetas = analyzeChildren(entity.children, schema, entity.modelName);
    const dataGridChildren = childMetas.filter(c => c.renderType === 'datagrid');

    for (const childMeta of dataGridChildren) {
      const childPascal = toPascalCase(childMeta.child.name);
      lines.push(`    async 'db:populate${pascal}${childPascal}'(params: { parentId: string; length?: number }) {`);
      lines.push(`      const { populate${pascal}${childPascal}Data } = require('${helperPath}');`);
      lines.push(`      return await populate${pascal}${childPascal}Data(params.parentId, params.length || 1);`);
      lines.push(`    },`);
    }
  }

  lines.push(`  };`);
  lines.push(`}`);
  lines.push('');

  return lines.join('\n');
}
