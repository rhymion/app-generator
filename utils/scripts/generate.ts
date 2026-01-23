import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';

interface SchemaProperty {
  type: string | string[];
  description?: string;
  pattern?: string;
  minLength?: number;
  minimum?: number;
  default?: any;
  enum?: string[];
  items?: any;
  $ref?: string;
}

interface SchemaDefinition {
  type: string;
  title: string;
  description: string;
  required: string[];
  properties: Record<string, SchemaProperty>;
}

interface Schema {
  $schema: string;
  title: string;
  description: string;
  definitions: Record<string, SchemaDefinition>;
}

function parseSchema(filePath: string): Schema {
  const content = fs.readFileSync(filePath, 'utf8');
  return yaml.load(content) as Schema;
}

function toSnakeCase(str: string): string {
  return str.replace(/([A-Z])/g, '_$1').toLowerCase().replace(/^_/, '');
}

function toCamelCase(str: string): string {
  return str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
}

function toPascalCase(str: string): string {
  const camel = toCamelCase(str);
  return camel.charAt(0).toUpperCase() + camel.slice(1);
}

function extractEntities(schema: Schema): { parent: string; child: string } | null {
  const defs = Object.keys(schema.definitions);
  
  // Find parent entity (should have basic properties)
  const parent = defs.find(def => 
    !def.endsWith('_detail') && 
    !def.endsWith('_input') &&
    schema.definitions[def].properties.id &&
    schema.definitions[def].properties.name
  );
  
  if (!parent) return null;
  
  // Find detail entity
  const detailKey = defs.find(def => def.endsWith('_detail'));
  if (!detailKey) return null;
  
  const detailDef = schema.definitions[detailKey];
  
  // Find child entity from the detail properties (array of refs)
  const arrayProp = Object.entries(detailDef.properties).find(([key, prop]) => 
    prop.type === 'array' && prop.items?.$ref
  );
  
  if (!arrayProp) return null;
  
  const childRef = arrayProp[0]; // The property name itself is the child entity
  
  return { parent, child: childRef };
}

function getTsType(prop: SchemaProperty): string {
  if (Array.isArray(prop.type)) {
    // Union type for nullable
    return prop.type.map(t => t === 'null' ? 'null' : mapJsonTypeToTs(t)).join(' | ');
  }
  
  if (prop.type === 'array') {
    return 'any[]'; // Simplified
  }
  
  return mapJsonTypeToTs(prop.type);
}

function mapJsonTypeToTs(type: string): string {
  switch (type) {
    case 'string': return 'string';
    case 'integer': return 'number';
    case 'number': return 'number';
    case 'boolean': return 'boolean';
    case 'null': return 'null';
    default: return 'any';
  }
}

function generateTypes(parent: string, child: string, schema: Schema): string {
  const parentPascal = toPascalCase(parent);
  const childPascal = toPascalCase(child);
  const childCamel = toCamelCase(child);
  
  const parentDef = schema.definitions[parent];
  const childDef = schema.definitions[child];
  
  const parentProps: string[] = [];
  const childProps: string[] = [];
  
  // Generate parent type
  for (const [key, prop] of Object.entries(parentDef.properties)) {
    const tsType = getTsType(prop);
    parentProps.push(`  ${key}: ${tsType};`);
  }
  
  // Generate child type
  for (const [key, prop] of Object.entries(childDef.properties)) {
    const tsType = getTsType(prop);
    childProps.push(`  ${key}: ${tsType};`);
  }
  
  // Get parent properties for FormViewProps (excluding timestamps)
  const formViewParentProps = Object.entries(parentDef.properties)
    .filter(([key]) => key !== 'created_at' && key !== 'updated_at')
    .map(([key, prop]) => `    ${key}: ${getTsType(prop)};`)
    .join('\n');
  
  return `export type ${parentPascal} = {
${parentProps.join('\n')}
};

export type ${parentPascal}Detail = ${parentPascal} & {
  ${childCamel}: ${childPascal}[];
};

export type ${childPascal} = {
${childProps.join('\n')}
};

export type ${parentPascal}DetailPageProps = Readonly<{
  params: Promise<{
    id: string;
  }>
}>;

export type FormViewProps = Readonly<{
  src: {
${formViewParentProps}
    ${childCamel}: ${childPascal}[];
  };
}>;

export type FormUpsertProps = Readonly<FormViewProps & {
  isEdit: boolean;
}>;
`;
}

function generateGetters(parent: string, child: string, schema: Schema): string {
  const parentPascal = toPascalCase(parent);
  const childCamel = toCamelCase(child);
  const parentCamel = toCamelCase(parent);
  
  const parentDef = schema.definitions[parent];
  const childDef = schema.definitions[child];
  
  // Get all parent properties except timestamps
  const parentProps = Object.keys(parentDef.properties).filter(k => 
    k !== 'created_at' && k !== 'updated_at'
  );
  
  // Get all child properties except timestamps
  const childProps = Object.keys(childDef.properties).filter(k => 
    k !== 'created_at' && k !== 'updated_at'
  );
  
  const parentMapping = parentProps.map(p => `    ${p}: ${parentCamel}.${p},`).join('\n');
  const childMapping = childProps.map(p => `      ${p}: item.${p},`).join('\n');
  
  return `'use server';

import prisma from '@/lib/prisma';
import type { ${parentPascal}, ${parentPascal}Detail } from '@/lib/${parent}/types';

export async function getAll${parentPascal}s(): Promise<${parentPascal}[]> {
  const ${parentCamel}s = await prisma.${parent}.findMany();
  return ${parentCamel}s.map((${parentCamel}) => ({
${parentMapping}
  }));
}

export async function get${parentPascal}Detail(id: string): Promise<${parentPascal}Detail | null> {
  const ${parentCamel} = await prisma.${parent}.findUnique({
    where: { id },
    include: { ${childCamel}: true },
  });

  if (!${parentCamel}) {
    return null;
  }

  return {
${parentMapping}
    ${childCamel}: ${parentCamel}.${childCamel}.map((item) => ({
${childMapping}
    })),
  };
}
`;
}

function generateActions(parent: string, child: string, schema: Schema): string {
  const parentPascal = toPascalCase(parent);
  const childPascal = toPascalCase(child);
  const childCamel = toCamelCase(child);
  const parentDef = schema.definitions[parent];
  const childDef = schema.definitions[child];
  
  // Get parent properties (excluding id and timestamps)
  const parentProps = Object.keys(parentDef.properties).filter(k => 
    k !== 'id' && k !== 'created_at' && k !== 'updated_at'
  );
  
  // Get child properties (excluding id, foreign key, and timestamps)
  const childProps = Object.keys(childDef.properties).filter(k => 
    k !== 'id' && k !== `${parent}_id` && k !== 'created_at' && k !== 'updated_at'
  );
  
  const fieldType = `{ ${childProps.map(p => `${p}: ${getTsType(childDef.properties[p])}`).join('; ')} }`;
  const fieldTypeWithId = `{ id?: string; ${childProps.map(p => `${p}: ${getTsType(childDef.properties[p])}`).join('; ')} }`;
  
  const fieldMapCreate = childProps.map(p => `          ${p}: f.${p},`).join('\n');
  const fieldDataUpdate = childProps.map(p => `          ${p}: field.${p},`).join('\n');
  
  // Generate FormData.get statements for parent properties
  const formDataGets = parentProps.map(p => {
    const prop = parentDef.properties[p];
    const isNullable = Array.isArray(prop.type) && prop.type.includes('null');
    return `  const ${p} = data.get('${p}') as string${isNullable ? ' | null' : ''};`;
  }).join('\n');
  
  const parentParams = parentProps.map(p => p).join(', ');
  const parentParamsWithTypes = parentProps.map(p => {
    const tsType = getTsType(parentDef.properties[p]);
    return `${p}: ${tsType}`;
  }).join(', ');
  
  const parentDataObj = parentProps.map(p => `      ${p},`).join('\n');
  
  return `'use server';

import { redirect } from 'next/navigation';
import prisma from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/auth';

export async function upsert${parentPascal}(data: FormData) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    throw new Error('User not authenticated');
  }

  const id = data.get('id') as string | null;
${formDataGets}
  const ${childCamel}Raw = data.getAll('${childCamel}[]') as string[];
  const ${childCamel} = ${childCamel}Raw.map(f => JSON.parse(f) as ${fieldTypeWithId});

  if (id) {
    await update${parentPascal}(id, ${parentParams}, ${childCamel});
  } else {
    await add${parentPascal}(${parentParams}, ${childCamel});
  }

  revalidatePath('/');
  redirect('/${parent}');
}

async function add${parentPascal}(${parentParamsWithTypes}, ${childCamel}: ${fieldType}[]) {
  await prisma.$transaction(async (tx) => {
    const newRecord = await tx.${parent}.create({
      data: {
${parentDataObj}
      },
    });
    const recordId = newRecord.id;

    if (${childCamel}.length > 0) {
      await tx.${child}.createMany({
        data: ${childCamel}.map(f => ({
${fieldMapCreate}
          ${parent}_id: recordId,
        })),
      });
    }
  });
}

async function update${parentPascal}(id: string, ${parentParamsWithTypes}, ${childCamel}: ${fieldTypeWithId}[]) {
  await prisma.$transaction(async (tx) => {
    await tx.${parent}.update({
      where: { id },
      data: {
${parentDataObj}
      },
    });

    const existing${childPascal} = await tx.${child}.findMany({
      where: { ${parent}_id: id },
    });

    const toUpsert = ${childCamel}.filter(f => f.id);
    const toCreate = ${childCamel}.filter(f => !f.id);

    for (const item of toUpsert) {
      await tx.${child}.update({
        where: { id: item.id! },
        data: {
${fieldDataUpdate}
        },
      });
    }

    if (toCreate.length > 0) {
      await tx.${child}.createMany({
        data: toCreate.map(f => ({
${fieldMapCreate}
          ${parent}_id: id,
        })),
      });
    }

    const newIds = ${childCamel}.filter(f => f.id).map(f => f.id!);
    const toDelete = existing${childPascal}.filter(ef => !newIds.includes(ef.id));
    if (toDelete.length > 0) {
      await tx.${child}.deleteMany({
        where: { id: { in: toDelete.map(f => f.id) } },
      });
    }
  });
}

export async function remove${parentPascal}(data: FormData | string[]) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    throw new Error('User not authenticated');
  }

  if (Array.isArray(data)) {
    await prisma.${parent}.deleteMany({
      where: { id: { in: data } },
    });
  } else {
    const id = data.get('id') as string;
    await prisma.${parent}.delete({
      where: { id },
    });
  }

  revalidatePath('/');
  redirect('/${parent}');
}
`;
}

function generateColumnDef(parent: string, child: string, schema: Schema): string {
  const childDef = schema.definitions[child];
  const columns: string[] = [];
  
  for (const [key, prop] of Object.entries(childDef.properties)) {
    if (key === 'id' || key === `${parent}_id` || key === 'created_at' || key === 'updated_at') {
      continue;
    }
    
    const headerName = key.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    let width = 150;
    let typeStr = '';
    
    if (prop.type === 'boolean' || (Array.isArray(prop.type) && prop.type.includes('boolean'))) {
      typeStr = ", type: 'boolean'";
      width = 100;
    } else if (prop.type === 'integer' || (Array.isArray(prop.type) && prop.type.includes('integer'))) {
      typeStr = ", type: 'number'";
      width = 100;
    }
    
    columns.push(`    { field: '${key}', headerName: '${headerName}', width: ${width}, editable: editable${typeStr} },`);
  }
  
  return `import { GridColDef } from '@mui/x-data-grid';

export function field_columns(editable: boolean = false): GridColDef[] {
  return [
${columns.join('\n')}
  ];
}
`;
}

function generateFormUpsert(parent: string, child: string, schema: Schema): string {
  const parentPascal = toPascalCase(parent);
  const childPascal = toPascalCase(child);
  const childCamel = toCamelCase(child);
  const parentDef = schema.definitions[parent];
  const childDef = schema.definitions[child];
  
  // Get parent properties (excluding id and timestamps)
  const parentProps = Object.keys(parentDef.properties).filter(k => 
    k !== 'id' && k !== 'created_at' && k !== 'updated_at'
  );
  
  // Get child properties (excluding id, foreign key, and timestamps)
  const childProps = Object.keys(childDef.properties).filter(k => 
    k !== 'id' && k !== `${parent}_id` && k !== 'created_at' && k !== 'updated_at'
  );
  
  // Generate refs and TextFields for parent properties
  const parentRefs = parentProps.map(p => `  const ${p}Ref = useRef<HTMLInputElement>(null);`).join('\n');
  
  const parentTextFields = parentProps.map(p => {
    const prop = parentDef.properties[p];
    const isRequired = parentDef.required?.includes(p);
    const label = p.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    
    return `      <TextField
        label="${label}"
        inputRef={${p}Ref}
        defaultValue={src.${p} || ''}
        fullWidth
        margin="normal"
        ${isRequired ? 'required' : ''}
        multiline={${p === 'description'}}
        rows={${p === 'description' ? '4' : 'undefined'}}
      />`;
  }).join('\n');
  
  const parentFormDataSets = parentProps.map(p => 
    `    formData.set('${p}', ${p}Ref.current?.value || '');`
  ).join('\n');
  
  const createNewChildProps = childProps.map(p => {
    const prop = childDef.properties[p];
    
    // Handle default values based on property name and type
    if (p === 'name') return `    name: '',`;
    if (p === 'type' && prop.enum) return `    type: '${prop.enum[0]}',`;
    if (prop.type === 'boolean' || (Array.isArray(prop.type) && prop.type.includes('boolean'))) {
      return `    ${p}: ${prop.default ?? false},`;
    }
    if (prop.type === 'string' || (Array.isArray(prop.type) && prop.type.includes('string'))) {
      return `    ${p}: '',`;
    }
    return `    ${p}: null,`;
  }).join('\n');
  
  const childSerialize = childProps.map(p => `          ${p}: field.${p},`).join('\n');
  
  return `'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { GridRowsProp } from '@mui/x-data-grid';
import TextField from '@mui/material/TextField';
import { upsert${parentPascal}, remove${parentPascal} } from '@/lib/${parent}/actions';
import type { FormUpsertProps } from '@/lib/${parent}/types';
import FormWithChildGrid from '../FormWithChildGrid';
import FieldsDataGrid from '../FieldsDataGrid';
import { field_columns } from '../${parent}/column_def';

export default function FormUpsert({ src, isEdit }: FormUpsertProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const fieldsGridRef = useRef<{ getFields: () => GridRowsProp }>(null);
${parentRefs}

  const columns = field_columns(true);

  const initial${childPascal} = src.${childCamel}.map(f => ({ ...f, id: f.id || \`temp-\${Date.now()}-\${Math.random()}\` }));

  const createNew${childPascal} = () => ({
    id: \`temp-\${Date.now()}-\${Math.random()}\`,
${createNewChildProps}
    ${parent}_id: src.id,
  });

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    
    const formData = new FormData();
    const ${childCamel} = fieldsGridRef.current?.getFields?.() || [];

    formData.set('id', src.id);
${parentFormDataSets}

    (${childCamel} as any[]).forEach((field) => {
      formData.append(
        '${childCamel}[]',
        JSON.stringify({
          id: field.id.startsWith('temp-') ? undefined : field.id,
${childSerialize}
        })
      );
    });

    try {
      startTransition(async () => {
        await upsert${parentPascal}(formData);
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    }
  };

  const handleDelete = async () => {
    const formData = new FormData();
    formData.set('id', src.id);
    await remove${parentPascal}(formData);
    router.push('/${parent}');
    router.refresh();
  };

  const handleBack = () => {
    router.back();
  };

  const formFields = (
    <>
${parentTextFields}
      <FieldsDataGrid
        ref={fieldsGridRef}
        initialFields={initial${childPascal}}
        columns={columns}
        createNewRow={createNew${childPascal}}
        addButtonLabel="Add ${childPascal}"
        deleteDialogTitle="Delete Selected ${childPascal}?"
        deleteDialogMessage="Are you sure you want to delete the selected item(s)? This action cannot be undone."
        showTitle={true}
        title="${childPascal}"
      />
    </>
  );

  return (
    <FormWithChildGrid
      title={\`\${isEdit ? 'Edit' : 'Add'} ${parentPascal}\`}
      isEdit={isEdit}
      formFields={formFields}
      onSubmit={handleSubmit}
      onDelete={isEdit ? handleDelete : undefined}
      onBack={handleBack}
      deleteEntityLabel="${parentPascal}"
      submitButtonLabel="Save"
      error={error}
    />
  );
}
`;
}

function generateFormView(parent: string, child: string, schema: Schema): string {
  const parentPascal = toPascalCase(parent);
  const childCamel = toCamelCase(child);
  const childPascal = toPascalCase(child);
  const parentDef = schema.definitions[parent];
  
  // Get parent properties (excluding id and timestamps)
  const parentProps = Object.keys(parentDef.properties).filter(k => 
    k !== 'id' && k !== 'created_at' && k !== 'updated_at'
  );
  
  const parentTextFields = parentProps.map(p => {
    const label = p.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    return `      <TextField
        label="${label}"
        value={src.${p} || ''}
        fullWidth
        margin="normal"
        disabled
      />`;
  }).join('\n');
  
  return `import { GridColDef } from '@mui/x-data-grid';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import type { FormViewProps } from '@/lib/${parent}/types';
import Link from '@mui/material/Link';
import FieldsViewGrid from '../FieldsViewGrid';
import { field_columns } from '../${parent}/column_def';

export default function FormView({ src }: FormViewProps) {
  const columns: GridColDef[] = field_columns(false);

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <h1>${parentPascal}</h1>
        <div>
          <Link href={\`/${parent}/edit/\${src.id}\`} sx={{ mx: 2 }}><Button variant="contained">Edit</Button></Link>
          <Link href="/${parent}"><Button variant="outlined">Back to List</Button></Link>
        </div>
      </div>
${parentTextFields}
      <div>
        <h2>${childPascal}</h2>
        <FieldsViewGrid fields={src.${childCamel}} columns={columns} />
      </div>
    </div>
  );
}
`;
}

function generatePageList(parent: string): string {
  const parentPascal = toPascalCase(parent);
  
  return `import { getAll${parentPascal}s } from '@/lib/${parent}/getters';
import DataGridClient from '@/components/DataGridClient';
import { remove${parentPascal} } from '@/lib/${parent}/actions';

export default async function ${parentPascal}sPage() {
  const ${parent}s = await getAll${parentPascal}s();
  return <DataGridClient src={${parent}s} basePath="/${parent}" removeAction={remove${parentPascal}} entityLabel="${parentPascal}" />;
}
`;
}

function generatePageNew(parent: string, child: string, schema: Schema): string {
  const parentPascal = toPascalCase(parent);
  const childCamel = toCamelCase(child);
  const parentDef = schema.definitions[parent];
  
  // Get parent properties (excluding id and timestamps) and set default values
  const parentDefaultProps = Object.entries(parentDef.properties)
    .filter(([key]) => key !== 'id' && key !== 'created_at' && key !== 'updated_at')
    .map(([key, prop]) => {
      if (prop.type === 'string' || (Array.isArray(prop.type) && prop.type.includes('string'))) {
        return `    ${key}: '',`;
      }
      return `    ${key}: null,`;
    })
    .join('\n');
  
  return `import FormUpsert from '@/components/${parent}/FormUpsert';

export default function Add${parentPascal}Page() {
  const src = {
    id: '',
${parentDefaultProps}
    ${childCamel}: [],
  };
  return <FormUpsert src={src} isEdit={false} />;
}
`;
}

function generatePageEdit(parent: string): string {
  const parentPascal = toPascalCase(parent);
  
  return `import FormUpsert from '@/components/${parent}/FormUpsert';
import { get${parentPascal}Detail } from '@/lib/${parent}/getters';
import { ${parentPascal}DetailPageProps } from '@/lib/${parent}/types';
import { notFound } from 'next/navigation';

export default async function Edit${parentPascal}Page({ params }: ${parentPascal}DetailPageProps) {
  const { id } = await params;
  const ${parent} = await get${parentPascal}Detail(id);
  if (!${parent}) {
    notFound();
  }
  return <FormUpsert src={${parent}} isEdit={true} />;
}
`;
}

function generatePageView(parent: string): string {
  const parentPascal = toPascalCase(parent);
  
  return `import FormView from '@/components/${parent}/FormView';
import { get${parentPascal}Detail } from '@/lib/${parent}/getters';
import { ${parentPascal}DetailPageProps } from '@/lib/${parent}/types';
import { notFound } from 'next/navigation';

export default async function View${parentPascal}Page({ params }: ${parentPascal}DetailPageProps) {
  const { id } = await params;
  const ${parent} = await get${parentPascal}Detail(id);
  if (!${parent}) {
    notFound();
  }
  return <FormView src={${parent}} />;
}
`;
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
