import type { Schema, SchemaProperty } from './types';

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

function toCamelCase(str: string): string {
  return str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
}

function toPascalCase(str: string): string {
  const camel = toCamelCase(str);
  return camel.charAt(0).toUpperCase() + camel.slice(1);
}

function toTitleCase(str: string): string {
  return str.split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
}

export function generateTypes(parent: string, child: string, schema: Schema): string {
  const parentPascal = toPascalCase(parent);
  const childPascal = child ? toPascalCase(child) : '';
  const childCamel = child ? toCamelCase(child) : '';
  
  const parentDef = schema.definitions[parent];
  const childDef = child ? schema.definitions[child] : null;
  
  const parentProps: string[] = [];
  const childProps: string[] = [];
  
  // Generate parent type
  if (parentDef.properties) {
    for (const [key, prop] of Object.entries(parentDef.properties)) {
      const tsType = getTsType(prop);
      parentProps.push(`  ${key}: ${tsType};`);
    }
  }
  
  // Generate child type if exists
  if (childDef?.properties) {
    for (const [key, prop] of Object.entries(childDef.properties)) {
      const tsType = getTsType(prop);
      childProps.push(`  ${key}: ${tsType};`);
    }
  }
  
  // Get parent properties for FormViewProps (excluding timestamps)
  const formViewParentProps = parentDef.properties
    ? Object.entries(parentDef.properties)
        .filter(([key]) => key !== 'created_at' && key !== 'updated_at')
        .map(([key, prop]) => `    ${key}: ${getTsType(prop)};`)
        .join('\n')
    : '';
  
  // Build type definitions
  let result = `export type ${parentPascal} = {
${parentProps.join('\n')}
};

`;
  
  // Add Detail type and child type if child exists
  if (child && childProps.length > 0) {
    result += `export type ${parentPascal}Detail = ${parentPascal} & {
  ${child}s: ${childPascal}[];
};

export type ${childPascal} = {
${childProps.join('\n')}
};

`;
  } else {
    // Parent-only case
    result += `export type ${parentPascal}Detail = ${parentPascal};

`;
  }
  
  // Add page props and form props
  result += `export type ${parentPascal}DetailPageProps = Readonly<{
  params: Promise<{
    id: string;
  }>
}>;

export type FormViewProps = Readonly<{
  src: {
${formViewParentProps}`;
  
  if (child) {
    result += `
    ${child}s: ${childPascal}[];`;
  }
  
  result += `
  };
}>;

export type FormUpsertProps = Readonly<FormViewProps & {
  isEdit: boolean;
}>;
`;

  return result;
}

export function generateGetters(parent: string, child: string, schema: Schema): string {
  const parentPascal = toPascalCase(parent);
  const childCamel = child ? toCamelCase(child) : '';
  const parentCamel = toCamelCase(parent);
  
  const parentDef = schema.definitions[parent];
  const childDef = child ? schema.definitions[child] : null;
  
  // Get all parent properties except timestamps
  const parentProps = parentDef.properties 
    ? Object.keys(parentDef.properties).filter(k => 
        k !== 'created_at' && k !== 'updated_at'
      )
    : [];
  
  // Get all child properties except timestamps
  const childProps = childDef?.properties
    ? Object.keys(childDef.properties).filter(k => 
        k !== 'created_at' && k !== 'updated_at'
      )
    : [];
  
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
    where: { id },${child ? `
    include: { ${child}s: true },` : ''}
  });

  if (!${parentCamel}) {
    return null;
  }

  return {
${parentMapping}${child ? `
    ${child}s: ${parentCamel}.${child}s.map((item) => ({
${childMapping}
    })),` : ''}
  };
}
`;
}

export function generateActions(parent: string, child: string, schema: Schema): string {
  const parentPascal = toPascalCase(parent);
  const childPascal = child ? toPascalCase(child) : '';
  const childCamel = child ? toCamelCase(child) : '';
  const parentDef = schema.definitions[parent];
  const childDef = child ? schema.definitions[child] : null;
  
  // Get parent properties (excluding id and timestamps)
  const parentProps = parentDef.properties
    ? Object.keys(parentDef.properties).filter(k => 
        k !== 'id' && k !== 'created_at' && k !== 'updated_at'
      )
    : [];
  
  // Get child properties (excluding id, foreign key, and timestamps)
  const childProps = childDef?.properties
    ? Object.keys(childDef.properties).filter(k => 
        k !== 'id' && k !== `${parent}_id` && k !== 'created_at' && k !== 'updated_at'
      )
    : [];
  
  const childPropsWithId = childDef?.properties
    ? Object.keys(childDef.properties).filter(k => 
        k !== 'created_at' && k !== 'updated_at'
      )
    : [];
  
  const fieldType = child && childDef?.properties 
    ? `{ ${childProps.map(p => `${p}: ${getTsType(childDef.properties![p])}`).join('; ')} }`
    : 'never';
  const fieldTypeWithId = child && childDef?.properties
    ? `{ ${childPropsWithId.map(p => `${p.replace(/id/, 'id?')}: ${getTsType(childDef.properties![p])}`).join('; ')} }`
    : 'never';
  const fieldTypeWithParentId = child && childDef?.properties
    ? `{ id?: string; ${childProps.map(p => `${p}: ${getTsType(childDef.properties![p])}`).join('; ')} }`
    : 'never';
  
  const fieldMapCreate = child ? childProps.map(p => `          ${p}: f.${p},`).join('\n') : '';
  const fieldDataUpdate = child ? childProps.map(p => `          ${p}: item.${p},`).join('\n') : '';
  
  // Generate FormData.get statements for parent properties
  const formDataGets = parentDef.properties
    ? parentProps.map(p => {
        const prop = parentDef.properties![p];
        const isNullable = Array.isArray(prop.type) && prop.type.includes('null');
        return `  const ${p} = data.get('${p}') as string${isNullable ? ' | null' : ''};`;
      }).join('\n')
    : '';
  
  const parentParams = parentProps.map(p => p).join(', ');
  const parentParamsWithTypes = parentDef.properties
    ? parentProps.map(p => {
        const tsType = getTsType(parentDef.properties![p]);
        return `${p}: ${tsType}`;
      }).join(', ')
    : '';
  
  const parentDataObj = parentProps.map(p => `      ${p},`).join('\n');
  
  let actionCode = `'use server';

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
${formDataGets}`;

  if (child) {
    actionCode += `
  const ${childCamel}sRaw = data.getAll('${childCamel}[]') as string[];
  const ${childCamel}s = ${childCamel}sRaw.map(f => JSON.parse(f) as ${fieldTypeWithId});

  if (id) {
    await update${parentPascal}(id, ${parentParams}, ${childCamel}s);
  } else {
    await add${parentPascal}(${parentParams}, ${childCamel}s);
  }`;
  } else {
    actionCode += `

  if (id) {
    await update${parentPascal}(id, ${parentParams});
  } else {
    await add${parentPascal}(${parentParams});
  }`;
  }

  actionCode += `

  revalidatePath('/');
  redirect('/${parent}');
}

`;

  if (child) {
    actionCode += `async function add${parentPascal}(${parentParamsWithTypes}, ${childCamel}s: ${fieldType}[]) {
  await prisma.$transaction(async (tx) => {
    const newRecord = await tx.${parent}.create({
      data: {
${parentDataObj}
      },
    });
    const recordId = newRecord.id;

    if (${childCamel}s.length > 0) {
      await tx.${child}.createMany({
        data: ${childCamel}s.map(f => ({
${fieldMapCreate}
          ${parent}_id: recordId,
        })),
      });
    }
  });
}

async function update${parentPascal}(id: string, ${parentParamsWithTypes}, ${childCamel}s: ${fieldTypeWithParentId}[]) {
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

    const toUpsert = ${childCamel}s.filter(f => f.id);
    const toCreate = ${childCamel}s.filter(f => !f.id);

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

    const newIds = ${childCamel}s.filter(f => f.id).map(f => f.id!);
    const toDelete = existing${childPascal}.filter(ef => !newIds.includes(ef.id));
    if (toDelete.length > 0) {
      await tx.${child}.deleteMany({
        where: { id: { in: toDelete.map(f => f.id) } },
      });
    }
  });
}
`;
  } else {
    actionCode += `async function add${parentPascal}(${parentParamsWithTypes}) {
  await prisma.${parent}.create({
    data: {
${parentDataObj}
    },
  });
}

async function update${parentPascal}(id: string, ${parentParamsWithTypes}) {
  await prisma.${parent}.update({
    where: { id },
    data: {
${parentDataObj}
    },
  });
}
`;
  }

  actionCode += `
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

  return actionCode;
}

export function generateColumnDef(parent: string, child: string, schema: Schema): string {
  if (!child) {
    return `import { GridColDef } from '@mui/x-data-grid';

export function field_columns(editable: boolean = false): GridColDef[] {
  return [];
}
`;
  }
  
  const childDef = schema.definitions[child];
  if (!childDef?.properties) {
    return `import { GridColDef } from '@mui/x-data-grid';

export function field_columns(editable: boolean = false): GridColDef[] {
  return [];
}
`;
  }
  
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

export function generateFormUpsert(parent: string, child: string, schema: Schema): string {
  const parentPascal = toPascalCase(parent);
  const parentTitle = toTitleCase(parent);
  const childPascal = toPascalCase(child);
  const childCamel = toCamelCase(child);
  const childTitle = toTitleCase(child);
  const parentDef = schema.definitions[parent];
  const childDef = schema.definitions[child];
  
  if (!parentDef.properties) {
    throw new Error(`Parent definition ${parent} has no properties`);
  }
  
  // Get parent properties (excluding id and timestamps)
  const parentProps = Object.keys(parentDef.properties).filter(k => 
    k !== 'id' && k !== 'created_at' && k !== 'updated_at'
  );
  
  if (!childDef?.properties) {
    throw new Error(`Child definition ${child} has no properties`);
  }
  
  // Get child properties (excluding id, foreign key, and timestamps)
  const childProps = Object.keys(childDef.properties).filter(k => 
    k !== 'id' && k !== `${parent}_id` && k !== 'created_at' && k !== 'updated_at'
  );
  
  // Generate refs and TextFields for parent properties
  const parentRefs = parentProps.map(p => `  const ${p}Ref = useRef<HTMLInputElement>(null);`).join('\n');
  
  const parentTextFields = parentProps.map(p => {
    const prop = parentDef.properties![p];
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
    const prop = childDef.properties![p];
    
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

  const initial${childPascal} = src.${child}s.map(f => ({ ...f, id: f.id || \`temp-\${Date.now()}-\${Math.random()}\` }));

  const createNew${childPascal} = () => ({
    id: \`temp-\${Date.now()}-\${Math.random()}\`,
${createNewChildProps}
    ${parent}_id: src.id,
  });

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    if (isPending) return; // Prevent duplicate submissions

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
  };

  const handleBack = () => {
    router.push('/${parent}');
    router.refresh();
  };

  const formFields = (
    <>
${parentTextFields}
      <FieldsDataGrid
        ref={fieldsGridRef}
        initialFields={initial${childPascal}}
        columns={columns}
        createNewRow={createNew${childPascal}}
        addButtonLabel="Add ${childTitle}"
        deleteDialogTitle="Delete Selected ${childTitle}?"
        deleteDialogMessage="Are you sure you want to delete the selected item(s)? This action cannot be undone."
        showTitle={true}
        title="${childTitle}"
      />
    </>
  );

  return (
    <FormWithChildGrid
      title={\`\${isEdit ? 'Edit' : 'Add'} ${parentTitle}\`}
      isEdit={isEdit}
      formFields={formFields}
      onSubmit={handleSubmit}
      onDelete={isEdit ? handleDelete : undefined}
      onBack={handleBack}
      deleteEntityLabel="${parentTitle}"
      submitButtonLabel="Save"
      error={error}
    />
  );
}
`;
}

export function generateFormView(parent: string, child: string, schema: Schema): string {
  const parentPascal = toPascalCase(parent);
  const childCamel = toCamelCase(child);
  const childPascal = toPascalCase(child);
  const parentDef = schema.definitions[parent];
  
  if (!parentDef.properties) {
    throw new Error(`Parent definition ${parent} has no properties`);
  }
  
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
        <FieldsViewGrid fields={src.${child}s} columns={columns} />
      </div>
    </div>
  );
}
`;
}

export function generatePageList(parent: string): string {
  const parentPascal = toPascalCase(parent);
  const parentTitle = toTitleCase(parent);
  
  return `import { getAll${parentPascal}s } from '@/lib/${parent}/getters';
import DataGridClient from '@/components/DataGridClient';
import { remove${parentPascal} } from '@/lib/${parent}/actions';

export default async function ${parentPascal}sPage() {
  const ${parent}s = await getAll${parentPascal}s();
  return <DataGridClient src={${parent}s} basePath="/${parent}" removeAction={remove${parentPascal}} entityLabel="${parentTitle}" />;
}
`;
}

export function generatePageNew(parent: string, child: string, schema: Schema): string {
  const parentPascal = toPascalCase(parent);
  const parentDef = schema.definitions[parent];
  
  if (!parentDef.properties) {
    throw new Error(`Parent definition ${parent} has no properties`);
  }
  
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
    ${child}s: [],
  };
  return <FormUpsert src={src} isEdit={false} />;
}
`;
}

export function generatePageEdit(parent: string): string {
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

export function generatePageView(parent: string): string {
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
