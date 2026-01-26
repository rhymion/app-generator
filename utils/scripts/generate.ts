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

function extractEntities(schema: Schema): { parent: string; child: string } | null {
  const defs = Object.keys(schema.definitions);
  
  // Find parent entity (should have basic properties)
  const parent = defs.find(def => 
    !def.endsWith('_detail') && 
    !def.endsWith('_input') &&
    schema.definitions[def].properties?.id &&
    schema.definitions[def].properties?.name
  );
  
  if (!parent) return null;
  
  // Find detail entity
  const detailKey = defs.find(def => def.endsWith('_detail'));
  if (!detailKey) return null;
  
  const detailDef = schema.definitions[detailKey];
  
  // Get properties - support both allOf style and explicit properties
  let properties = detailDef.properties;
  
  if (!properties && detailDef.allOf) {
    // New style using allOf - find the object with properties
    const propsObj = detailDef.allOf.find((item: any) => item.properties);
    if (propsObj) {
      properties = propsObj.properties;
    }
  }
  
  if (!properties) return null;
  
  // Find child entity from the detail properties (array of refs)
  const arrayProp = Object.entries(properties).find(([key, prop]) => 
    (prop as any).type === 'array' && (prop as any).items?.$ref
  );
  
  if (!arrayProp) return null;
  
  // Extract child entity name from the $ref (e.g., "#/definitions/yyyyy_yyyyy")
  const ref = (arrayProp[1] as any).items.$ref as string;
  const child = ref.split('/').pop();
  
  if (!child) return null;
  
  return { parent, child };
}

function generate(inputPath: string, outputDir: string) {
  const schema = parseSchema(inputPath);
  const entities = extractEntities(schema);
  
  if (!entities) {
    console.error('Could not extract entities from schema');
    return;
  }
  
  const { parent, child } = entities;
  
  console.log(`Generating code for parent: ${parent}, child: ${child}`);
  
  // Create directories
  const libDir = path.join(outputDir, 'lib', parent);
  const componentsDir = path.join(outputDir, 'components', parent);
  const appDir = path.join(outputDir, 'app', parent);
  
  fs.mkdirSync(libDir, { recursive: true });
  fs.mkdirSync(componentsDir, { recursive: true });
  fs.mkdirSync(appDir, { recursive: true });
  fs.mkdirSync(path.join(appDir, 'new'), { recursive: true });
  fs.mkdirSync(path.join(appDir, 'edit', '[id]'), { recursive: true });
  fs.mkdirSync(path.join(appDir, 'view', '[id]'), { recursive: true });
  
  // Generate files
  fs.writeFileSync(path.join(libDir, 'types.ts'), generateTypes(parent, child, schema));
  fs.writeFileSync(path.join(libDir, 'getters.ts'), generateGetters(parent, child, schema));
  fs.writeFileSync(path.join(libDir, 'actions.ts'), generateActions(parent, child, schema));
  
  fs.writeFileSync(path.join(componentsDir, 'column_def.tsx'), generateColumnDef(parent, child, schema));
  fs.writeFileSync(path.join(componentsDir, 'FormUpsert.tsx'), generateFormUpsert(parent, child, schema));
  fs.writeFileSync(path.join(componentsDir, 'FormView.tsx'), generateFormView(parent, child, schema));
  
  fs.writeFileSync(path.join(appDir, 'page.tsx'), generatePageList(parent));
  fs.writeFileSync(path.join(appDir, 'new', 'page.tsx'), generatePageNew(parent, child, schema));
  fs.writeFileSync(path.join(appDir, 'edit', '[id]', 'page.tsx'), generatePageEdit(parent));
  fs.writeFileSync(path.join(appDir, 'view', '[id]', 'page.tsx'), generatePageView(parent));
  
  console.log('Code generation complete!');
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
