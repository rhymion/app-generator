import type { Schema, SchemaProperty, SchemaDefinition, GenerateConfig } from './types';

interface RelationshipInfo {
  type: 'many-to-many' | 'one-to-many';
  target: string;
}

interface ChildInfo {
  name: string;
  propertyName: string;
  outputType?: string;
  relationship?: RelationshipInfo;
}

function getTsType(prop: SchemaProperty): string {
  // Check for date/datetime/time format
  const format = (prop as any).format;
  const isDateType = format === 'date' || format === 'date-time' || format === 'time';
  
  if (Array.isArray(prop.type)) {
    // Union type for nullable
    if (isDateType) {
      // For nullable date types
      return prop.type.includes('null') ? 'Date | null' : 'Date';
    }
    return prop.type.map(t => t === 'null' ? 'null' : mapJsonTypeToTs(t)).join(' | ');
  }
  
  if (prop.type === 'array') {
    return 'any[]'; // Simplified
  }
  
  if (isDateType && prop.type === 'string') {
    return 'Date';
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

type ParentRelationshipMeta = {
  propName: string;
  target: string;
  labelField?: string;
  required?: boolean;
};

function getParentRelationships(parentDef?: SchemaDefinition): ParentRelationshipMeta[] {
  if (!parentDef?.properties) return [];

  return Object.entries(parentDef.properties).flatMap(([propName, prop]) => {
    const rel = (prop as any)['x-relationship'] as SchemaProperty['x-relationship'] | undefined;
    if (!rel || rel.type !== 'many-to-one' || !rel.target) {
      return [];
    }

    return [{
      propName,
      target: rel.target,
      labelField: rel.labelField,
      required: parentDef.required?.includes(propName),
    }];
  });
}

export function generateTypes(parent: string, children: ChildInfo[], schema: Schema): string {
  const parentPascal = toPascalCase(parent);
  
  const parentDef = schema.definitions[parent];
  const parentRelationships = getParentRelationships(parentDef);
  const relationshipTargets = Array.from(
    new Map(parentRelationships.map(r => [r.target, r])).values()
  );
  
  const parentProps: string[] = [];
  
  // Generate parent type
  if (parentDef.properties) {
    for (const [key, prop] of Object.entries(parentDef.properties)) {
      const tsType = getTsType(prop);
      parentProps.push(`  ${key}: ${tsType};`);
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

  // Add option types for many-to-one relationships
  if (relationshipTargets.length > 0) {
    const optionTypes = relationshipTargets.map(r => {
      const targetPascal = toPascalCase(r.target);
      const labelField = r.labelField ?? 'name';
      return `export type ${targetPascal}Option = {\n  id: string;\n  ${labelField}: string;\n};`;
    }).join('\n\n');

    result += `${optionTypes}\n\n`;
  }
  
  // Generate child types
  const childTypeDeclarations: string[] = [];
  const detailChildProps: string[] = [];
  const formViewChildProps: string[] = [];
  
  for (const child of children) {
    const childPascal = toPascalCase(child.name);
    const childDef = schema.definitions[child.name];
    
    if (childDef?.properties) {
      const childProps: string[] = [];
      for (const [key, prop] of Object.entries(childDef.properties)) {
        const tsType = getTsType(prop);
        childProps.push(`  ${key}: ${tsType};`);
      }
      
      childTypeDeclarations.push(`export type ${childPascal} = {
${childProps.join('\n')}
};
`);
      detailChildProps.push(`  ${child.propertyName}: ${childPascal}[];`);
      formViewChildProps.push(`    ${child.propertyName}: ${childPascal}[];`);
    }
  }
  
  // Add Detail type
  if (children.length > 0) {
    result += `export type ${parentPascal}Detail = ${parentPascal} & {
${detailChildProps.join('\n')}
};

`;
    result += childTypeDeclarations.join('\n');
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
  
  if (children.length > 0) {
    result += `\n${formViewChildProps.join('\n')}`;
  }
  
  result += `
  };
}>;

export type FormUpsertProps = Readonly<FormViewProps & {
  isEdit: boolean;${children.filter(c => c.relationship?.type === 'many-to-many').map(c => {
    const targetPascal = toPascalCase(c.relationship!.target);
    return `\n  all${targetPascal}s?: ${targetPascal}[];`;
  }).join('')}
${relationshipTargets.map(r => {
    const targetPascal = toPascalCase(r.target);
    return `\n  all${targetPascal}s?: ${targetPascal}Option[];`;
  }).join('')}
}>;
`;

  return result;
}

export function generateGetters(parent: string, children: ChildInfo[], schema: Schema, generateConfig?: any): string {
  const parentPascal = toPascalCase(parent);
  const parentCamel = toCamelCase(parent);
  
  const parentDef = schema.definitions[parent];
  
  // Get all parent properties except timestamps
  const parentProps = parentDef.properties 
    ? Object.keys(parentDef.properties).filter(k => 
        k !== 'created_at' && k !== 'updated_at'
      )
    : [];
  
  const parentMapping = parentProps.map(p => `    ${p}: ${parentCamel}.${p},`).join('\n');
  
  // Build include and mapping for all children
  const includeProps = children.length > 0
    ? children.map(c => `${c.propertyName}: true`).join(', ')
    : '';
  
  const childMappings = children.length > 0
    ? children.map(c => `    ${c.propertyName}: ${parentCamel}.${c.propertyName},`).join('\n')
    : '';
  
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
    where: { id },${includeProps ? `
    include: { 
      ${includeProps.split(', ').join(', \n      ')} 
    },` : ''}
  });

  if (!${parentCamel}) {
    return null;
  }

  return {
    ...${parentCamel},${childMappings ? `
${childMappings}` : ''}
  };
}
`;
}

export function generateActions(parent: string, children: ChildInfo[], schema: Schema, generateConfig?: any): string {
  const parentPascal = toPascalCase(parent);
  const parentDef = schema.definitions[parent];
  const canDelete = generateConfig?.delete !== false;
  
  // Get parent properties (excluding id and timestamps)
  const parentProps = parentDef.properties
    ? Object.keys(parentDef.properties).filter(k => 
        k !== 'id' && k !== 'created_at' && k !== 'updated_at'
      )
    : [];
  
  // Generate FormData.get statements for parent properties
  const formDataGets = parentDef.properties
    ? parentProps.map(p => {
        const prop = parentDef.properties![p];
        const propType = Array.isArray(prop.type) ? prop.type.find(t => t !== 'null') : prop.type;
        const isNullable = Array.isArray(prop.type) && prop.type.includes('null');
        const format = (prop as any).format;
        
        // Handle Date/DateTime/Time fields
        if (propType === 'string' && (format === 'date' || format === 'date-time' || format === 'time')) {
          if (isNullable) {
            return `  const ${p}_str = data.get('${p}') as string | null;\n  const ${p} = ${p}_str ? new Date(${p}_str) : null;`;
          } else {
            return `  const ${p}_str = data.get('${p}') as string;\n  const ${p} = new Date(${p}_str);`;
          }
        }
        
        // Handle number fields
        if (propType === 'integer' || propType === 'number') {
          return `  const ${p} = Number(data.get('${p}'));`;
        }
        
        // Handle string and other fields
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
  
  // For parent-only, generate simple CRUD
  if (children.length === 0) {
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

  if (id) {
    await update${parentPascal}(id, ${parentParams});
  } else {
    await add${parentPascal}(${parentParams});
  }

  revalidatePath('/');
  redirect('/${parent}');
}

async function add${parentPascal}(${parentParamsWithTypes}) {
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
${canDelete ? `
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
` : ''}`;
  }
  
  // For with-children cases, handle all children
  const allChildrenData = children.map(childInfo => {
    const child = childInfo.name;
    const childCamel = toCamelCase(child);
    const childPascal = toPascalCase(child);
    const childDef = schema.definitions[child];
    const isManyToMany = childInfo.relationship?.type === 'many-to-many';
    
    if (!childDef?.properties) {
      throw new Error(`Child definition ${child} has no properties`);
    }
    
    const childProps = Object.keys(childDef.properties).filter(k => 
      k !== 'id' && k !== `${parent}_id` && k !== 'created_at' && k !== 'updated_at'
    );
    
    const childPropsWithId = Object.keys(childDef.properties).filter(k => 
      k !== 'created_at' && k !== 'updated_at'
    );
    
    const fieldType = `{ ${childProps.map(p => `${p}: ${getTsType(childDef.properties![p])}`).join('; ')} }`;
    const fieldTypeWithId = `{ ${childPropsWithId.map(p => `${p.replace(/id/, 'id?')}: ${getTsType(childDef.properties![p])}`).join('; ')} }`;
    
    const fieldMapCreate = childProps.map(p => `          ${p}: f.${p},`).join('\n');
    
    return {
      child,
      childCamel,
      childPascal,
      fieldType,
      fieldTypeWithId,
      fieldMapCreate,
      isManyToMany,
      propertyName: childInfo.propertyName,
    };
  });
  
  // Generate FormData extraction for all children
  const childFormDataExtractions = allChildrenData.map(({ childCamel, fieldTypeWithId, isManyToMany }) => {
    if (isManyToMany) {
      // For many-to-many, extract IDs (only type id and name fields)
      return `  const ${childCamel}sRaw = data.getAll('${childCamel}[]') as string[];\n  const ${childCamel}s = ${childCamel}sRaw.map(f => JSON.parse(f) as { id?: string; name?: string });\n  const ${childCamel}Ids = ${childCamel}s\n    .map((${childCamel}) => ${childCamel}.id)\n    .filter((${childCamel}Id): ${childCamel}Id is string => Boolean(${childCamel}Id));`;
    } else {
      return `  const ${childCamel}sRaw = data.getAll('${childCamel}[]') as string[];\n  const ${childCamel}s = ${childCamel}sRaw.map(f => JSON.parse(f) as ${fieldTypeWithId});`;
    }
  }).join('\n');
  
  const childParamsForAdd = allChildrenData.map(({ childCamel, fieldType, isManyToMany }) => 
    isManyToMany ? `${childCamel}Ids: string[]` : `${childCamel}s: ${fieldType}[]`
  ).join(', ');
  const childParamsForUpdate = allChildrenData.map(({ childCamel, fieldTypeWithId, isManyToMany }) => 
    isManyToMany ? `${childCamel}Ids: string[]` : `${childCamel}s: ${fieldTypeWithId}[]`
  ).join(', ');
  const childArgsForCall = allChildrenData.map(({ childCamel, isManyToMany }) => 
    isManyToMany ? `${childCamel}Ids` : `${childCamel}s`
  ).join(', ');
  
  // Generate nested create for all children
  const childNestedCreate = allChildrenData.map(({ propertyName, childCamel, fieldMapCreate, isManyToMany }) => {
    if (isManyToMany) {
      return `      ${propertyName}: {\n        connect: ${childCamel}Ids.map((id) => ({ id })),\n      },`;
    } else {
      return `      ${propertyName}: {\n        create: ${childCamel}s.map(f => ({\n${fieldMapCreate}\n        })),\n      },`;
    }
  }).join('\n');
  
  // Generate nested update (deleteMany + create for one-to-many, set for many-to-many)
  const childNestedUpdate = allChildrenData.map(({ propertyName, childCamel, fieldMapCreate, isManyToMany }) => {
    if (isManyToMany) {
      return `      ${propertyName}: {\n        set: ${childCamel}Ids.map((id) => ({ id })),\n      },`;
    } else {
      return `      ${propertyName}: {\n        deleteMany: {},\n        create: ${childCamel}s.map(f => ({\n${fieldMapCreate}\n        })),\n      },`;
    }
  }).join('\n');
  
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
${childFormDataExtractions}

  if (id) {
    await update${parentPascal}(id, ${parentParams}${parentParams && childArgsForCall ? ', ' : ''}${childArgsForCall});
  } else {
    await add${parentPascal}(${parentParams}${parentParams && childArgsForCall ? ', ' : ''}${childArgsForCall});
  }

  revalidatePath('/');
  redirect('/${parent}');
}

async function add${parentPascal}(${parentParamsWithTypes}${parentParamsWithTypes && childParamsForAdd ? ', ' : ''}${childParamsForAdd}) {
  await prisma.${parent}.create({
    data: {
${parentDataObj}
${childNestedCreate}
    },
  });
}

async function update${parentPascal}(id: string${parentParamsWithTypes ? ', ' : ''}${parentParamsWithTypes}${parentParamsWithTypes && childParamsForUpdate ? ', ' : ''}${childParamsForUpdate}) {
  await prisma.${parent}.update({
    where: { id },
    data: {
${parentDataObj}
${childNestedUpdate}
    },
  });
}
${canDelete ? `
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
` : ''}`;
}

export function generateColumnDef(parent: string, children: ChildInfo[], schema: Schema): string {
  if (children.length === 0) {
    return '';
  }
  
  const columnFunctions = children.map(childInfo => {
    const child = childInfo.name;
    const childSnake = child;
    const childDef = schema.definitions[child];
    
    if (!childDef?.properties) {
      return `export function ${childSnake}_columns(editable: boolean = false): GridColDef[] {
  return [];
}`;
    }
    
    const columns: string[] = [];
    const dateTimeFields: string[] = [];
    let needsDateTimeImports = false;
    
    for (const [key, prop] of Object.entries(childDef.properties)) {
      if (key === 'id' || key === `${parent}_id` || key === 'created_at' || key === 'updated_at') {
        continue;
      }
      
      const headerName = key.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
      let width = 150;
      let typeStr = '';
      
      const propType = Array.isArray(prop.type) ? prop.type.find(t => t !== 'null') : prop.type;
      const format = (prop as any).format;
      
      // Special handling for 'order' field - always read-only
      if (key === 'order') {
        typeStr = ", type: 'number'";
        width = 100;
        columns.push(`    { field: '${key}', headerName: '${headerName}', width: ${width}, editable: false${typeStr} },`);
        continue;
      }
      
      if (prop.type === 'boolean' || (Array.isArray(prop.type) && prop.type.includes('boolean'))) {
        typeStr = ", type: 'boolean'";
        width = 100;
      } else if (prop.type === 'integer' || (Array.isArray(prop.type) && prop.type.includes('integer'))) {
        typeStr = ", type: 'number'";
        width = 100;
      } else if (propType === 'string' && (format === 'date' || format === 'date-time' || format === 'time')) {
        // DateTime field - needs custom renderEditCell
        needsDateTimeImports = true;
        dateTimeFields.push(key);
        width = 250;
        
        columns.push(`    { 
      field: '${key}', 
      headerName: '${headerName}', 
      width: ${width}, 
      editable: editable,
      renderEditCell: (params: GridRenderEditCellParams) => (
        <DateTimeWrapper
          label="${headerName}"
          date_time={params.value ? new Date(params.value) : null}
          onChange={(newValue: dayjs.Dayjs | null) => {
            params.api.setEditCellValue({ 
              id: params.id, 
              field: params.field, 
              value: newValue ? newValue.toISOString() : '' 
            });
          }}
        />
      ),
      valueFormatter: (value) => {
        if (!value) return '';
        return dayjs(value).format('YYYY-MM-DD HH:mm');
      },
    },`);
        continue;
      }
      
      columns.push(`    { field: '${key}', headerName: '${headerName}', width: ${width}, editable: editable${typeStr} },`);
    }
    
    return `export function ${childSnake}_columns(editable: boolean = false): GridColDef[] {
  return [
${columns.join('\n')}
  ];
}`;
  }).join('\n\n');
  
  // Check if any child has DateTime fields
  const needsDateTimeImports = children.some(childInfo => {
    const child = childInfo.name;
    const childDef = schema.definitions[child];
    if (!childDef?.properties) return false;
    
    return Object.entries(childDef.properties).some(([key, prop]) => {
      const propType = Array.isArray(prop.type) ? prop.type.find(t => t !== 'null') : prop.type;
      const format = (prop as any).format;
      return propType === 'string' && (format === 'date' || format === 'date-time' || format === 'time');
    });
  });
  
  return `import { GridColDef${needsDateTimeImports ? ', GridRenderEditCellParams' : ''} } from '@mui/x-data-grid';${needsDateTimeImports ? '\nimport DateTimeWrapper from \'../DateTimeWrapper\';\nimport dayjs from \'dayjs\';' : ''}

${columnFunctions}
`;
}

export function generateFormUpsert(parent: string, children: ChildInfo[], schema: Schema, generateConfig?: any): string {
  const parentPascal = toPascalCase(parent);
  const parentTitle = toTitleCase(parent);
  const parentDef = schema.definitions[parent];
  const canDelete = generateConfig?.delete !== false;
  const parentRelationships = getParentRelationships(parentDef);
  
  if (!parentDef.properties) {
    throw new Error(`Parent definition ${parent} has no properties`);
  }
  
  // Get parent properties (excluding id and timestamps)
  const parentProps = Object.keys(parentDef.properties).filter(k => 
    k !== 'id' && k !== 'created_at' && k !== 'updated_at'
  );
  const relationshipProps = parentRelationships.map(r => r.propName);
  const nonRelationshipProps = parentProps.filter(p => !relationshipProps.includes(p));
  
  // Categorize parent properties by type
  const dateTimeProps: string[] = [];
  const numberProps: string[] = [];
  const imageProps: string[] = [];
  const textProps: string[] = [];
  
  nonRelationshipProps.forEach(p => {
    const prop = parentDef.properties![p];
    const propType = Array.isArray(prop.type) ? prop.type.find(t => t !== 'null') : prop.type;
    const format = (prop as any).format;
    
    if (propType === 'string' && (format === 'date' || format === 'date-time' || format === 'time')) {
      dateTimeProps.push(p);
    } else if (propType === 'integer' || propType === 'number') {
      numberProps.push(p);
    } else if (propType === 'string' && format === 'uri') {
      imageProps.push(p);
    } else {
      textProps.push(p);
    }
  });
  
  // Generate refs for text and number fields
  const textRefs = textProps.map(p => `  const ${p}Ref = useRef<HTMLInputElement>(null);`).join('\n');
  const numberRefs = numberProps.map(p => `  const ${p}Ref = useRef<HTMLInputElement>(null);`).join('\n');
  const parentRefs = [textRefs, numberRefs].filter(r => r).join('\n');
  
  // Generate state for DateTime and Image fields
  const dateTimeStates = dateTimeProps.map(p => 
    `  const [${toCamelCase(p)}, set${toPascalCase(p)}] = useState<Dayjs | null>(src.${p} ? dayjs(src.${p}) : null);`
  ).join('\n');
  
  const imageStates = imageProps.map(p => 
    `  const [${toCamelCase(p)}, set${toPascalCase(p)}] = useState<string>(src.${p} || '');`
  ).join('\n');
  
  const relationshipStates = parentRelationships.map(r => {
    const stateName = toCamelCase(r.propName);
    const stateSetter = toPascalCase(r.propName);
    return `  const [${stateName}, set${stateSetter}] = useState<string | null>(src.${r.propName} || null);`;
  }).join('\n');

  const allStates = [dateTimeStates, imageStates, relationshipStates].filter(s => s).join('\n');
  
  // Generate form fields
  const textFields = textProps.map(p => {
    const prop = parentDef.properties![p];
    const isRequired = parentDef.required?.includes(p);
    const label = p.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    const minLength = (prop as any).minLength;
    const maxLength = (prop as any).maxLength;
    
    let slotPropsStr = '';
    if (minLength !== undefined || maxLength !== undefined) {
      const constraints: string[] = [];
      if (minLength !== undefined) constraints.push(`minLength: ${minLength}`);
      if (maxLength !== undefined) constraints.push(`maxLength: ${maxLength}`);
      slotPropsStr = `\n        slotProps={ { htmlInput: { ${constraints.join(', ')} } } }`;
    }
    
    return `      <TextField
        label="${label}"
        inputRef={${p}Ref}
        defaultValue={src.${p} || ''}
        fullWidth
        margin="normal"
        ${isRequired ? 'required' : ''}${slotPropsStr}
        multiline={${p === 'description'}}
        rows={${p === 'description' ? '4' : 'undefined'}}
      />`;
  }).join('\n');

  const relationshipFields = parentRelationships.map(r => {
    const labelBase = r.propName.replace(/_id$/, '');
    const label = toTitleCase(labelBase);
    const stateName = toCamelCase(r.propName);
    const stateSetter = toPascalCase(r.propName);
    const targetPascal = toPascalCase(r.target);
    const labelField = r.labelField ?? 'name';
    const optionsVar = `${stateName}Options`;

    return `      <Autocomplete
        options={${optionsVar}}
        value={${optionsVar}.find((option) => option.id === ${stateName}) || null}
        onChange={(_, newValue) => set${stateSetter}(newValue?.id ?? null)}
        renderInput={(params) => (
          <TextField
            {...params}
            label="${label}"
            margin="normal"
            ${r.required ? 'required' : ''}
          />
        )}
      />`;
  }).join('\n');
  
  const numberFields = numberProps.map(p => {
    const prop = parentDef.properties![p];
    const label = p.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    const min = (prop as any).minimum ?? 0;
    const max = (prop as any).maximum ?? 1000000;
    
    return `      <NumberField 
        label="${label}" 
        inputRef={${p}Ref} 
        defaultValue={src.${p} || 0} 
        min={${min}}
        max={${max}}
      />`;
  }).join('\n');
  
  const dateTimeFields = dateTimeProps.map(p => {
    const label = p.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    const camelCase = toCamelCase(p);
    const pascalCase = toPascalCase(p);
    
    return `      <DateTimeWrapper 
        label="${label}" 
        date_time={${camelCase} ? ${camelCase}.toDate() : null}
        onChange={(newValue: dayjs.Dayjs | null) => set${pascalCase}(newValue)}
      />`;
  }).join('\n');
  
  const imageFields = imageProps.map(p => {
    const camelCase = toCamelCase(p);
    const pascalCase = toPascalCase(p);
    
    return `      <ImageUpload
        value={${camelCase}}
        onChange={set${pascalCase}}
      />`;
  }).join('\n');
  
  const parentTextFields = [textFields, relationshipFields, numberFields, dateTimeFields, imageFields].filter(f => f).join('\n');
  
  // Generate FormData sets
  const textFormDataSets = textProps.map(p => 
    `    formData.set('${p}', ${p}Ref.current?.value || '');`
  ).join('\n');
  
  const numberFormDataSets = numberProps.map(p => 
    `    formData.set('${p}', ${p}Ref.current?.value || '');`
  ).join('\n');
  
  const dateTimeFormDataSets = dateTimeProps.map(p => {
    const camelCase = toCamelCase(p);
    return `    formData.set('${p}', ${camelCase}?.toISOString() || '');`;
  }).join('\n');
  
  const imageFormDataSets = imageProps.map(p => {
    const camelCase = toCamelCase(p);
    return `    formData.set('${p}', ${camelCase});`;
  }).join('\n');
  
  const relationshipFormDataSets = parentRelationships.map(r => {
    const stateName = toCamelCase(r.propName);
    return `    formData.set('${r.propName}', ${stateName} || '');`;
  }).join('\n');

  const parentFormDataSets = [textFormDataSets, relationshipFormDataSets, numberFormDataSets, dateTimeFormDataSets, imageFormDataSets].filter(s => s).join('\n');
  
  // Determine if we have children
  const hasChildren = children.length > 0;
  const hasManyToOne = parentRelationships.length > 0;
  
  const relationshipOptionSetups = parentRelationships.map(r => {
    const targetPascal = toPascalCase(r.target);
    const labelField = r.labelField ?? 'name';
    const stateName = toCamelCase(r.propName);
    const optionsVar = `${stateName}Options`;

    return `  const ${optionsVar} = useMemo(() => {
    return all${targetPascal}s.map((item) => ({
      id: item.id,
      label: item.${labelField},
    }));
  }, [all${targetPascal}s]);`;
  }).join('\n');

  // Generate code for all children
  let childVariables = '';
  let childImports = '';
  let childGridSetup = '';
  let childFormDataHandling = '';
  let childGridComponents = '';
  
  if (hasChildren) {
    const columnImports = children.map(c => `${c.name}_columns`).join(', ');
    
    // Check if any child has 'order' field
    const hasOrderedChildren = children.some(childInfo => {
      const childDef = schema.definitions[childInfo.name];
      return childDef?.properties && 'order' in childDef.properties;
    });
    
    const dataGridImports = hasOrderedChildren 
      ? `import FieldsDataGrid from '../FieldsDataGrid';\nimport OrderedFieldsDataGrid from '../OrderedFieldsDataGrid';`
      : `import FieldsDataGrid from '../FieldsDataGrid';`;

    const hasListChildren = children.some(c => c.outputType === 'list' || c.relationship?.type === 'many-to-many');
    childImports = `import { GridRowsProp } from '@mui/x-data-grid';
${dataGridImports}
import { ${columnImports} } from '../${parent}/column_def';`;
    
    if (hasListChildren) {
      childImports = `import EditableListWrapper, { EditableListWrapperItem } from '../EditableListWrapper';\n` + childImports;
    }
    
    // Add imports for many-to-many target types
    const manyToManyImports = children
      .filter(c => c.relationship?.type === 'many-to-many')
      .map(c => c.relationship!.target)
      .filter((target, index, self) => self.indexOf(target) === index) // unique
      .map(target => `import type { ${toPascalCase(target)} } from '@/lib/${target}/types';`)
      .join('\n');
    
    if (manyToManyImports) {
      childImports = manyToManyImports + '\n' + childImports;
    }
    
    childVariables = children.map(childInfo => {
      const refType = (childInfo.outputType === 'list' || childInfo.relationship?.type === 'many-to-many')
        ? '{ getItems: () => EditableListWrapperItem[] }'
        : '{ getFields: () => GridRowsProp }';
      return `  const ${childInfo.name}Ref = useRef<${refType}>(null);`;
    }).join('\n');
    
    const allChildSetups = children.map(childInfo => {
      const child = childInfo.name;
      const childPascal = toPascalCase(child);
      const childDef = schema.definitions[child];
      
      if (!childDef?.properties) {
        throw new Error(`Child definition ${child} has no properties`);
      }
      
      const childProps = Object.keys(childDef.properties).filter(k => 
        k !== 'id' && k !== `${parent}_id` && k !== 'created_at' && k !== 'updated_at'
      );
      
      // For many-to-many relationships
      if (childInfo.relationship?.type === 'many-to-many') {
        const targetPascal = toPascalCase(childInfo.relationship.target);
        const childCamel = toCamelCase(child);
        return `  const initial${childPascal}: EditableListWrapperItem[] = src.${childInfo.propertyName}.map(f => ({
    id: f.id || \`temp-\${Date.now()}-\${Math.random()}\`,
    value: f.id,
    label: f.name,
    originalId: f.id,
  }));
  const [selected${childPascal}s, setSelected${childPascal}s] = useState<EditableListWrapperItem[]>(initial${childPascal});
  const autocompleteOptions${childPascal} = useMemo(() => {
    const assigned${childPascal}Ids = new Set(
      selected${childPascal}s
        .map((${childCamel}) => ${childCamel}.originalId ?? ${childCamel}.value)
        .filter((${childCamel}Id): ${childCamel}Id is string => typeof ${childCamel}Id === 'string')
    );
    return all${targetPascal}s
      .filter((${childCamel}) => !assigned${childPascal}Ids.has(${childCamel}.id))
      .map((${childCamel}) => ({
        id: ${childCamel}.id,
        label: ${childCamel}.name,
        value: ${childCamel}.name,
      }));
  }, [all${targetPascal}s, selected${childPascal}s]);`;
      }
      
      // For list output type, generate different initialization
      if (childInfo.outputType === 'list') {
        // Assuming list items have a 'name' field as the primary value
        return `  const initial${childPascal}: EditableListWrapperItem[] = src.${childInfo.propertyName}.map(f => ({
    id: f.id || \`temp-\${Date.now()}-\${Math.random()}\`,
    value: f.name,
    label: f.name,
    originalId: f.id,
  }));`;
      }
      
      const createNewChildProps = childProps.map(p => {
        const prop = childDef.properties![p];
        const format = (prop as any).format;
        const isDateType = format === 'date' || format === 'date-time' || format === 'time';
        
        // if (p === 'name') return `    name: '',`;
        // if (p === 'type' && prop.enum) return `    type: '${prop.enum[0]}',`;
        if (prop.type === 'boolean' || (Array.isArray(prop.type) && prop.type.includes('boolean'))) {
          return `    ${p}: ${prop.default ?? false},`;
        }
        if (prop.type === 'string' || (Array.isArray(prop.type) && prop.type.includes('string'))) {
          if (isDateType) {
            return `    ${p}: dayjs().toISOString(),`;
          }
          return `    ${p}: '',`;
        }
        if (prop.type === 'integer' || prop.type === 'number') {
          return `    ${p}: 0,`;
        }
        return `    ${p}: null,`;
      }).join('\n');
      
      // Skip column and createNew function for list output type
      if (childInfo.outputType === 'list') {
        return '';
      }
      
      return `  const ${child}Columns = ${child}_columns(true);

  const initial${childPascal} = src.${childInfo.propertyName}.map(f => ({ ...f, id: f.id || \`temp-\${Date.now()}-\${Math.random()}\` }));

  const createNew${childPascal} = () => ({
    id: \`temp-\${Date.now()}-\${Math.random()}\`,
${createNewChildProps}
    ${parent}_id: src.id,
  });`;
    }).join('\n');
    
    childGridSetup = `\n${allChildSetups}`;
    
    const allChildFormDataHandling = children.map(childInfo => {
      const child = childInfo.name;
      const childCamel = toCamelCase(child);
      const childDef = schema.definitions[child];
      
      if (!childDef?.properties) {
        throw new Error(`Child definition ${child} has no properties`);
      }
      
      // For many-to-many relationships
      if (childInfo.relationship?.type === 'many-to-many') {
        return `    const ${childCamel} = ${child}Ref.current?.getItems?.() || [];

    ${childCamel}.forEach((item) => {
      const itemId =
        item.originalId ??
        (typeof item.value === 'string' || typeof item.value === 'number' ? item.value : undefined);
      formData.append(
        '${childCamel}[]',
        JSON.stringify({
          id: itemId,
          name: item.label ?? item.value,
        })
      );
    });`;
      }
      
      // For list output type
      if (childInfo.outputType === 'list') {
        return `    const ${childCamel} = ${child}Ref.current?.getItems?.() || [];

    ${childCamel}.forEach((item) => {
      const itemId = item.originalId || (typeof item.id === 'string' && item.id.startsWith('temp-') ? undefined : item.id);
      formData.append(
        '${childCamel}[]',
        JSON.stringify({
          id: itemId,
          name: item.value,
        })
      );
    });`;
      }
      
      const childProps = Object.keys(childDef.properties).filter(k => 
        k !== 'id' && k !== `${parent}_id` && k !== 'created_at' && k !== 'updated_at'
      );
      
      const childSerialize = childProps.map(p => `          ${p}: field.${p},`).join('\n');
      
      return `    const ${childCamel} = ${child}Ref.current?.getFields?.() || [];

    (${childCamel} as any[]).forEach((field) => {
      formData.append(
        '${childCamel}[]',
        JSON.stringify({
          id: field.id.startsWith('temp-') ? undefined : field.id,
${childSerialize}
        })
      );
    });`;
    }).join('\n');
    
    childFormDataHandling = `\n${allChildFormDataHandling}`;
    
    childGridComponents = children.map(childInfo => {
      const child = childInfo.name;
      const childPascal = toPascalCase(child);
      const childTitle = toTitleCase(child);
      const childDef = schema.definitions[child];
      
      // For many-to-many relationships, use EditableListWrapper with autocomplete
      if (childInfo.relationship?.type === 'many-to-many') {
        return `      <EditableListWrapper
        ref={${child}Ref}
        initialItems={initial${childPascal}}
        itemType="autocomplete"
        addButtonLabel="Add ${childTitle}"
        showTitle={true}
        title="${childTitle}"
        textFieldLabel="Name"
        textFieldPlaceholder="Enter name"
        autocompleteOptions={autocompleteOptions${childPascal}}
        onItemsChange={setSelected${childPascal}s}
      />`;
      }
      
      // For list output type, use EditableListWrapper
      if (childInfo.outputType === 'list') {
        return `      <EditableListWrapper
        ref={${child}Ref}
        initialItems={initial${childPascal}}
        itemType="text"
        addButtonLabel="Add ${childTitle}"
        showTitle={true}
        title="${childTitle}"
        textFieldLabel="Name"
        textFieldPlaceholder="Enter name"
      />`;
      }
      
      // Check if child has 'order' field
      const hasOrderField = childDef?.properties && 'order' in childDef.properties;
      const gridComponent = hasOrderField ? 'OrderedFieldsDataGrid' : 'FieldsDataGrid';
      
      return `      <${gridComponent}
        ref={${child}Ref}
        initialFields={initial${childPascal}}
        columns={${child}Columns}
        createNewRow={createNew${childPascal}}
        addButtonLabel="Add ${childTitle}"
        deleteDialogTitle="Delete Selected ${childTitle}?"
        deleteDialogMessage="Are you sure you want to delete the selected item(s)? This action cannot be undone."
        showTitle={true}
        title="${childTitle}"
      />`;
    }).join('\n');
  }
  
  const hasManyToMany = children.some(c => c.relationship?.type === 'many-to-many');
  
  // Generate FormUpsert props destructuring
  const manyToManyTargets = children
    .filter(c => c.relationship?.type === 'many-to-many')
    .map(c => c.relationship!.target);
  const manyToOneTargets = parentRelationships.map(r => r.target);
  const selectionTargets = Array.from(new Set([...manyToManyTargets, ...manyToOneTargets]));
  const extraProps = selectionTargets
    .map(target => `all${toPascalCase(target)}s = []`)
    .join(', ');
  
  const formUpsertParams = extraProps 
    ? `{ src, isEdit, ${extraProps} }: FormUpsertProps`
    : `{ src, isEdit }: FormUpsertProps`;
  
  return `'use client';

import { ${hasManyToMany || hasManyToOne ? 'useMemo, ' : ''}useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import TextField from '@mui/material/TextField';${hasManyToOne ? "\nimport Autocomplete from '@mui/material/Autocomplete';" : ''}${numberProps.length > 0 ? '\nimport NumberField from \'../NumberField\';' : ''}
import { upsert${parentPascal}${canDelete ? `, remove${parentPascal}` : ''} } from '@/lib/${parent}/actions';
import type { FormUpsertProps } from '@/lib/${parent}/types';
import FormWithChildGrid from '../FormWithChildGrid';
${childImports}${dateTimeProps.length > 0 ? '\nimport dayjs, { Dayjs } from \'dayjs\';\nimport DateTimeWrapper from \'../DateTimeWrapper\';' : ''}${imageProps.length > 0 ? '\nimport ImageUpload from \'../ImageUpload\';' : ''}

export default function FormUpsert(${formUpsertParams}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
${allStates ? '\n' + allStates : ''}

${childVariables}
${parentRefs}${childGridSetup}${relationshipOptionSetups ? `\n${relationshipOptionSetups}` : ''}

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    if (isPending) return;

    const formData = new FormData();
    formData.set('id', src.id);
${parentFormDataSets}${childFormDataHandling}

    try {
      startTransition(async () => {
        await upsert${parentPascal}(formData);
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    }
  };
${canDelete ? `
  const handleDelete = async () => {
    const formData = new FormData();
    formData.set('id', src.id);
    await remove${parentPascal}(formData);
  };
` : ''}
  const handleBack = () => {
    router.push('/${parent}');
    router.refresh();
  };

  const formFields = (
    <>
${parentTextFields}${childGridComponents.length > 0 ? '\n' + childGridComponents : '' }
    </>
  );

  return (
    <FormWithChildGrid
      title={\`\${isEdit ? 'Edit' : 'Add'} ${parentTitle}\`}
      isEdit={isEdit}
      formFields={formFields}
      onSubmit={handleSubmit}
      onDelete={${canDelete ? 'isEdit ? handleDelete : undefined' : 'undefined'}}
      onBack={handleBack}
      deleteEntityLabel="${parentTitle}"
      submitButtonLabel="Save"
      error={error}
    />
  );
}
`;
}

export function generateFormView(parent: string, children: ChildInfo[], schema: Schema): string {
  const parentPascal = toPascalCase(parent);
  const parentDef = schema.definitions[parent];
  
  if (!parentDef.properties) {
    throw new Error(`Parent definition ${parent} has no properties`);
  }
  
  // Get parent properties (excluding id and timestamps)
  const parentProps = Object.keys(parentDef.properties).filter(k => 
    k !== 'id' && k !== 'created_at' && k !== 'updated_at'
  );
  
  // Separate Date and Image fields from other fields
  const dateTimeFields: string[] = [];
  const imageFields: string[] = [];
  const otherFields: string[] = [];
  
  parentProps.forEach(p => {
    const prop = parentDef.properties![p];
    const propType = Array.isArray(prop.type) ? prop.type.find(t => t !== 'null') : prop.type;
    const format = (prop as any).format;
    
    if (propType === 'string' && (format === 'date' || format === 'date-time' || format === 'time')) {
      dateTimeFields.push(p);
    } else if (propType === 'string' && format === 'uri') {
      imageFields.push(p);
    } else {
      otherFields.push(p);
    }
  });
  
  // Check if we need DateTimeWrapper or ImageDisplay imports
  const needsDateTimeWrapper = dateTimeFields.length > 0;
  const needsImageDisplay = imageFields.length > 0;
  
  const textFields = otherFields.map(p => {
    const label = p.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    return `      <TextField
        label="${label}"
        value={src.${p} || ''}
        fullWidth
        margin="normal"
        aria-readonly
      />`;
  }).join('\n');
  
  const dateTimeFieldsJsx = dateTimeFields.map(p => {
    const label = p.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    const prop = parentDef.properties![p];
    const format = (prop as any).format;
    const showTime = format === 'date-time' || format === 'time';
    
    return `      <DateTimeWrapper label="${label}" date_time={src.${p}}${showTime ? '' : ' show_time={false}'} readOnly />`;
  }).join('\n');
  
  const imageFieldsJsx = imageFields.map(p => {
    const label = p.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    
    return `      <ImageDisplay url={src.${p}} alt="${label}" />`;
  }).join('\n');
  
  const parentTextFields = [textFields, dateTimeFieldsJsx, imageFieldsJsx].filter(f => f).join('\n');
  
  // Check if any child has DateTime fields
  const needsClientDirective = children.some(childInfo => {
    const child = childInfo.name;
    const childDef = schema.definitions[child];
    if (!childDef?.properties) return false;
    
    return Object.entries(childDef.properties).some(([key, prop]) => {
      const propType = Array.isArray(prop.type) ? prop.type.find(t => t !== 'null') : prop.type;
      const format = (prop as any).format;
      return propType === 'string' && (format === 'date' || format === 'date-time' || format === 'time');
    });
  });

  // For parent-only case
  if (children.length === 0) {
    return `import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import type { FormViewProps } from '@/lib/${parent}/types';
import Link from '@mui/material/Link';${needsDateTimeWrapper ? '\nimport DateTimeWrapper from \'../DateTimeWrapper\';' : ''}${needsImageDisplay ? '\nimport ImageDisplay from \'../ImageDisplay\';' : ''}

export default function FormView({ src }: FormViewProps) {
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
    </div>
  );
}
`;
  }
  
  // For with-children case - generate view grids for all children
  const hasListChildren = children.some(c => c.outputType === 'list');
  const listImport = hasListChildren ? '\nimport ListWrapper from \'../ListWrapper\';' : '';
  
  const gridChildren = children.filter(c => c.outputType !== 'list');
  const columnImports = gridChildren.map(c => `${c.name}_columns`).join(', ');
  
  const childViewGrids = children.map(childInfo => {
    const child = childInfo.name;
    const childPascal = toPascalCase(child);
    const childTitle = toTitleCase(child);
    
    // For list output type, use ListWrapper
    if (childInfo.outputType === 'list') {
      return `      <div>
        <ListWrapper
          items={src.${childInfo.propertyName}.map(f => ({
            id: f.id,
            value: f.name,
            label: f.name,
          }))}
          itemType="text"
          showTitle={true}
          title="${childTitle}"
        />
      </div>`;
    }
    
    return `      <div>
        <h2>${childPascal}</h2>
        <FieldsViewGrid fields={src.${childInfo.propertyName}} columns={${child}Columns} />
      </div>`;
  }).join('\n');
  
  const columnVariables = gridChildren.map(childInfo => {
    const child = childInfo.name;
    return `  const ${child}Columns: GridColDef[] = ${child}_columns(false);`;
  }).join('\n');
  
  const columnImportLine = columnImports ? `\nimport { ${columnImports} } from '../${parent}/column_def';` : '';
  
  return `${needsClientDirective ? "'use client';\n\n" : ''}import { GridColDef } from '@mui/x-data-grid';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import type { FormViewProps } from '@/lib/${parent}/types';
import Link from '@mui/material/Link';
import FieldsViewGrid from '../FieldsViewGrid';${columnImportLine}${needsDateTimeWrapper ? '\nimport DateTimeWrapper from \'../DateTimeWrapper\';' : ''}${needsImageDisplay ? '\nimport ImageDisplay from \'../ImageDisplay\';' : ''}${listImport}

export default function FormView({ src }: FormViewProps) {
${columnVariables}

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
${childViewGrids}
    </div>
  );
}
`;
}

export function generatePageList(parent: string, schema: Schema): string {
  const parentPascal = toPascalCase(parent);
  const parentTitle = toTitleCase(parent);
  
  // Check for x-display configuration in the parent definition
  const parentDef = schema.definitions[parent];
  const xDisplay = (parentDef as any)?.['x-display'];
  
  let displayFieldsCode = '';
  if (xDisplay && Array.isArray(xDisplay)) {
    const fields = xDisplay.map((item: any) => {
      const fieldName = Object.keys(item)[0];
      const config = item[fieldName];
      const headerName = fieldName.split('_').map((word: string) => 
        word.charAt(0).toUpperCase() + word.slice(1)
      ).join(' ');
      const width = config?.width || 200;
      
      return `    { field: '${fieldName}', headerName: '${headerName}', width: ${width} }`;
    }).join(',\n');
    
    displayFieldsCode = ` displayFields={[\n${fields}\n  ]}`;
  }
  
  return `import { getAll${parentPascal}s } from '@/lib/${parent}/getters';
import DataGridClient from '@/components/DataGridClient';
import { remove${parentPascal} } from '@/lib/${parent}/actions';

export default async function ${parentPascal}sPage() {
  const ${parent}s = await getAll${parentPascal}s();
  return <DataGridClient src={${parent}s} basePath="/${parent}" removeAction={remove${parentPascal}} entityLabel="${parentTitle}"${displayFieldsCode} />;
}
`;
}

export function generatePageNew(parent: string, children: ChildInfo[], schema: Schema): string {
  const parentPascal = toPascalCase(parent);
  const parentDef = schema.definitions[parent];
  const parentRelationships = getParentRelationships(parentDef);
  
  if (!parentDef.properties) {
    throw new Error(`Parent definition ${parent} has no properties`);
  }
  
  // Get parent properties (excluding id and timestamps) and set default values
  const parentDefaultProps = Object.entries(parentDef.properties)
    .filter(([key]) => key !== 'id' && key !== 'created_at' && key !== 'updated_at')
    .map(([key, prop]) => {
      const propType = Array.isArray(prop.type) ? prop.type.find(t => t !== 'null') : prop.type;
      const format = (prop as any).format;
      const isRequired = parentDef.required?.includes(key);
      const isNullable = Array.isArray(prop.type) && prop.type.includes('null');
      
      // Date/DateTime/Time fields
      if (propType === 'string' && (format === 'date' || format === 'date-time' || format === 'time')) {
        return isRequired ? `    ${key}: new Date(),` : `    ${key}: null,`;
      }
      
      // Number/Integer fields
      if (propType === 'integer' || propType === 'number') {
        return isRequired ? `    ${key}: 0,` : `    ${key}: null,`;
      }
      
      // String fields
      if (propType === 'string') {
        return `    ${key}: '',`;
      }
      
      // Default to null for other types
      return `    ${key}: null,`;
    })
    .join('\n');
  
  // Build children properties
  const childrenProps = children.map(c => `    ${c.propertyName}: [],`).join('\n');
  
  // Generate imports and fetching for relationship selections (many-to-many and many-to-one)
  const manyToManyChildren = children.filter(c => c.relationship?.type === 'many-to-many');
  const manyToManyTargets = manyToManyChildren
    .map(c => c.relationship!.target)
    .filter((target, index, self) => self.indexOf(target) === index);

  const manyToOneTargets = parentRelationships
    .map(r => r.target)
    .filter((target, index, self) => self.indexOf(target) === index);

  const selectionTargets = Array.from(new Set([...manyToManyTargets, ...manyToOneTargets]));

  const selectionImports = selectionTargets.length > 0
    ? selectionTargets
        .map(target => `import { getAll${toPascalCase(target)}s } from '@/lib/${target}/getters';`)
        .join('\n')
    : '';
  
  const selectionFetches = selectionTargets.length > 0
    ? selectionTargets
        .map(target => `  const all${toPascalCase(target)}s = await getAll${toPascalCase(target)}s();`)
        .join('\n')
    : '';
  
  const selectionProps = selectionTargets.length > 0
    ? ' ' + selectionTargets
        .map(target => `all${toPascalCase(target)}s={all${toPascalCase(target)}s}`)
        .join(' ')
    : '';
  
  return `import FormUpsert from '@/components/${parent}/FormUpsert';${selectionImports ? '\n' + selectionImports : ''}

export default async function Add${parentPascal}Page() {${selectionFetches ? '\n' + selectionFetches : ''}
  const src = {
    id: '',
${parentDefaultProps}${childrenProps ? `\n${childrenProps}` : ''}
  };
  return <FormUpsert src={src} isEdit={false}${selectionProps} />;
}
`;
}

export function generatePageEdit(parent: string, children: ChildInfo[], schema: Schema): string {
  const parentPascal = toPascalCase(parent);
  const parentDef = schema.definitions[parent];
  const parentRelationships = getParentRelationships(parentDef);
  
  // Generate imports and fetching for many-to-many relationships
  const manyToManyChildren = children.filter(c => c.relationship?.type === 'many-to-many');
  const manyToManyTargets = manyToManyChildren
    .map(c => c.relationship!.target)
    .filter((target, index, self) => self.indexOf(target) === index);

  const manyToOneTargets = parentRelationships
    .map(r => r.target)
    .filter((target, index, self) => self.indexOf(target) === index);

  const selectionTargets = Array.from(new Set([...manyToManyTargets, ...manyToOneTargets]));

  const selectionImports = selectionTargets.length > 0
    ? '\n' + selectionTargets
        .map(target => `import { getAll${toPascalCase(target)}s } from '@/lib/${target}/getters';`)
        .join('\n')
    : '';
  
  const hasSelections = selectionTargets.length > 0;
  
  const promiseAllFetches = hasSelections
    ? `  const [${parent}, ${selectionTargets.map(t => `all${toPascalCase(t)}s`).join(', ')}] = await Promise.all([
    get${parentPascal}Detail(id),
    ${selectionTargets.map(t => `getAll${toPascalCase(t)}s()`).join(',\n    ')},
  ]);`
    : `  const ${parent} = await get${parentPascal}Detail(id);`;
  
  const selectionProps = hasSelections
    ? ' ' + selectionTargets
        .map(target => `all${toPascalCase(target)}s={all${toPascalCase(target)}s}`)
        .join(' ')
    : '';
  
  return `import FormUpsert from '@/components/${parent}/FormUpsert';
import { get${parentPascal}Detail } from '@/lib/${parent}/getters';${selectionImports}
import { ${parentPascal}DetailPageProps } from '@/lib/${parent}/types';
import { notFound } from 'next/navigation';

export default async function Edit${parentPascal}Page({ params }: ${parentPascal}DetailPageProps) {
  const { id } = await params;
${promiseAllFetches}
  if (!${parent}) {
    notFound();
  }
  return <FormUpsert src={${parent}} isEdit={true}${selectionProps} />;
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
