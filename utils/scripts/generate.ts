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
} from './templates';

function parseSchema(filePath: string): Schema {
  const content = fs.readFileSync(filePath, 'utf8');
  return yaml.load(content) as Schema;
}

interface EntityRelation {
  parent: string;
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
  };
}

function extractEntities(schema: Schema): EntityRelation[] {
  const defs = Object.keys(schema.definitions);
  const results: EntityRelation[] = [];
  
  // Find all parent entities (should have basic properties)
  const parents = defs.filter(def => 
    !def.endsWith('_detail') && 
    !def.endsWith('_input') &&
    schema.definitions[def].properties?.id &&
    schema.definitions[def].properties?.name
  );
  
  // Collect all child entity names and track relationships
  const allChildren = new Set<string>();
  const childToParents = new Map<string, string[]>();
  
  for (const parent of parents) {
    const children: Array<{ name: string; propertyName: string; outputType?: string; 
      relationship?: { type: 'many-to-many' | 'one-to-many'; target: string } }> = [];
    
    // Find detail entity for this parent
    const detailKey = `${parent}_detail`;
    const detailDef = schema.definitions[detailKey];
    
    if (detailDef) {
      // Get properties - support both allOf style and explicit properties
      let properties = detailDef.properties;
      
      if (!properties && detailDef.allOf) {
        // New style using allOf - find the object with properties
        const propsObj = detailDef.allOf.find((item: any) => item.properties);
        if (propsObj) {
          properties = propsObj.properties;
        }
      }
      
      // Get x-relationships if defined
      const xRelationships = (detailDef as any)?.['x-relationships'] || {};
      
      if (properties) {
        // Find all child entities from array properties with $ref
        for (const [propName, prop] of Object.entries(properties)) {
          const propAny = prop as any;
          if (propAny.type === 'array' && propAny.items?.$ref) {
            // Extract child entity name from the $ref (e.g., "#/definitions/yyyyy_yyyyy")
            const ref = propAny.items.$ref as string;
            const childName = ref.split('/').pop();
            if (childName) {
              // Check for x-outputType custom property
              const outputType = propAny['x-outputType'] || propAny.outputType;
              
              // Check for x-relationships to determine relationship type
              let relationship = undefined;
              if (xRelationships[propName]) {
                const relInfo = xRelationships[propName];
                relationship = {
                  type: relInfo.type as 'many-to-many' | 'one-to-many',
                  target: relInfo.target || childName,
                };
              }
              
              children.push({ name: childName, propertyName: propName, outputType, relationship });
              allChildren.add(childName);
              
              // Track parent-child relationships
              if (!childToParents.has(childName)) {
                childToParents.set(childName, []);
              }
              childToParents.get(childName)!.push(parent);
            }
          }
        }
      }
    }
    
    // Extract x-generate configuration from detail definition
    const xGenerate = (detailDef as any)?.['x-generate'] || {};
    const generateConfig = {
      list: xGenerate.list !== false,
      view: xGenerate.view !== false,
      new: xGenerate.new !== false,
      edit: xGenerate.edit !== false,
      delete: xGenerate.delete !== false,
    };
    
    results.push({ parent, children, generateConfig });
  }
  
  // Detect many-to-many relationships: A references B AND B references A
  const manyToManyPairs = new Set<string>();
  for (const [child, parentsList] of childToParents) {
    for (const parent of parentsList) {
      // Check if parent also appears as a child of this child
      const childParents = childToParents.get(parent) || [];
      if (childParents.includes(child)) {
        // Many-to-many relationship detected
        const pair = [parent, child].sort().join('<->');
        manyToManyPairs.add(pair);
      }
    }
  }
  
  // Filter out entities that are ONLY children (not in many-to-many)
  return results.filter(r => {
    if (!allChildren.has(r.parent)) {
      // Not a child of anyone, include it
      return true;
    }
    
    // Check if this parent is part of a many-to-many relationship
    for (const pair of manyToManyPairs) {
      if (pair.includes(r.parent)) {
        console.log(`  Many-to-many detected: ${pair}`);
        return true; // Include entities in many-to-many relationships
      }
    }
    
    // This is a pure child entity, exclude it
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
  
  for (const { parent, children, generateConfig } of entityRelations) {
    console.log(`\nGenerating code for parent: ${parent}`);
    console.log(`  Generate config: list=${generateConfig.list}, view=${generateConfig.view}, new=${generateConfig.new}, edit=${generateConfig.edit}, delete=${generateConfig.delete}`);
    
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
    
    // Generate files - pass full children array to support multiple children
    fs.writeFileSync(path.join(libDir, 'types.ts'), generateTypes(parent, children, schema));
    
    // Generate getters only if list or view is enabled
    if (generateConfig.list || generateConfig.view) {
      fs.writeFileSync(path.join(libDir, 'getters.ts'), generateGetters(parent, children, schema, generateConfig));
    }
    
    // Generate actions only if new, edit, or delete is enabled
    if (generateConfig.new || generateConfig.edit || generateConfig.delete) {
      fs.writeFileSync(path.join(libDir, 'actions.ts'), generateActions(parent, children, schema, generateConfig));
    }
    
    // Generate column_def only if there are children and list is enabled
    if (hasChildren && generateConfig.list) {
      fs.writeFileSync(path.join(componentsDir, 'column_def.tsx'), generateColumnDef(parent, children, schema));
    }
    
    // Generate FormUpsert only if new or edit is enabled
    if (generateConfig.new || generateConfig.edit) {
      fs.writeFileSync(path.join(componentsDir, 'FormUpsert.tsx'), generateFormUpsert(parent, children, schema, generateConfig));
    }
    
    // Generate FormView only if view is enabled
    if (generateConfig.view) {
      fs.writeFileSync(path.join(componentsDir, 'FormView.tsx'), generateFormView(parent, children, schema));
    }
    
    // Conditionally generate pages based on config
    if (generateConfig.list) {
      fs.mkdirSync(appDir, { recursive: true });
      fs.writeFileSync(path.join(appDir, 'page.tsx'), generatePageList(parent));
    }
    
    if (generateConfig.new) {
      fs.mkdirSync(path.join(appDir, 'new'), { recursive: true });
      fs.writeFileSync(path.join(appDir, 'new', 'page.tsx'), generatePageNew(parent, children, schema));
    }
    
    if (generateConfig.edit) {
      fs.mkdirSync(path.join(appDir, 'edit', '[id]'), { recursive: true });
      fs.writeFileSync(path.join(appDir, 'edit', '[id]', 'page.tsx'), generatePageEdit(parent, children));
    }
    
    if (generateConfig.view) {
      fs.mkdirSync(path.join(appDir, 'view', '[id]'), { recursive: true });
      fs.writeFileSync(path.join(appDir, 'view', '[id]', 'page.tsx'), generatePageView(parent));
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
