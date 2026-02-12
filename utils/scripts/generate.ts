import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import type { Schema } from './types';
import {
  generateTypes,
  generateGetters,
  generateActions,
  generateColumnDef,
  generateFormUpsert,
  generateFormView,
  generatePageList,
  generatePageNew,
  generatePageEdit,
  generatePageView,
  generateService,
  generateApiRoute,
  generateApiDetailRoute,
} from './templates';

function parseSchema(filePath: string): Schema {
  const content = fs.readFileSync(filePath, 'utf8');
  return yaml.load(content) as Schema;
}

interface EntityRelation {
  parent: string;           // entityName — for file paths, routes, function names
  modelName: string;        // DB model — for Prisma queries, permissions, schema lookup
  definitionKey: string;    // original schema key — for looking up children/relationships
  children: Array<{
    name: string;
    propertyName: string;
    outputType?: string;
    relationship?: {
      type: 'many-to-many' | 'one-to-many';
      target: string;
    };
  }>;
  generateConfig: {
    list: boolean;
    view: boolean;
    new: boolean;
    edit: boolean;
    delete: boolean;
    api: boolean;
    fields?: string[];
  };
}

function extractChildren(def: any, schema: Schema, defKey: string) {
  const children: Array<{ name: string; propertyName: string; outputType?: string;
    relationship?: { type: 'many-to-many' | 'one-to-many'; target: string } }> = [];

  // Get properties - support both allOf style and explicit properties
  let properties = def.properties;
  if (!properties && def.allOf) {
    const propsObj = def.allOf.find((item: any) => item.properties);
    if (propsObj) {
      properties = propsObj.properties;
    }
  }

  // Get x-relationships if defined
  const xRelationships = (def as any)?.['x-relationships'] || {};

  if (properties) {
    for (const [propName, prop] of Object.entries(properties)) {
      const propAny = prop as any;
      if (propAny.type === 'array' && propAny.items?.$ref) {
        const ref = propAny.items.$ref as string;
        const childName = ref.split('/').pop();
        if (childName) {
          const outputType = propAny['x-outputType'] || propAny.outputType;
          let relationship = undefined;
          if (xRelationships[propName]) {
            const relInfo = xRelationships[propName];
            relationship = {
              type: relInfo.type as 'many-to-many' | 'one-to-many',
              target: relInfo.target || childName,
            };
          }
          children.push({ name: childName, propertyName: propName, outputType, relationship });
        }
      }
    }
  }
  return children;
}

function extractEntities(schema: Schema): EntityRelation[] {
  const defs = Object.keys(schema.definitions);
  const results: EntityRelation[] = [];

  // Step 1: Identify base models (definitions with id + name, not suffixed)
  const baseModels = new Set(defs.filter(def =>
    !def.endsWith('_detail') &&
    !def.endsWith('_input') &&
    schema.definitions[def].properties?.id &&
    schema.definitions[def].properties?.name
  ));

  // Step 2: Find all code-generation targets (definitions with x-generate)
  const allChildren = new Set<string>();
  const childToParents = new Map<string, string[]>();

  for (const defKey of defs) {
    const def = schema.definitions[defKey];

    // Resolve modelName from allOf $ref to a base model
    let modelName: string | null = null;
    if (def.allOf) {
      const refItem = def.allOf.find((item: any) => item.$ref);
      if (refItem?.$ref) {
        const refTarget = refItem.$ref.split('/').pop()!;
        if (baseModels.has(refTarget)) {
          modelName = refTarget;
        }
      }
    }

    // Get x-generate config: from this definition, or from the base model for _detail
    const xGenerate = (def as any)?.['x-generate']
      || (defKey.endsWith('_detail') && modelName ? (schema.definitions[modelName] as any)?.['x-generate'] : null)
      || (baseModels.has(defKey) ? (schema.definitions[defKey] as any)?.['x-generate'] : null);

    if (!xGenerate) continue;

    // Must have allOf $ref to a base model, OR be a base model itself
    if (!modelName && !baseModels.has(defKey)) continue;

    // Derive entityName
    let entityName: string;
    if (defKey.endsWith('_detail')) {
      entityName = defKey.replace(/_detail$/, ''); // backward compat
    } else {
      entityName = defKey;
    }

    // If no modelName resolved (base model with x-generate directly), model = entity
    if (!modelName) {
      modelName = entityName;
    }

    // Extract children from allOf properties
    const children = extractChildren(def, schema, defKey);

    // Track children for many-to-many detection (use modelName as the "parent identity")
    for (const child of children) {
      allChildren.add(child.name);
      if (!childToParents.has(child.name)) {
        childToParents.set(child.name, []);
      }
      childToParents.get(child.name)!.push(modelName);
    }

    const generateConfig = {
      list: xGenerate.list !== false,
      view: xGenerate.view !== false,
      new: xGenerate.new !== false,
      edit: xGenerate.edit !== false,
      delete: xGenerate.delete !== false,
      api: xGenerate.api === true,
      fields: xGenerate.fields as string[] | undefined,
    };

    results.push({ parent: entityName, modelName, definitionKey: defKey, children, generateConfig });
  }

  // Step 3: Detect many-to-many relationships
  const manyToManyPairs = new Set<string>();
  for (const [child, parentsList] of childToParents) {
    for (const parentModel of parentsList) {
      const childParents = childToParents.get(parentModel) || [];
      if (childParents.includes(child)) {
        const pair = [parentModel, child].sort().join('<->');
        manyToManyPairs.add(pair);
      }
    }
  }

  // Step 4: Filter out entities that are ONLY children (not in many-to-many)
  return results.filter(r => {
    if (!allChildren.has(r.modelName)) {
      return true;
    }

    for (const pair of manyToManyPairs) {
      if (pair.includes(r.modelName)) {
        console.log(`  Many-to-many detected: ${pair}`);
        return true;
      }
    }

    return false;
  });
}

function generate(inputPath: string, outputDir: string) {
  const schema = parseSchema(inputPath);
  const entityRelations = extractEntities(schema);
  
  if (entityRelations.length === 0) {
    console.error('Could not extract any entities from schema');
    return;
  }
  
  console.log(`Found ${entityRelations.length} parent entity(ies)`);
  
  for (const { parent, modelName, definitionKey, children, generateConfig } of entityRelations) {
    console.log(`\nGenerating code for parent: ${parent}${modelName !== parent ? ` (model: ${modelName})` : ''}`);
    console.log(`  Generate config: list=${generateConfig.list}, view=${generateConfig.view}, new=${generateConfig.new}, edit=${generateConfig.edit}, delete=${generateConfig.delete}, api=${generateConfig.api}${generateConfig.fields ? `, fields=[${generateConfig.fields.join(',')}]` : ''}`);

    if (children.length === 0) {
      console.log(`  No children (parent-only case)`);
    } else {
      console.log(`  Children: ${children.map(c => `${c.name} (${c.propertyName})`).join(', ')}`);
    }

    // For backward compatibility, use first child if exists
    const primaryChild = children.length > 0 ? children[0].name : '';
    const hasChildren = children.length > 0;

    // Create directories
    const libDir = path.join(outputDir, 'lib', parent);
    const componentsDir = path.join(outputDir, 'components', parent);
    const appDir = path.join(outputDir, 'app', parent);

    fs.mkdirSync(libDir, { recursive: true });
    fs.mkdirSync(componentsDir, { recursive: true });

    // Generate files - pass modelName and definitionKey for multi-interface support
    fs.writeFileSync(path.join(libDir, 'types.ts'), generateTypes(parent, children, schema, modelName, definitionKey, generateConfig));

    // Always generate getters (needed by pages, API routes, and edit/new access checks)
    fs.writeFileSync(path.join(libDir, 'getters.ts'), generateGetters(parent, children, schema, generateConfig, modelName, definitionKey));

    // Generate service layer (shared DB operations for actions and API routes)
    if (generateConfig.new || generateConfig.edit || generateConfig.delete) {
      fs.writeFileSync(path.join(libDir, 'service.ts'), generateService(parent, children, schema, generateConfig, modelName));
    }

    // Generate actions only if new, edit, or delete is enabled
    if (generateConfig.new || generateConfig.edit || generateConfig.delete) {
      fs.writeFileSync(path.join(libDir, 'actions.ts'), generateActions(parent, children, schema, generateConfig, modelName));
    }

    // Generate API routes if api is enabled (each file only if it has at least one method)
    if (generateConfig.api) {
      const apiDir = path.join(outputDir, 'app', 'api', parent);
      if (generateConfig.list || generateConfig.new) {
        fs.mkdirSync(apiDir, { recursive: true });
        fs.writeFileSync(path.join(apiDir, 'route.ts'), generateApiRoute(parent, children, schema, generateConfig, modelName));
      }
      if (generateConfig.view || generateConfig.edit || generateConfig.delete) {
        fs.mkdirSync(apiDir, { recursive: true });
        fs.mkdirSync(path.join(apiDir, '[id]'), { recursive: true });
        fs.writeFileSync(path.join(apiDir, '[id]', 'route.ts'), generateApiDetailRoute(parent, children, schema, generateConfig, modelName));
      }
      console.log(`  API routes generated at app/api/${parent}/`);
    }

    // Generate column_def only if there are children and list is enabled
    if (hasChildren && generateConfig.list) {
      fs.writeFileSync(path.join(componentsDir, 'column_def.tsx'), generateColumnDef(parent, children, schema, modelName, definitionKey));
    }

    // Generate FormUpsert only if new or edit is enabled
    if (generateConfig.new || generateConfig.edit) {
      fs.writeFileSync(path.join(componentsDir, 'FormUpsert.tsx'), generateFormUpsert(parent, children, schema, generateConfig, modelName, definitionKey));
    }

    // Generate FormView only if view is enabled
    if (generateConfig.view) {
      fs.writeFileSync(path.join(componentsDir, 'FormView.tsx'), generateFormView(parent, children, schema, generateConfig, modelName, definitionKey));
    }

    // Conditionally generate pages based on config
    if (generateConfig.list) {
      fs.mkdirSync(appDir, { recursive: true });
      fs.writeFileSync(path.join(appDir, 'page.tsx'), generatePageList(parent, schema, generateConfig, modelName));
    }

    if (generateConfig.new) {
      fs.mkdirSync(path.join(appDir, 'new'), { recursive: true });
      fs.writeFileSync(path.join(appDir, 'new', 'page.tsx'), generatePageNew(parent, children, schema, modelName, definitionKey));
    }

    if (generateConfig.edit) {
      fs.mkdirSync(path.join(appDir, 'edit', '[id]'), { recursive: true });
      fs.writeFileSync(path.join(appDir, 'edit', '[id]', 'page.tsx'), generatePageEdit(parent, children, schema, modelName, definitionKey));
    }

    if (generateConfig.view) {
      fs.mkdirSync(path.join(appDir, 'view', '[id]'), { recursive: true });
      fs.writeFileSync(path.join(appDir, 'view', '[id]', 'page.tsx'), generatePageView(parent, modelName));
    }
  }
  
  console.log('\nCode generation complete!');
}

// CLI usage
const isMainModule = process.argv[1] === new URL(import.meta.url).pathname;

if (isMainModule) {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.log('Usage: ts-node generate.ts <schema-file> <output-dir>');
    console.log('Example: ts-node generate.ts json_schema_db_table.yaml ../../');
    process.exit(1);
  }
  
  const [schemaFile, outputDir] = args;
  generate(schemaFile, outputDir);
}

export { generate };
