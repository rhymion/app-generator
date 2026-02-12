import type { Schema, SchemaProperty, SchemaDefinition, GenerateConfig } from './types';

// Import helper functions
import {
  toCamelCase,
  toPascalCase,
  toTitleCase,
  safeVarName,
  singularize,
  toPascalCaseFromVar,
} from './helpers/naming';
import { getTsType, mapJsonTypeToTs } from './helpers/type-mapping';
import {
  getDetailProperties,
  getDetailRelationName,
  getParentRelationships,
  filterFields,
  type ParentRelationshipMeta,
  type DetailPropertyMap,
} from './helpers/schema-helpers';
import {
  childVarName,
  childPascalName,
  childTitle,
  childColumnsFnName,
  childSingularVarName,
  childSingularPascalName,
  childFormKey,
  type ChildInfo,
  type RelationshipInfo,
} from './helpers/child-helpers';

// Re-export types for backward compatibility
export type { ChildInfo, RelationshipInfo } from './helpers/child-helpers';

export function generateTypes(parent: string, children: ChildInfo[], schema: Schema, modelName?: string, definitionKey?: string, generateConfig?: any): string {
  const model = modelName ?? parent;
  const defKey = definitionKey ?? `${parent}_detail`;
  const parentPascal = toPascalCase(parent);

  const modelDef = schema.definitions[model];
  const filteredProps = filterFields(modelDef.properties ?? {}, generateConfig?.fields);
  const parentRelationships = getParentRelationships({ ...modelDef, properties: filteredProps });
  const relationshipTargets = Array.from(
    new Map(parentRelationships.map(r => [r.target, r])).values()
  );

  const parentProps: string[] = [];
  const parentExtraProps: string[] = [];
  const formViewExtraProps: string[] = [];

  relationshipTargets.forEach((rel) => {
    const targetPascal = toPascalCase(rel.target);
    const relationName = getDetailRelationName(parent, rel.target, schema, defKey);
    parentExtraProps.push(`  ${relationName}?: ${targetPascal} | null;`);
    formViewExtraProps.push(`    ${relationName}?: ${targetPascal} | null;`);
  });

  // Generate parent type
  if (filteredProps) {
    for (const [key, prop] of Object.entries(filteredProps)) {
      const tsType = getTsType(prop);
      parentProps.push(`  ${key}: ${tsType};`);
    }
  }

  // Get parent properties for FormViewProps (excluding timestamps)
  const formViewParentProps = filteredProps
    ? Object.entries(filteredProps)
          .filter(([key]) => key !== 'created_at' && key !== 'updated_at' && key !== 'creator_id')
        .map(([key, prop]) => `    ${key}: ${getTsType(prop)};`)
        .join('\n')
    : '';

  // Build type definitions
  const importLines = relationshipTargets.length > 0
    ? relationshipTargets
        .filter(r => r.target !== model)
        .map(r => `import type { ${toPascalCase(r.target)} } from '@/lib/${r.target}/types';`)
        .join('\n') + '\n\n'
    : '';

  let result = `import type { ModelPermissions } from '@/lib/authz';

${importLines}export type ${parentPascal} = {
${parentProps.join('\n')}
${parentExtraProps.join('\n')}
};

`;

  // Add option types for many-to-one relationships
  if (relationshipTargets.length > 0) {
    const optionTypes = relationshipTargets
      .filter(r => r.target !== model)
      .map(r => {
        const targetPascal = toPascalCase(r.target);
        const labelField = r.labelField ?? 'name';
        return `export type ${targetPascal}Option = {\n  id: string;\n  ${labelField}: string;\n};`;
      })
      .join('\n\n');

    if (optionTypes) {
      result += `${optionTypes}\n\n`;
    }
  }
  
  // Generate child types
  const childTypeDeclarations: string[] = [];
  const detailChildProps: string[] = [];
  const formViewChildProps: string[] = [];
  const declaredChildTypes = new Set<string>();
  
  for (const child of children) {
    const childPascal = toPascalCase(child.name);
    const childDef = schema.definitions[child.name];
    
    if (childDef?.properties) {
      const childProps: string[] = [];
      for (const [key, prop] of Object.entries(childDef.properties)) {
        const tsType = getTsType(prop);
        childProps.push(`  ${key}: ${tsType};`);
      }
      
      if (!declaredChildTypes.has(child.name) && child.name !== model) {
        declaredChildTypes.add(child.name);
        childTypeDeclarations.push(`export type ${childPascal} = {
${childProps.join('\n')}
};
`);
      }
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
${formViewParentProps}${formViewExtraProps.length > 0 ? `\n${formViewExtraProps.join('\n')}` : ''}`;
  
  if (children.length > 0) {
    result += `\n${formViewChildProps.join('\n')}`;
  }
  
  result += `
  };
  permissions?: ModelPermissions;
}>;

export type FormUpsertProps = Readonly<FormViewProps & {
  isEdit: boolean;${(() => {
    const manyToManyTargets = Array.from(new Set(children.filter(c => c.relationship?.type === 'many-to-many').map(c => c.relationship!.target)));
    const manyToOneTargets = Array.from(new Set(relationshipTargets.map(r => r.target)));
    const combinedTargets = Array.from(new Set([...manyToManyTargets, ...manyToOneTargets]));
    return combinedTargets.map(target => {
      const targetPascal = toPascalCase(target);
      return `\n  all${targetPascal}s?: ${targetPascal}[];`;
    }).join('');
  })()}
${Array.from(new Set([
  ...children.filter(c => c.relationship?.type === 'many-to-many').map(c => c.relationship!.target),
  ...relationshipTargets.map(r => r.target)
])).map(target => {
    const targetCamel = toCamelCase(target);
    return `\n  ${targetCamel}Permissions?: ModelPermissions;`;
  }).join('')}
}>;
`;

  return result;
}

export function generateGetters(parent: string, children: ChildInfo[], schema: Schema, generateConfig?: any, modelName?: string, definitionKey?: string): string {
  const model = modelName ?? parent;
  const defKey = definitionKey ?? `${parent}_detail`;
  const parentPascal = toPascalCase(parent);
  const parentCamel = toCamelCase(parent);

  const modelDef = schema.definitions[model];
  const filteredProps = filterFields(modelDef.properties ?? {}, generateConfig?.fields);
  const parentRelationships = getParentRelationships({ ...modelDef, properties: filteredProps }).map((rel) => ({
    ...rel,
    relationName: getDetailRelationName(parent, rel.target, schema, defKey),
  }));
  const hasOrganizationRelationship = parentRelationships.some(r => r.target === 'organization');
  const shouldFilterByOrganization = hasOrganizationRelationship && model !== 'organization' && model !== 'user_account';

  // Get all parent properties except timestamps
  const parentProps = filteredProps
    ? Object.keys(filteredProps).filter(k =>
        k !== 'created_at' && k !== 'updated_at' && k !== 'creator_id'
      )
    : [];
  const parentMapping = parentProps.map(p => `    ${p}: ${parentCamel}.${p},`).join('\n');
  const relationshipMapping = parentRelationships
    .map(r => `    ${r.relationName}: ${parentCamel}.${r.relationName},`)
    .join('\n');
  
  // Build include for list (many-to-one only)
  const includeEntriesList = [
    ...parentRelationships.map(r => `${r.relationName}: true`),
  ].filter(Boolean);
  const includePropsList = includeEntriesList.length > 0 ? includeEntriesList.join(', ') : '';

  // Build include for detail (children + many-to-one)
  const includeEntriesDetail = [
    ...children.map(c => `${c.propertyName}: true`),
    ...parentRelationships.map(r => `${r.relationName}: true`),
  ].filter(Boolean);
  const includePropsDetail = includeEntriesDetail.length > 0 ? includeEntriesDetail.join(', ') : '';
  
  const childMappings = children.length > 0
    ? children.map(c => `    ${c.propertyName}: ${parentCamel}.${c.propertyName},`).join('\n')
    : '';
  
  return `'use server';

import prisma from '@/lib/prisma';
import type { ${parentPascal}, ${parentPascal}Detail } from '@/lib/${parent}/types';
import type { ModelPermissions } from '@/lib/authz';
import { assertPermission, getModelPermissions } from '@/lib/authz';
import type { Operation } from '@/lib/authz';
import { getServerSession } from 'next-auth/next';${shouldFilterByOrganization ? "\nimport { getAssociatedOrganizationListPageData } from '@/lib/organization/getters_associated';" : ''}

export async function getAll${parentPascal}s(): Promise<${parentPascal}[]> {
${shouldFilterByOrganization ? `  const associatedOrganizations = await getAssociatedOrganizationListPageData();
  const associatedOrganizationIds = associatedOrganizations.organizations.map((organization) => organization.id);
` : ''}
  const ${parentCamel}s = await prisma.${model}.findMany({${shouldFilterByOrganization ? `
    where: {
      organization_id: { in: associatedOrganizationIds },
    },` : ''}${includePropsList ? `
    include: { ${includePropsList.split(', ').join(', ')} },` : ''}
  });
  return ${parentCamel}s.map((${parentCamel}) => ({
${parentMapping}${relationshipMapping ? `
${relationshipMapping}` : ''}
  }));
}

export async function get${parentPascal}Detail(id: string): Promise<${parentPascal}Detail | null> {
  ${shouldFilterByOrganization ? `  const associatedOrganizations = await getAssociatedOrganizationListPageData();
  const associatedOrganizationIds = associatedOrganizations.organizations.map((organization) => organization.id);
` : ''}
  const ${parentCamel} = await prisma.${model}.${shouldFilterByOrganization ? 'findFirst' : 'findUnique'}({
    where: { 
      id,${shouldFilterByOrganization ? `
      organization_id: { in: associatedOrganizationIds },` : ''}
    },${includePropsDetail ? `
    include: { 
      ${includePropsDetail.split(', ').join(', \n      ')} 
    },` : ''}
  });

  if (!${parentCamel}) {
    return null;
  }

  return {
    ...${parentCamel},${childMappings ? `
${childMappings}` : ''}${relationshipMapping ? `
${relationshipMapping}` : ''}
  };
}

export async function get${parentPascal}ListPageData(isAssertPermission: boolean = true) {
  const userPermissions = await getModelPermissions('${model}');
  if (isAssertPermission) {
    await assertPermission(userPermissions, 'read', '${model}');
  }
  const ${parentCamel}s = await getAll${parentPascal}s();
  return { ${parentCamel}s, userPermissions };
}

export async function get${parentPascal}DetailPageData(id: string, operation: Operation = 'read') {
  const userPermissions = await getModelPermissions('${model}');
  await assertPermission(userPermissions, operation, '${model}');
  const ${parentCamel} = await get${parentPascal}Detail(id);
  return { ${parentCamel}, userPermissions };
}

export async function get${parentPascal}NewPageAccessCheck() {
  const userPermissions = await getModelPermissions('${model}');
  await assertPermission(userPermissions, 'create', '${model}');
  return userPermissions;
}
`;
}

export function generateActions(parent: string, children: ChildInfo[], schema: Schema, generateConfig?: any, modelName?: string): string {
  const model = modelName ?? parent;
  const parentPascal = toPascalCase(parent);
  const modelDef = schema.definitions[model];
  const filteredProps = filterFields(modelDef.properties ?? {}, generateConfig?.fields);
  const canCreate = generateConfig?.new !== false;
  const canUpdate = generateConfig?.edit !== false;
  const canDelete = generateConfig?.delete !== false;
  const parentRelationships = getParentRelationships({ ...modelDef, properties: filteredProps });
  const selfParentRel = parentRelationships.find((rel) => rel.target === model);
  const selfParentProp = selfParentRel?.propName ?? null;

  // Get parent properties (excluding id and timestamps)
  const parentProps = filteredProps
    ? Object.keys(filteredProps).filter(k =>
        k !== 'id' && k !== 'created_at' && k !== 'updated_at' && k !== 'creator_id'
      )
    : [];

  // Generate FormData.get statements for parent properties
  const parentPropInfos = filteredProps
    ? parentProps.map(p => ({
        prop: p,
        varName: safeVarName(p),
        def: filteredProps[p]
      }))
    : [];

  const formDataGets = filteredProps
    ? parentPropInfos.map(({ prop, varName, def }) => {
        const propType = Array.isArray(def.type) ? def.type.find(t => t !== 'null') : def.type;
        const isNullable = Array.isArray(def.type) && def.type.includes('null');
        const format = (def as any).format;
        const pattern = (def as any).pattern;
        
        // Handle Date/DateTime/Time fields
        if (propType === 'string' && (format === 'date' || format === 'date-time' || format === 'time')) {
          if (isNullable) {
            return `  const ${varName}Str = data.get('${prop}') as string | null;\n  const ${varName} = ${varName}Str ? new Date(${varName}Str) : null;`;
          } else {
            return `  const ${varName}Str = data.get('${prop}') as string;\n  const ${varName} = new Date(${varName}Str);`;
          }
        }

        // Handle boolean fields
        if (propType === 'boolean') {
          return `  const ${varName} = data.get('${prop}') === 'true';`;
        }
        
        // Handle number fields
        if (propType === 'integer' || propType === 'number') {
          return `  const ${varName} = Number(data.get('${prop}'));`;
        }
        
        if (propType === 'string' && pattern === '^c[a-z0-9]{24,}$' && isNullable) {
          return `  const ${varName} = (data.get('${prop}') as string | null) || null;`;
        }
        
        // Handle string and other fields
        return `  const ${varName} = data.get('${prop}') as string${isNullable ? ' | null' : ''};`;
      }).join('\n')
    : '';
  
  const parentParams = parentPropInfos.map(p => p.varName).join(', ');
  const parentParamsWithTypes = filteredProps
    ? parentPropInfos.map(p => {
        const tsType = getTsType(p.def);
        return `${p.varName}: ${tsType}`;
      }).join(', ')
    : '';

  const parentDataObj = parentPropInfos.map(p => `      ${p.prop}: ${p.varName},`).join('\n');

  const normalizeKind = (def: SchemaProperty): 'date' | 'number' | 'boolean' | 'string' | 'other' => {
    const propType = Array.isArray(def.type) ? def.type.find(t => t !== 'null') : def.type;
    const format = (def as any).format;

    if (propType === 'string' && (format === 'date' || format === 'date-time' || format === 'time')) {
      return 'date';
    }
    if (propType === 'integer' || propType === 'number') {
      return 'number';
    }
    if (propType === 'boolean') {
      return 'boolean';
    }
    if (propType === 'string') {
      return 'string';
    }
    return 'other';
  };

  const snapshotFieldMappings = parentPropInfos
    .map(({ prop, def }) => `    ${prop}: normalizeValue(safeSnapshot.${prop}, '${normalizeKind(def)}'),`)
    .join('\n');
  const snapshotChildMappings = children.length > 0
    ? children.map(childInfo => `    ${childInfo.propertyName}: normalizeChildRefs(safeSnapshot.${childInfo.propertyName}),`).join('\n')
    : '';
  const snapshotIncludeProps = children.length > 0
    ? `,\n    include: {\n      ${children.map(childInfo => `${childInfo.propertyName}: { select: { id: true } }`).join(',\n      ')}\n    }`
    : '';
  
  // For parent-only, generate simple CRUD
  if (children.length === 0) {
    const serviceImports = [
      canCreate ? `add${parentPascal}` : '',
      canUpdate ? `update${parentPascal}` : '',
      canDelete ? `delete${parentPascal}` : '',
    ].filter(Boolean).join(', ');

    // Build upsert body based on which operations are enabled
    let upsertBody = '';
    if (canCreate && canUpdate) {
      upsertBody = `  const id = data.get('id') as string | null;
  const srcSnapshotRaw = data.get('__src_snapshot') as string | null;
  if (id) {
    await requirePermission('${model}', 'update');
  } else {
    await requirePermission('${model}', 'create');
  }
${formDataGets}

  if (id) {
    await update${parentPascal}(id, ${parentParams}, srcSnapshotRaw);
  } else {
    const creatorId = await getSessionUserIdOrThrow();
    await add${parentPascal}(creatorId, ${parentParams});
  }`;
    } else if (canUpdate) {
      upsertBody = `  const id = data.get('id') as string | null;
  const srcSnapshotRaw = data.get('__src_snapshot') as string | null;
  if (!id) throw new Error('Create not supported');
  await requirePermission('${model}', 'update');
${formDataGets}

  await update${parentPascal}(id, ${parentParams}, srcSnapshotRaw);`;
    } else if (canCreate) {
      upsertBody = `  await requirePermission('${model}', 'create');
${formDataGets}

  const creatorId = await getSessionUserIdOrThrow();
  await add${parentPascal}(creatorId, ${parentParams});`;
    }

    return `'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { getSessionUserIdOrThrow, requirePermission } from '@/lib/authz';${serviceImports ? `\nimport { ${serviceImports} } from './service';` : ''}
${(canCreate || canUpdate) ? `
export async function upsert${parentPascal}(data: FormData) {
${upsertBody}

  revalidatePath('/');
  redirect('/${parent}');
}
` : ''}${canDelete ? `
export async function remove${parentPascal}(data: FormData | string[]) {
  await requirePermission('${model}', 'delete');
  const ids = Array.isArray(data) ? data : [data.get('id') as string];
  await delete${parentPascal}(ids);
  revalidatePath('/');
  redirect('/${parent}');
}
` : ''}`;
  }
  
  // For with-children cases, handle all children
  const allChildrenData = children.map(childInfo => {
    const child = childInfo.name;
    const childVar = childVarName(childInfo);
    const childPascal = childPascalName(childInfo);
    const childDef = schema.definitions[child];
    const isManyToMany = childInfo.relationship?.type === 'many-to-many';
    const useConnect = isManyToMany || child === model;

    if (!childDef?.properties) {
      throw new Error(`Child definition ${child} has no properties`);
    }

    const parentIdPropNames = new Set<string>();
    if (child === model) {
      parentRelationships
        .filter(rel => rel.target === model)
        .forEach(rel => parentIdPropNames.add(rel.propName));
    } else {
      parentIdPropNames.add(`${model}_id`);
    }

    const childProps = Object.keys(childDef.properties).filter(k => 
      k !== 'id' && !parentIdPropNames.has(k) && k !== 'created_at' && k !== 'updated_at' && k !== 'creator_id'
    );
    
    const childPropsWithId = Object.keys(childDef.properties).filter(k => 
      !parentIdPropNames.has(k) && k !== 'created_at' && k !== 'updated_at' && k !== 'creator_id'
    );
    
    const fieldType = `{ ${childProps.map(p => `${p}: ${getTsType(childDef.properties![p])}`).join('; ')} }`;
    const fieldTypeWithId = `{ ${childPropsWithId.map(p => `${p.replace(/id/, 'id?')}: ${getTsType(childDef.properties![p])}`).join('; ')} }`;
    
    const fieldMapCreate = childProps.map(p => `          ${p}: f.${p},`).join('\n');
    
    return {
      child,
      childVar,
      childPascal,
      fieldType,
      fieldTypeWithId,
      fieldMapCreate,
      isManyToMany,
      useConnect,
      propertyName: childInfo.propertyName,
      formKey: childFormKey(childInfo),
      outputType: childInfo.outputType,
    };
  });
  
  // Generate FormData extraction for all children
  const childFormDataExtractions = allChildrenData.map(({ childVar, fieldTypeWithId, isManyToMany, useConnect, formKey }) => {
    if (useConnect) {
      // For connect-only relationships, extract IDs (only id and name fields)
      const childItemVar = singularize(childVar);
      const childItemId = `${childItemVar}Id`;
      return `  const ${childVar}Raw = data.getAll('${formKey}[]') as string[];\n  const ${childVar}Items = ${childVar}Raw.map(f => JSON.parse(f) as { id?: string; name?: string });\n  const ${childVar}Ids = ${childVar}Items\n    .map((${childItemVar}) => ${childItemVar}.id)\n    .filter((${childItemId}): ${childItemId} is string => Boolean(${childItemId}));`;
    } else {
      return `  const ${childVar}Raw = data.getAll('${formKey}[]') as string[];\n  const ${childVar}Items = ${childVar}Raw.map(f => JSON.parse(f) as ${fieldTypeWithId});`;
    }
  }).join('\n');

  const selfChildValidation = selfParentProp
    ? allChildrenData
        .filter((childInfo) => childInfo.child === model && childInfo.outputType === 'list' && !childInfo.isManyToMany)
        .map((childInfo) => `
  if (${childInfo.childVar}Ids.length > 0) {
    if (id && ${childInfo.childVar}Ids.includes(id)) {
      throw new Error('Cannot set an item as its own child.');
    }
    const invalid${childInfo.childPascal} = await prisma.${model}.findMany({
      where: id
        ? {
            id: { in: ${childInfo.childVar}Ids },
            AND: [
              { ${selfParentProp}: { not: null } },
              { NOT: { ${selfParentProp}: id } },
            ],
          }
        : {
            id: { in: ${childInfo.childVar}Ids },
            ${selfParentProp}: { not: null },
          },
      select: { id: true },
    });

    if (invalid${childInfo.childPascal}.length > 0) {
      throw new Error('One or more selected children already belong to another parent.');
    }
  }
`)
        .join('')
    : '';
  
  const childParamsForAdd = allChildrenData.map(({ childVar, fieldType, useConnect }) => 
    useConnect ? `${childVar}Ids: string[]` : `${childVar}Items: ${fieldType}[]`
  ).join(', ');
  const childParamsForUpdate = allChildrenData.map(({ childVar, fieldTypeWithId, useConnect }) => 
    useConnect ? `${childVar}Ids: string[]` : `${childVar}Items: ${fieldTypeWithId}[]`
  ).join(', ');
  const childArgsForCall = allChildrenData.map(({ childVar, useConnect }) => 
    useConnect ? `${childVar}Ids` : `${childVar}Items`
  ).join(', ');
  
  // Generate nested create for all children
  const childNestedCreate = allChildrenData.map(({ propertyName, childVar, fieldMapCreate, useConnect }) => {
    if (useConnect) {
      return `      ${propertyName}: {\n        connect: ${childVar}Ids.map((id) => ({ id })),\n      },`;
    } else {
      return `      ${propertyName}: {\n        create: ${childVar}Items.map(f => ({\n${fieldMapCreate}\n        })),\n      },`;
    }
  }).join('\n');
  
  // Generate nested update (deleteMany + create for one-to-many, set for many-to-many)
  const childNestedUpdate = allChildrenData.map(({ propertyName, childVar, fieldMapCreate, useConnect }) => {
    if (useConnect) {
      return `      ${propertyName}: {\n        set: ${childVar}Ids.map((id) => ({ id })),\n      },`;
    } else {
      return `      ${propertyName}: {\n        deleteMany: {},\n        create: ${childVar}Items.map(f => ({\n${fieldMapCreate}\n        })),\n      },`;
    }
  }).join('\n');
  
  const serviceImportsWithChildren = [
    canCreate ? `add${parentPascal}` : '',
    canUpdate ? `update${parentPascal}` : '',
    canDelete ? `delete${parentPascal}` : '',
  ].filter(Boolean).join(', ');

  const childArgs = `${parentParams && childArgsForCall ? ', ' : ''}${childArgsForCall}`;

  // Build upsert body based on which operations are enabled
  let upsertBodyWithChildren = '';
  if (canCreate && canUpdate) {
    upsertBodyWithChildren = `  const id = data.get('id') as string | null;
  const srcSnapshotRaw = data.get('__src_snapshot') as string | null;
  if (id) {
    await requirePermission('${model}', 'update');
  } else {
    await requirePermission('${model}', 'create');
  }
${formDataGets}
${childFormDataExtractions}

  if (id) {
    await update${parentPascal}(id, ${parentParams}${childArgs}, srcSnapshotRaw);
  } else {
    const creatorId = await getSessionUserIdOrThrow();
    await add${parentPascal}(creatorId, ${parentParams}${childArgs});
  }`;
  } else if (canUpdate) {
    upsertBodyWithChildren = `  const id = data.get('id') as string | null;
  const srcSnapshotRaw = data.get('__src_snapshot') as string | null;
  if (!id) throw new Error('Create not supported');
  await requirePermission('${model}', 'update');
${formDataGets}
${childFormDataExtractions}

  await update${parentPascal}(id, ${parentParams}${childArgs}, srcSnapshotRaw);`;
  } else if (canCreate) {
    upsertBodyWithChildren = `  await requirePermission('${model}', 'create');
${formDataGets}
${childFormDataExtractions}

  const creatorId = await getSessionUserIdOrThrow();
  await add${parentPascal}(creatorId, ${parentParams}${childArgs});`;
  }

  return `'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { getSessionUserIdOrThrow, requirePermission } from '@/lib/authz';${serviceImportsWithChildren ? `\nimport { ${serviceImportsWithChildren} } from './service';` : ''}
${(canCreate || canUpdate) ? `
export async function upsert${parentPascal}(data: FormData) {
${upsertBodyWithChildren}

  revalidatePath('/');
  redirect('/${parent}');
}
` : ''}${canDelete ? `
export async function remove${parentPascal}(data: FormData | string[]) {
  await requirePermission('${model}', 'delete');
  const ids = Array.isArray(data) ? data : [data.get('id') as string];
  await delete${parentPascal}(ids);
  revalidatePath('/');
  redirect('/${parent}');
}
` : ''}`;
}

export function generateColumnDef(parent: string, children: ChildInfo[], schema: Schema, modelName?: string, definitionKey?: string): string {
  const model = modelName ?? parent;
  if (children.length === 0) {
    return '';
  }
  
  const columnFunctions = children.map(childInfo => {
    const child = childInfo.name;
    const childSnake = childInfo.propertyName;
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
      if (key === 'id' || key === `${model}_id` || key === 'created_at' || key === 'updated_at' || key === 'creator_id') {
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
        width = 50;
        columns.push(`    { field: '${key}', headerName: 'No.', width: ${width}, editable: false${typeStr} },`);
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

export function generateFormUpsert(parent: string, children: ChildInfo[], schema: Schema, generateConfig?: any, modelName?: string, definitionKey?: string): string {
  const model = modelName ?? parent;
  const defKey = definitionKey ?? `${parent}_detail`;
  const parentPascal = toPascalCase(parent);
  const parentTitle = toTitleCase(parent);
  const modelDef = schema.definitions[model];
  const filteredProps = filterFields(modelDef.properties ?? {}, generateConfig?.fields);
  const canDelete = generateConfig?.delete !== false;
  const parentRelationships = getParentRelationships({ ...modelDef, properties: filteredProps }).map((rel) => ({
    ...rel,
    relationName: getDetailRelationName(parent, rel.target, schema, defKey),
  }));
  const selfParentRel = parentRelationships.find((rel) => rel.target === model);
  const selfParentProp = selfParentRel?.propName ?? null;

  if (!filteredProps || Object.keys(filteredProps).length === 0) {
    throw new Error(`Model definition ${model} has no properties`);
  }

  // Get parent properties (excluding id and timestamps)
  const parentProps = Object.keys(filteredProps).filter(k =>
    k !== 'id' && k !== 'created_at' && k !== 'updated_at' && k !== 'creator_id'
  );
  const relationshipProps = parentRelationships.map(r => r.propName);
  const nonRelationshipProps = parentProps.filter(p => !relationshipProps.includes(p));

  // Categorize parent properties by type
  const dateTimeProps: string[] = [];
  const numberProps: string[] = [];
  const imageProps: string[] = [];
  const booleanProps: string[] = [];
  const textProps: string[] = [];

  nonRelationshipProps.forEach(p => {
    const prop = filteredProps[p];
    const propType = Array.isArray(prop.type) ? prop.type.find(t => t !== 'null') : prop.type;
    const format = (prop as any).format;
    
    if (propType === 'string' && (format === 'date' || format === 'date-time' || format === 'time')) {
      dateTimeProps.push(p);
    } else if (propType === 'integer' || propType === 'number') {
      numberProps.push(p);
    } else if (propType === 'boolean') {
      booleanProps.push(p);
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
  const dateTimeStates = dateTimeProps.map(p => {
    const stateName = safeVarName(p);
    const stateSetter = toPascalCaseFromVar(stateName);
    return `  const [${stateName}, set${stateSetter}] = useState<Dayjs | null>(src.${p} ? dayjs(src.${p}) : null);`;
  }).join('\n');
  
  const imageStates = imageProps.map(p => {
    const stateName = safeVarName(p);
    const stateSetter = toPascalCaseFromVar(stateName);
    return `  const [${stateName}, set${stateSetter}] = useState<string>(src.${p} || '');`;
  }).join('\n');

  const booleanStates = booleanProps.map(p => {
    const stateName = safeVarName(p);
    const stateSetter = toPascalCaseFromVar(stateName);
    return `  const [${stateName}, set${stateSetter}] = useState<boolean>(Boolean(src.${p}));`;
  }).join('\n');
  
  const relationshipStates = parentRelationships.map(r => {
    const stateName = safeVarName(r.propName);
    const stateSetter = toPascalCaseFromVar(stateName);
    return `  const [${stateName}, set${stateSetter}] = useState<string | null>(src.${r.propName} || null);`;
  }).join('\n');

  const allStates = [dateTimeStates, imageStates, booleanStates, relationshipStates].filter(s => s).join('\n');
  
  // Generate form fields
  const textFields = textProps.map(p => {
    const prop = filteredProps[p];
    const isRequired = modelDef.required?.includes(p);
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
    const stateName = safeVarName(r.propName);
    const stateSetter = toPascalCaseFromVar(stateName);
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
    const prop = filteredProps[p];
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
    const camelCase = safeVarName(p);
    const pascalCase = toPascalCaseFromVar(camelCase);
    
    return `      <DateTimeWrapper 
        label="${label}" 
        date_time={${camelCase} ? ${camelCase}.toDate() : null}
        onChange={(newValue: dayjs.Dayjs | null) => set${pascalCase}(newValue)}
      />`;
  }).join('\n');
  
  const imageFields = imageProps.map(p => {
    const camelCase = safeVarName(p);
    const pascalCase = toPascalCaseFromVar(camelCase);
    
    return `      <ImageUpload
        value={${camelCase}}
        onChange={set${pascalCase}}
      />`;
  }).join('\n');
  
  const booleanFields = booleanProps.map(p => {
    const label = p.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    const stateName = safeVarName(p);
    const stateSetter = toPascalCaseFromVar(stateName);
    return `      <FormControlLabel
        control={<Checkbox checked={${stateName}} onChange={(e) => set${stateSetter}(e.target.checked)} />}
        label="${label}"
      />`;
  }).join('\n');

  const parentTextFields = [textFields, relationshipFields, numberFields, booleanFields, dateTimeFields, imageFields].filter(f => f).join('\n');
  
  // Generate FormData sets
  const textFormDataSets = textProps.map(p => 
    `    formData.set('${p}', ${p}Ref.current?.value || '');`
  ).join('\n');
  
  const numberFormDataSets = numberProps.map(p => 
    `    formData.set('${p}', ${p}Ref.current?.value || '');`
  ).join('\n');
  
  const dateTimeFormDataSets = dateTimeProps.map(p => {
    const camelCase = safeVarName(p);
    return `    formData.set('${p}', ${camelCase}?.toISOString() || '');`;
  }).join('\n');
  
  const imageFormDataSets = imageProps.map(p => {
    const camelCase = safeVarName(p);
    return `    formData.set('${p}', ${camelCase});`;
  }).join('\n');
  
  const relationshipFormDataSets = parentRelationships.map(r => {
    const stateName = safeVarName(r.propName);
    return `    formData.set('${r.propName}', ${stateName} || '');`;
  }).join('\n');

  const booleanFormDataSets = booleanProps.map(p => {
    const stateName = safeVarName(p);
    return `    formData.set('${p}', ${stateName}.toString());`;
  }).join('\n');

  const parentFormDataSets = [textFormDataSets, relationshipFormDataSets, numberFormDataSets, booleanFormDataSets, dateTimeFormDataSets, imageFormDataSets].filter(s => s).join('\n');
  
  // Determine if we have children
  const hasChildren = children.length > 0;
  const hasManyToOne = parentRelationships.length > 0;
  
  const relationshipOptionSetups = parentRelationships.map(r => {
    const targetPascal = toPascalCase(r.target);
    const labelField = r.labelField ?? 'name';
    const stateName = safeVarName(r.propName);
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
    const columnImports = children
      .filter(c => c.outputType !== 'list' && c.relationship?.type !== 'many-to-many')
      .map(c => childColumnsFnName(c))
      .join(', ');
    
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
  ${columnImports ? `import { ${columnImports} } from '../${parent}/column_def';` : ''}`;
    
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
      const childVar = childVarName(childInfo);
      const refType = (childInfo.outputType === 'list' || childInfo.relationship?.type === 'many-to-many')
        ? '{ getItems: () => EditableListWrapperItem[] }'
        : '{ getFields: () => GridRowsProp }';
      return `  const ${childVar}Ref = useRef<${refType}>(null);`;
    }).join('\n');
    
    const allChildSetups = children.map(childInfo => {
      const child = childInfo.name;
      const childVar = childVarName(childInfo);
      const childPascal = childPascalName(childInfo);
      const childDef = schema.definitions[child];
      
      if (!childDef?.properties) {
        throw new Error(`Child definition ${child} has no properties`);
      }
      
      const childProps = Object.keys(childDef.properties).filter(k => 
        k !== 'id' && k !== `${model}_id` && k !== 'created_at' && k !== 'updated_at' && k !== 'creator_id'
      );
      
      const useConnectSelection = childInfo.relationship?.type === 'many-to-many'
        || (childInfo.outputType === 'list' && childInfo.name === model);

      // For connect/select relationships (many-to-many or self list)
      if (useConnectSelection) {
        return `  const initial${childPascal}: EditableListWrapperItem[] = src.${childInfo.propertyName}.map(f => ({
    id: f.id || \`temp-\${Date.now()}-\${Math.random()}\`,
    value: f.id,
    label: f.name,
    originalId: f.id,
  }));`;
      }
      
      // For list output type, generate different initialization
      if (childInfo.outputType === 'list') {
        if (childInfo.fileType) {
          // File-type list child: value=path, label=name
          return `  const initial${childPascal}: EditableListWrapperItem[] = src.${childInfo.propertyName}.map(f => ({
    id: f.id || \`temp-\${Date.now()}-\${Math.random()}\`,
    value: f.path,
    label: f.name,
    originalId: f.id,
  }));`;
        }
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
      
      return `  const ${childVar}Columns = ${childColumnsFnName(childInfo)}(true);

  const initial${childPascal} = src.${childInfo.propertyName}.map(f => ({ ...f, id: f.id || \`temp-\${Date.now()}-\${Math.random()}\` }));

  const createNew${childPascal} = () => ({
    id: \`temp-\${Date.now()}-\${Math.random()}\`,
${createNewChildProps}
    ${model}_id: src.id,
  });`;
    }).join('\n');
    
    childGridSetup = `\n${allChildSetups}`;
    
      const allChildFormDataHandling = children.map(childInfo => {
        const child = childInfo.name;
        const childVar = childVarName(childInfo);
        const formKey = childFormKey(childInfo);
      const childDef = schema.definitions[child];
      
      if (!childDef?.properties) {
        throw new Error(`Child definition ${child} has no properties`);
      }
      
      // For many-to-many relationships
      if (childInfo.relationship?.type === 'many-to-many') {
        return `    const ${childVar} = ${childVar}Ref.current?.getItems?.() || [];

    ${childVar}.forEach((item) => {
      const itemId =
        item.originalId ??
        (typeof item.value === 'string' || typeof item.value === 'number' ? item.value : undefined);
      formData.append(
        '${formKey}[]',
        JSON.stringify({
          id: itemId,
          name: item.label ?? item.value,
        })
      );
    });`;
      }
      
      // For list output type
      if (childInfo.outputType === 'list') {
        if (childInfo.name === model) {
          return `    const ${childVar} = ${childVar}Ref.current?.getItems?.() || [];

    ${childVar}.forEach((item) => {
      const itemId =
        item.originalId ??
        (typeof item.value === 'string' || typeof item.value === 'number' ? item.value : undefined);
      formData.append(
        '${formKey}[]',
        JSON.stringify({
          id: itemId,
          name: item.label ?? item.value,
        })
      );
    });`;
        }
        if (childInfo.fileType) {
          return `    const ${childVar} = ${childVar}Ref.current?.getItems?.() || [];

    ${childVar}.forEach((item) => {
      const itemId = item.originalId || (typeof item.id === 'string' && item.id.startsWith('temp-') ? undefined : item.id);
      formData.append(
        '${formKey}[]',
        JSON.stringify({
          id: itemId,
          name: item.label,
          path: item.value,
        })
      );
    });`;
        }
        return `    const ${childVar} = ${childVar}Ref.current?.getItems?.() || [];

    ${childVar}.forEach((item) => {
      const itemId = item.originalId || (typeof item.id === 'string' && item.id.startsWith('temp-') ? undefined : item.id);
      formData.append(
        '${formKey}[]',
        JSON.stringify({
          id: itemId,
          name: item.value,
        })
      );
    });`;
      }
      
      const childProps = Object.keys(childDef.properties).filter(k => 
        k !== 'id' && k !== `${model}_id` && k !== 'created_at' && k !== 'updated_at' && k !== 'creator_id'
      );
      
      const childSerialize = childProps.map(p => `          ${p}: field.${p},`).join('\n');
      
      return `    const ${childVar} = ${childVar}Ref.current?.getFields?.() || [];

    (${childVar} as any[]).forEach((field) => {
      formData.append(
        '${formKey}[]',
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
      const childVar = childVarName(childInfo);
      const childPascal = childPascalName(childInfo);
      const childTitleLabel = childTitle(childInfo);
      const childDef = schema.definitions[child];
      
      // For many-to-many relationships, use EditableListWrapper with autocomplete
      if (childInfo.relationship?.type === 'many-to-many') {
        const targetPascal = toPascalCase(childInfo.relationship.target);
        return `      <EditableListWrapper
        ref={${childVar}Ref}
        initialItems={initial${childPascal}}
        itemType="autocomplete"
        addButtonLabel="Add ${childTitleLabel}"
        showTitle={true}
        title="${childTitleLabel}"
        textFieldLabel="Name"
        textFieldPlaceholder="Enter name"
        allAutocompleteOptions={all${targetPascal}s.map(item => ({
          id: item.id,
          label: item.name,
          value: item.id,
        }))}
        excludeOptionIds={[src.id]}
      />`;
      }
      
      // For list output type, use EditableListWrapper
      if (childInfo.outputType === 'list') {
        if (childInfo.name === model) {
          const targetPascal = toPascalCase(parent);
          // Check if this is a self-referential parent-child relationship
          const selfParentRel = parentRelationships.find((rel) => rel.target === model);
          const hasSelfParentRel = selfParentRel !== undefined;

          // For self-referential relationships with parent_id, filter out items that already have a different parent
          const filterLogic = hasSelfParentRel
            ? `.filter(item => !item.${selfParentRel!.propName} || item.${selfParentRel!.propName} === src.id)`
            : '';

          return `      <EditableListWrapper
        ref={${childVar}Ref}
        initialItems={initial${childPascal}}
        itemType="autocomplete"
        addButtonLabel="Add ${childTitleLabel}"
        showTitle={true}
        title="${childTitleLabel}"
        textFieldLabel="Name"
        textFieldPlaceholder="Enter name"
        allAutocompleteOptions={all${targetPascal}s${filterLogic}.map(item => ({
          id: item.id,
          label: item.name,
          value: item.id,
        }))}
        excludeOptionIds={[src.id]}
      />`;
        }
        if (childInfo.fileType) {
          const acceptedTypes = childInfo.fileType === 'image'
            ? 'image/jpeg,image/png,image/gif,image/webp'
            : '.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.zip';
          return `      <EditableListWrapper
        ref={${childVar}Ref}
        initialItems={initial${childPascal}}
        itemType="file"
        fileVariant="${childInfo.fileType}"
        acceptedFileTypes="${acceptedTypes}"
        addButtonLabel="Add ${childTitleLabel}"
        showTitle={true}
        title="${childTitleLabel}"
      />`;
        }
        return `      <EditableListWrapper
        ref={${childVar}Ref}
        initialItems={initial${childPascal}}
        itemType="text"
        addButtonLabel="Add ${childTitleLabel}"
        showTitle={true}
        title="${childTitleLabel}"
        textFieldLabel="Name"
        textFieldPlaceholder="Enter name"
      />`;
      }
      
      // Check if child has 'order' field
      const hasOrderField = childDef?.properties && 'order' in childDef.properties;
      const gridComponent = hasOrderField ? 'OrderedFieldsDataGrid' : 'FieldsDataGrid';
      
      return `      <${gridComponent}
        ref={${childVar}Ref}
        initialFields={initial${childPascal}}
        columns={${childVar}Columns}
        createNewRow={createNew${childPascal}}
        addButtonLabel="Add ${childTitleLabel}"
        deleteDialogTitle="Delete Selected ${childTitleLabel}?"
        deleteDialogMessage="Are you sure you want to delete the selected item(s)? This action cannot be undone."
        showTitle={true}
        title="${childTitleLabel}"
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

  const selectionPermissionProps = selectionTargets
    .map(target => `${toCamelCase(target)}Permissions`)
    .join(', ');
  
  const formUpsertParams = extraProps || selectionPermissionProps
    ? `{ src, isEdit, permissions${extraProps ? `, ${extraProps}` : ''}${selectionPermissionProps ? `, ${selectionPermissionProps}` : ''} }: FormUpsertProps`
    : `{ src, isEdit, permissions }: FormUpsertProps`;
  
  const booleanImports = booleanProps.length > 0
    ? "\nimport FormControlLabel from '@mui/material/FormControlLabel';\nimport Checkbox from '@mui/material/Checkbox';"
    : '';

  return `'use client';

import { useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import TextField from '@mui/material/TextField';${hasManyToOne ? "\nimport Autocomplete from '@mui/material/Autocomplete';" : ''}${numberProps.length > 0 ? '\nimport NumberField from \'../NumberField\';' : ''}
import { upsert${parentPascal}${canDelete ? `, remove${parentPascal}` : ''} } from '@/lib/${parent}/actions';
import type { FormUpsertProps } from '@/lib/${parent}/types';
import FormWithChildGrid from '../FormWithChildGrid';
${childImports}${dateTimeProps.length > 0 ? '\nimport dayjs, { Dayjs } from \'dayjs\';\nimport DateTimeWrapper from \'../DateTimeWrapper\';' : ''}${imageProps.length > 0 ? '\nimport ImageUpload from \'../ImageUpload\';' : ''}${booleanImports}

export default function FormUpsert(${formUpsertParams}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const canDelete = permissions ? permissions.delete : true;
  const srcSnapshot = useMemo(() => JSON.stringify(src), [src]);
${allStates ? '\n' + allStates : ''}
${childVariables}
${parentRefs}${childGridSetup}${relationshipOptionSetups ? `\n${relationshipOptionSetups}` : ''}

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    if (isPending) return;

    const formData = new FormData();
    formData.set('id', src.id);
    if (isEdit) {
      formData.set('__src_snapshot', srcSnapshot);
    }
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
      onDelete={${canDelete ? 'isEdit && canDelete ? handleDelete : undefined' : 'undefined'}}
      onBack={handleBack}
      deleteEntityLabel="${parentTitle}"
      submitButtonLabel="Save"
      error={error}
    />
  );
}
`;
}

export function generateFormView(parent: string, children: ChildInfo[], schema: Schema, generateConfig?: any, modelName?: string, definitionKey?: string): string {
  const model = modelName ?? parent;
  const defKey = definitionKey ?? `${parent}_detail`;
  const parentPascal = toPascalCase(parent);
  const parentTitle = toTitleCase(parent);
  const modelDef = schema.definitions[model];
  const filteredProps = filterFields(modelDef.properties ?? {}, generateConfig?.fields);
  const parentRelationships = getParentRelationships({ ...modelDef, properties: filteredProps }).map((rel) => ({
    ...rel,
    relationName: getDetailRelationName(parent, rel.target, schema, defKey),
  }));
  const relationshipByProp = new Map(parentRelationships.map(r => [r.propName, r] as const));

  if (!filteredProps || Object.keys(filteredProps).length === 0) {
    throw new Error(`Parent definition ${model} has no properties`);
  }

  // Get parent properties (excluding id and timestamps)
  const parentProps = Object.keys(filteredProps).filter(k =>
    k !== 'id' && k !== 'created_at' && k !== 'updated_at' && k !== 'creator_id'
  );
  
  // Separate Date and Image fields from other fields
  const dateTimeFields: string[] = [];
  const imageFields: string[] = [];
  const booleanFields: string[] = [];
  const otherFields: string[] = [];
  
  parentProps.forEach(p => {
    const prop = filteredProps[p];
    const propType = Array.isArray(prop.type) ? prop.type.find((t: string) => t !== 'null') : prop.type;
    const format = (prop as any).format;
    
    if (propType === 'string' && (format === 'date' || format === 'date-time' || format === 'time')) {
      dateTimeFields.push(p);
    } else if (propType === 'string' && format === 'uri') {
      imageFields.push(p);
    } else if (propType === 'boolean') {
      booleanFields.push(p);
    } else {
      otherFields.push(p);
    }
  });
  
  // Check if we need DateTimeWrapper or ImageDisplay imports
  const needsDateTimeWrapper = dateTimeFields.length > 0;
  const needsImageDisplay = imageFields.length > 0;
  
  const textFields = otherFields.map(p => {
    const label = p.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    const rel = relationshipByProp.get(p);
    if (rel) {
      const labelField = rel.labelField ?? 'name';
      return `      <TextField
        label="${label}"
        value={src.${rel.relationName}?.${labelField} || src.${p} || ''}
        fullWidth
        margin="normal"
        aria-readonly
      />`;
    }
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
    const prop = filteredProps[p];
    const format = (prop as any).format;
    const showTime = format === 'date-time' || format === 'time';

    return `      <DateTimeWrapper label="${label}" date_time={src.${p}}${showTime ? '' : ' show_time={false}'} readOnly />`;
  }).join('\n');
  
  const imageFieldsJsx = imageFields.map(p => {
    const label = p.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    
    return `      <ImageDisplay url={src.${p}} alt="${label}" />`;
  }).join('\n');

  const booleanFieldsJsx = booleanFields.map(p => {
    const label = p.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    return `      <FormControlLabel
        control={<Checkbox checked={Boolean(src.${p})} readOnly />}
        label="${label}"
      />`;
  }).join('\n');
  
  const parentTextFields = [textFields, booleanFieldsJsx, dateTimeFieldsJsx, imageFieldsJsx].filter(f => f).join('\n');
  
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
  import FormControlLabel from '@mui/material/FormControlLabel';
  import Checkbox from '@mui/material/Checkbox';

export default function FormView({ src, permissions }: FormViewProps) {
  const canEdit = permissions?.update ?? true;
  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <h1>${parentTitle}</h1>
        <div>
        {canEdit && (
          <Link href={\`/${parent}/edit/\${src.id}\`} sx={{ mx: 2 }}><Button variant="contained">Edit</Button></Link>
        )}
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
  const columnImports = gridChildren.map(c => childColumnsFnName(c)).join(', ');
  
  const childViewGrids = children.map(childInfo => {
    const childTitleLabel = childTitle(childInfo);
    
    // For list output type, use ListWrapper
    if (childInfo.outputType === 'list') {
      if (childInfo.fileType) {
        return `      <div>
        <ListWrapper
          items={src.${childInfo.propertyName}.map(f => ({
            id: f.id,
            value: f.path,
            label: f.name,
          }))}
          itemType="file"
          fileVariant="${childInfo.fileType}"
          showTitle={true}
          title="${childTitleLabel}"
        />
      </div>`;
      }
      return `      <div>
        <ListWrapper
          items={src.${childInfo.propertyName}.map(f => ({
            id: f.id,
            value: f.name,
            label: f.name,
          }))}
          itemType="text"
          showTitle={true}
          title="${childTitleLabel}"
        />
      </div>`;
    }
    
    return `      <div>
        <h2>${childTitleLabel}</h2>
        <FieldsViewGrid fields={src.${childInfo.propertyName}} columns={${childVarName(childInfo)}Columns} />
      </div>`;
  }).join('\n');
  
  const columnVariables = gridChildren.map(childInfo => {
    return `  const ${childVarName(childInfo)}Columns: GridColDef[] = ${childColumnsFnName(childInfo)}(false);`;
  }).join('\n');
  
  const columnImportLine = columnImports ? `\nimport { ${columnImports} } from '../${parent}/column_def';` : '';
  
  return `${needsClientDirective ? "'use client';\n\n" : ''}import { GridColDef } from '@mui/x-data-grid';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import type { FormViewProps } from '@/lib/${parent}/types';
import Link from '@mui/material/Link';
import FieldsViewGrid from '../FieldsViewGrid';${columnImportLine}${needsDateTimeWrapper ? '\nimport DateTimeWrapper from \'../DateTimeWrapper\';' : ''}${needsImageDisplay ? '\nimport ImageDisplay from \'../ImageDisplay\';' : ''}${listImport}
import FormControlLabel from '@mui/material/FormControlLabel';
import Checkbox from '@mui/material/Checkbox';

export default function FormView({ src, permissions }: FormViewProps) {
  const canEdit = permissions?.update ?? true;
${columnVariables}
  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <h1>${parentTitle}</h1>
        <div>
          {canEdit && (
            <Link href={\`/${parent}/edit/\${src.id}\`} sx={{ mx: 2 }}><Button variant="contained">Edit</Button></Link>
          )}
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

export function generatePageList(parent: string, schema: Schema, generateConfig?: any, modelName?: string): string {
  const model = modelName ?? parent;
  const parentPascal = toPascalCase(parent);
  const parentTitle = toTitleCase(parent);
  const parentCamel = toCamelCase(parent);
  const canDelete = generateConfig?.delete !== false;

  // Check for x-display configuration in the model definition
  const modelDef = schema.definitions[model];
  const xDisplay = (modelDef as any)?.['x-display'];

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

  const removeImport = canDelete ? `\nimport { remove${parentPascal} } from '@/lib/${parent}/actions';` : '';
  const removeActionProp = canDelete ? ` removeAction={remove${parentPascal}}` : '';

  return `import { get${parentPascal}ListPageData } from '@/lib/${parent}/getters';
import DataGridClient from '@/components/DataGridClient';${removeImport}

export default async function ${parentPascal}sPage() {
  const { ${parentCamel}s, userPermissions } = await get${parentPascal}ListPageData();
  return <DataGridClient src={${parentCamel}s} basePath="/${parent}"${removeActionProp} entityLabel="${parentTitle}"${displayFieldsCode}
    permissions={userPermissions} />;
}
`;
}

export function generatePageNew(parent: string, children: ChildInfo[], schema: Schema, modelName?: string, definitionKey?: string): string {
  const model = modelName ?? parent;
  const defKey = definitionKey ?? `${parent}_detail`;
  const parentPascal = toPascalCase(parent);
  const modelDef = schema.definitions[model];
  const filteredProps = filterFields(modelDef.properties ?? {}, undefined);
  const parentRelationships = getParentRelationships({ ...modelDef, properties: filteredProps });

  if (!filteredProps || Object.keys(filteredProps).length === 0) {
    throw new Error(`Parent definition ${model} has no properties`);
  }

  // Get parent properties (excluding id and timestamps) and set default values
  const parentDefaultProps = Object.entries(filteredProps)
    .filter(([key]) => key !== 'id' && key !== 'created_at' && key !== 'updated_at' && key !== 'creator_id')
    .map(([key, prop]) => {
      const propType = Array.isArray(prop.type) ? prop.type.find((t: string) => t !== 'null') : prop.type;
      const format = (prop as any).format;
      const isRequired = modelDef.required?.includes(key);
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
      
      // Boolean fields
      if (propType === 'boolean') {
        return `    ${key}: false,`;
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
        .map(target => target === 'organization'
          ? `import { getAssociatedOrganizationListPageData } from '@/lib/organization/getters_associated';`
          : `import { get${toPascalCase(target)}ListPageData } from '@/lib/${target}/getters';`)
        .join('\n')
    : '';
  
  const selectionFetches = selectionTargets.length > 0
    ? selectionTargets
        .map(target => target === 'organization'
          ? `  const organizationsData = await getAssociatedOrganizationListPageData();`
          : `  const ${toCamelCase(target)}sData = await get${toPascalCase(target)}ListPageData(false);`)
        .join('\n')
    : '';
  
  const selectionProps = selectionTargets.length > 0
    ? ' ' + selectionTargets
        .map(target => `all${toPascalCase(target)}s={${toCamelCase(target)}sData.${toCamelCase(target)}s} ${toCamelCase(target)}Permissions={${toCamelCase(target)}sData.userPermissions}`)
        .join(' ')
    : '';
  
  return `import FormUpsert from '@/components/${parent}/FormUpsert';${selectionImports ? '\n' + selectionImports : ''}
import { get${parentPascal}NewPageAccessCheck } from '@/lib/${parent}/getters';

export default async function Add${parentPascal}Page() {${selectionFetches ? '\n' + selectionFetches : ''}
  const userPermissions =await get${parentPascal}NewPageAccessCheck();
  const src = {
    id: '',
${parentDefaultProps}${childrenProps ? `\n${childrenProps}` : ''}
  };
  return <FormUpsert src={src} isEdit={false} permissions={userPermissions}${selectionProps} />;
}
`;
}

export function generatePageEdit(parent: string, children: ChildInfo[], schema: Schema, modelName?: string, definitionKey?: string): string {
  const model = modelName ?? parent;
  const parentPascal = toPascalCase(parent);
  const parentCamel = toCamelCase(parent);
  const modelDef = schema.definitions[model];
  const filteredProps = filterFields(modelDef.properties ?? {}, undefined);
  const parentRelationships = getParentRelationships({ ...modelDef, properties: filteredProps });
  
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
        .map(target => target === 'organization'
          ? `import { getAssociatedOrganizationListPageData } from '@/lib/organization/getters_associated';`
          : `import { get${toPascalCase(target)}ListPageData } from '@/lib/${target}/getters';`)
        .join('\n')
    : '';
  
  const hasSelections = selectionTargets.length > 0;
  
  const selectionFetchCalls = selectionTargets.map((target) =>
    target === 'organization'
      ? 'getAssociatedOrganizationListPageData()'
      : `get${toPascalCase(target)}ListPageData(false)`
  );

  const promiseAllFetches = hasSelections
    ? `  const [detail, ${selectionTargets.map(t => `${toCamelCase(t)}sData`).join(', ')}] = await Promise.all([
    get${parentPascal}DetailPageData(id, 'update'),
    ${selectionFetchCalls.join(',\n    ')},
  ]);`
    : `  const detail = await get${parentPascal}DetailPageData(id, 'update');`;
  
  const selectionProps = hasSelections
    ? ' ' + selectionTargets
        .map(target => `all${toPascalCase(target)}s={${toCamelCase(target)}sData.${toCamelCase(target)}s} ${toCamelCase(target)}Permissions={${toCamelCase(target)}sData.userPermissions}`)
        .join(' ')
    : '';
  
  return `import FormUpsert from '@/components/${parent}/FormUpsert';
import { get${parentPascal}DetailPageData } from '@/lib/${parent}/getters';${selectionImports}
import { ${parentPascal}DetailPageProps } from '@/lib/${parent}/types';
import { notFound } from 'next/navigation';

export default async function Edit${parentPascal}Page({ params }: ${parentPascal}DetailPageProps) {
  const { id } = await params;
${promiseAllFetches}
  if (!detail.${parentCamel}) {
    notFound();
  }
  return <FormUpsert src={detail.${parentCamel}} isEdit={true} permissions={detail.userPermissions}${selectionProps} />;
}
`;
}

export function generatePageView(parent: string, modelName?: string): string {
  const model = modelName ?? parent;
  const parentPascal = toPascalCase(parent);
  const parentCamel = toCamelCase(parent);
  
  return `import FormView from '@/components/${parent}/FormView';
import { get${parentPascal}DetailPageData } from '@/lib/${parent}/getters';
import { ${parentPascal}DetailPageProps } from '@/lib/${parent}/types';
import { notFound } from 'next/navigation';

export default async function View${parentPascal}Page({ params }: ${parentPascal}DetailPageProps) {
  const { id } = await params;
  const { ${parentCamel}, userPermissions } = await get${parentPascal}DetailPageData(id);
  if (!${parentCamel}) {
    notFound();
  }
  return <FormView src={${parentCamel}} permissions={userPermissions} />;
}
`;
}

export function generateService(parent: string, children: ChildInfo[], schema: Schema, generateConfig?: any, modelName?: string): string {
  const model = modelName ?? parent;
  const parentPascal = toPascalCase(parent);
  const modelDef = schema.definitions[model];
  const filteredProps = filterFields(modelDef.properties ?? {}, generateConfig?.fields);
  const canCreate = generateConfig?.new !== false;
  const canUpdate = generateConfig?.edit !== false;
  const canDelete = generateConfig?.delete !== false;
  const parentRelationships = getParentRelationships({ ...modelDef, properties: filteredProps });
  const selfParentRel = parentRelationships.find((rel) => rel.target === model);
  const selfParentProp = selfParentRel?.propName ?? null;

  // Get parent properties (excluding id and timestamps)
  const parentProps = Object.keys(filteredProps).filter(k =>
    k !== 'id' && k !== 'created_at' && k !== 'updated_at' && k !== 'creator_id'
  );

  const parentPropInfos = parentProps.map(p => ({
    prop: p,
    varName: safeVarName(p),
    def: filteredProps[p]
  }));

  const parentParamsWithTypes = parentPropInfos.length > 0
    ? parentPropInfos.map(p => {
        const tsType = getTsType(p.def);
        return `${p.varName}: ${tsType}`;
      }).join(', ')
    : '';

  const parentDataObj = parentPropInfos.map(p => `      ${p.prop}: ${p.varName},`).join('\n');

  const normalizeKind = (def: SchemaProperty): 'date' | 'number' | 'boolean' | 'string' | 'other' => {
    const propType = Array.isArray(def.type) ? def.type.find(t => t !== 'null') : def.type;
    const format = (def as any).format;
    if (propType === 'string' && (format === 'date' || format === 'date-time' || format === 'time')) return 'date';
    if (propType === 'integer' || propType === 'number') return 'number';
    if (propType === 'boolean') return 'boolean';
    if (propType === 'string') return 'string';
    return 'other';
  };

  const snapshotFieldMappings = parentPropInfos
    .map(({ prop, def }) => `    ${prop}: normalizeValue(safeSnapshot.${prop}, '${normalizeKind(def)}'),`)
    .join('\n');
  const snapshotChildMappings = children.length > 0
    ? children.map(childInfo => `    ${childInfo.propertyName}: normalizeChildRefs(safeSnapshot.${childInfo.propertyName}),`).join('\n')
    : '';
  const snapshotIncludeProps = children.length > 0
    ? `,\n    include: {\n      ${children.map(childInfo => `${childInfo.propertyName}: { select: { id: true } }`).join(',\n      ')}\n    }`
    : '';

  // Shared utility code
  const utilityCode = `import prisma from '@/lib/prisma';
import { normalizeValue,${children.length > 0 ? ' normalizeChildRefs,' : ''}${canUpdate ? ' assertNotStale,' : ''} type NormalizedSnapshot } from '@/lib/normalize';

type TransactionClient = Pick<typeof prisma, '${model}'>;

function normalizeSnapshot(snapshot: Record<string, unknown> | null | undefined): NormalizedSnapshot {
  const safeSnapshot = (snapshot ?? {}) as Record<string, unknown>;
  return {
    id: String(safeSnapshot.id ?? ''),
${snapshotFieldMappings}${snapshotChildMappings ? `\n${snapshotChildMappings}` : ''}
  };
}

async function getCurrentSnapshot(tx: TransactionClient, id: string): Promise<NormalizedSnapshot | null> {
  const current = await tx.${model}.findUnique({
    where: { id }${snapshotIncludeProps}
  });

  if (!current) {
    return null;
  }

  return normalizeSnapshot(current as Record<string, unknown>);
}`;

  // For parent-only case
  if (children.length === 0) {
    return `${utilityCode}
${canCreate ? `
export async function add${parentPascal}(creatorId: string, ${parentParamsWithTypes}) {
  return await prisma.${model}.create({
    data: {
${parentDataObj}
      creator_id: creatorId,
    },
  });
}
` : ''}${canUpdate ? `
export async function update${parentPascal}(id: string, ${parentParamsWithTypes}, srcSnapshotRaw?: string | null) {
  return await prisma.$transaction(async (tx) => {
    if (srcSnapshotRaw) {
      await assertNotStale(srcSnapshotRaw, normalizeSnapshot, () => getCurrentSnapshot(tx, id));
    }
    return await tx.${model}.update({
      where: { id },
      data: {
${parentDataObj}
      },
    });
  });
}
` : ''}${canDelete ? `
export async function delete${parentPascal}(ids: string[]) {
  if (ids.length === 1) {
    await prisma.${model}.delete({ where: { id: ids[0] } });
  } else {
    await prisma.${model}.deleteMany({ where: { id: { in: ids } } });
  }
}
` : ''}`;
  }

  // For with-children cases
  const allChildrenData = children.map(childInfo => {
    const child = childInfo.name;
    const childVar = childVarName(childInfo);
    const childPascal = childPascalName(childInfo);
    const childDef = schema.definitions[child];
    const isManyToMany = childInfo.relationship?.type === 'many-to-many';
    const useConnect = isManyToMany || child === model;

    if (!childDef?.properties) {
      throw new Error(`Child definition ${child} has no properties`);
    }

    const parentIdPropNames = new Set<string>();
    if (child === model) {
      parentRelationships
        .filter(rel => rel.target === model)
        .forEach(rel => parentIdPropNames.add(rel.propName));
    } else {
      parentIdPropNames.add(`${model}_id`);
    }

    const childProps = Object.keys(childDef.properties).filter(k =>
      k !== 'id' && !parentIdPropNames.has(k) && k !== 'created_at' && k !== 'updated_at' && k !== 'creator_id'
    );

    const fieldType = `{ ${childProps.map(p => `${p}: ${getTsType(childDef.properties![p])}`).join('; ')} }`;
    const fieldTypeWithId = `{ ${Object.keys(childDef.properties).filter(k =>
      !parentIdPropNames.has(k) && k !== 'created_at' && k !== 'updated_at' && k !== 'creator_id'
    ).map(p => `${p.replace(/id/, 'id?')}: ${getTsType(childDef.properties![p])}`).join('; ')} }`;

    const fieldMapCreate = childProps.map(p => `          ${p}: f.${p},`).join('\n');

    return {
      child,
      childVar,
      childPascal,
      fieldType,
      fieldTypeWithId,
      fieldMapCreate,
      isManyToMany,
      useConnect,
      propertyName: childInfo.propertyName,
      formKey: childFormKey(childInfo),
      outputType: childInfo.outputType,
    };
  });

  const childParamsForAdd = allChildrenData.map(({ childVar, fieldType, useConnect }) =>
    useConnect ? `${childVar}Ids: string[]` : `${childVar}Items: ${fieldType}[]`
  ).join(', ');
  const childParamsForUpdate = allChildrenData.map(({ childVar, fieldTypeWithId, useConnect }) =>
    useConnect ? `${childVar}Ids: string[]` : `${childVar}Items: ${fieldTypeWithId}[]`
  ).join(', ');

  // Generate nested create for all children
  const childNestedCreate = allChildrenData.map(({ propertyName, childVar, fieldMapCreate, useConnect }) => {
    if (useConnect) {
      return `      ${propertyName}: {\n        connect: ${childVar}Ids.map((id) => ({ id })),\n      },`;
    } else {
      return `      ${propertyName}: {\n        create: ${childVar}Items.map(f => ({\n${fieldMapCreate}\n        })),\n      },`;
    }
  }).join('\n');

  // Generate nested update (deleteMany + create for one-to-many, set for many-to-many)
  const childNestedUpdate = allChildrenData.map(({ propertyName, childVar, fieldMapCreate, useConnect }) => {
    if (useConnect) {
      return `      ${propertyName}: {\n        set: ${childVar}Ids.map((id) => ({ id })),\n      },`;
    } else {
      return `      ${propertyName}: {\n        deleteMany: {},\n        create: ${childVar}Items.map(f => ({\n${fieldMapCreate}\n        })),\n      },`;
    }
  }).join('\n');

  // Self-child validation for service
  const selfChildValidation = selfParentProp
    ? allChildrenData
        .filter((childInfo) => childInfo.child === model && childInfo.outputType === 'list' && !childInfo.isManyToMany)
        .map((childInfo) => `
  if (${childInfo.childVar}Ids.length > 0) {
    if (id && ${childInfo.childVar}Ids.includes(id)) {
      throw new Error('Cannot set an item as its own child.');
    }
    const invalid${childInfo.childPascal} = await prisma.${model}.findMany({
      where: id
        ? {
            id: { in: ${childInfo.childVar}Ids },
            AND: [
              { ${selfParentProp}: { not: null } },
              { NOT: { ${selfParentProp}: id } },
            ],
          }
        : {
            id: { in: ${childInfo.childVar}Ids },
            ${selfParentProp}: { not: null },
          },
      select: { id: true },
    });

    if (invalid${childInfo.childPascal}.length > 0) {
      throw new Error('One or more selected children already belong to another parent.');
    }
  }
`)
        .join('')
    : '';

  const childArgsForCall = allChildrenData.map(({ childVar, useConnect }) =>
    useConnect ? `${childVar}Ids` : `${childVar}Items`
  ).join(', ');

  return `${utilityCode}
${canCreate ? `
export async function add${parentPascal}(creatorId: string, ${parentParamsWithTypes}${parentParamsWithTypes && childParamsForAdd ? ', ' : ''}${childParamsForAdd}) {${selfChildValidation ? `\n  const id = null;${selfChildValidation}` : ''}
  return await prisma.${model}.create({
    data: {
${parentDataObj}
      creator_id: creatorId,
${childNestedCreate}
    },
  });
}
` : ''}${canUpdate ? `
export async function update${parentPascal}(id: string${parentParamsWithTypes ? ', ' : ''}${parentParamsWithTypes}${parentParamsWithTypes && childParamsForUpdate ? ', ' : ''}${childParamsForUpdate}, srcSnapshotRaw?: string | null) {${selfChildValidation}
  return await prisma.$transaction(async (tx) => {
    if (srcSnapshotRaw) {
      await assertNotStale(srcSnapshotRaw, normalizeSnapshot, () => getCurrentSnapshot(tx, id));
    }
    return await tx.${model}.update({
      where: { id },
      data: {
${parentDataObj}
${childNestedUpdate}
      },
    });
  });
}
` : ''}${canDelete ? `
export async function delete${parentPascal}(ids: string[]) {
  if (ids.length === 1) {
    await prisma.${model}.delete({ where: { id: ids[0] } });
  } else {
    await prisma.${model}.deleteMany({ where: { id: { in: ids } } });
  }
}
` : ''}`;
}

export function generateApiRoute(parent: string, children: ChildInfo[], schema: Schema, generateConfig?: any, modelName?: string): string {
  const model = modelName ?? parent;
  const parentPascal = toPascalCase(parent);
  const modelDef = schema.definitions[model];
  const filteredProps = filterFields(modelDef.properties ?? {}, generateConfig?.fields);
  const canList = generateConfig?.list !== false;
  const canCreate = generateConfig?.new !== false;

  // Compute body destructuring for POST
  const parentProps = Object.keys(filteredProps).filter(k =>
    k !== 'id' && k !== 'created_at' && k !== 'updated_at' && k !== 'creator_id'
  );

  const parentPropInfos = parentProps.map(p => ({
    prop: p,
    varName: safeVarName(p),
    def: filteredProps[p]
  }));

  const bodyDestructure = parentPropInfos.map(p => p.prop).join(', ');

  const allChildrenData = children.map(childInfo => {
    const isManyToMany = childInfo.relationship?.type === 'many-to-many';
    const useConnect = isManyToMany || childInfo.name === model;
    return {
      childVar: childVarName(childInfo),
      propertyName: childInfo.propertyName,
      useConnect,
    };
  });

  const childBodyFields = allChildrenData.map(({ childVar, propertyName, useConnect }) =>
    useConnect ? `${childVar}_ids` : propertyName
  );

  const allBodyFields = [...parentPropInfos.map(p => p.prop === p.varName ? p.prop : `${p.prop}: ${p.varName}`), ...childBodyFields].join(', ');

  const childServiceArgs = allChildrenData.map(({ childVar, propertyName, useConnect }) =>
    useConnect ? `${childVar}_ids ?? []` : `${propertyName} ?? []`
  ).join(', ');

  const parentServiceArgs = parentPropInfos.map(p => {
    const isNullable = Array.isArray(p.def.type) && p.def.type.includes('null');
    return isNullable ? `${p.varName} ?? null` : p.varName;
  }).join(', ');

  const serviceArgsForCreate = `userId, ${parentServiceArgs}${parentServiceArgs && childServiceArgs ? ', ' : ''}${childServiceArgs}`;

  return `import { NextRequest, NextResponse } from 'next/server';
import { authenticateApiKey, requireApiPermission, handleApiError } from '@/lib/api-auth';${canList ? `\nimport { getAll${parentPascal}s } from '@/lib/${parent}/getters';` : ''}${canCreate ? `\nimport { add${parentPascal} } from '@/lib/${parent}/service';` : ''}
${canList ? `
export async function GET(request: NextRequest) {
  try {
    const { userId } = await authenticateApiKey(request);
    await requireApiPermission(userId, '${model}', 'read');
    const items = await getAll${parentPascal}s();
    return NextResponse.json(items);
  } catch (error) {
    return handleApiError(error);
  }
}
` : ''}${canCreate ? `
export async function POST(request: NextRequest) {
  try {
    const { userId } = await authenticateApiKey(request);
    await requireApiPermission(userId, '${model}', 'create');
    const body = await request.json();
    const { ${allBodyFields} } = body;
    const result = await add${parentPascal}(${serviceArgsForCreate});
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
` : ''}`;
}

export function generateApiDetailRoute(parent: string, children: ChildInfo[], schema: Schema, generateConfig?: any, modelName?: string): string {
  const model = modelName ?? parent;
  const parentPascal = toPascalCase(parent);
  const modelDef = schema.definitions[model];
  const filteredProps = filterFields(modelDef.properties ?? {}, generateConfig?.fields);
  const canView = generateConfig?.view !== false;
  const canUpdate = generateConfig?.edit !== false;
  const canDelete = generateConfig?.delete !== false;

  // Compute body destructuring for PUT
  const parentProps = Object.keys(filteredProps).filter(k =>
    k !== 'id' && k !== 'created_at' && k !== 'updated_at' && k !== 'creator_id'
  );

  const parentPropInfos = parentProps.map(p => ({
    prop: p,
    varName: safeVarName(p),
    def: filteredProps[p]
  }));

  const allChildrenData = children.map(childInfo => {
    const isManyToMany = childInfo.relationship?.type === 'many-to-many';
    const useConnect = isManyToMany || childInfo.name === model;
    return {
      childVar: childVarName(childInfo),
      propertyName: childInfo.propertyName,
      useConnect,
    };
  });

  const childBodyFields = allChildrenData.map(({ childVar, propertyName, useConnect }) =>
    useConnect ? `${childVar}_ids` : propertyName
  );

  const allBodyFields = [...parentPropInfos.map(p => p.prop === p.varName ? p.prop : `${p.prop}: ${p.varName}`), ...childBodyFields].join(', ');

  const childServiceArgs = allChildrenData.map(({ childVar, propertyName, useConnect }) =>
    useConnect ? `${childVar}_ids ?? []` : `${propertyName} ?? []`
  ).join(', ');

  const parentServiceArgs = parentPropInfos.map(p => {
    const isNullable = Array.isArray(p.def.type) && p.def.type.includes('null');
    return isNullable ? `${p.varName} ?? null` : p.varName;
  }).join(', ');

  const serviceArgsForUpdate = `id, ${parentServiceArgs}${parentServiceArgs && childServiceArgs ? ', ' : ''}${childServiceArgs}`;

  const serviceImports = [
    canUpdate ? `update${parentPascal}` : '',
    canDelete ? `delete${parentPascal}` : '',
  ].filter(Boolean).join(', ');

  return `import { NextRequest, NextResponse } from 'next/server';
import { authenticateApiKey, requireApiPermission, handleApiError } from '@/lib/api-auth';${canView ? `\nimport { get${parentPascal}Detail } from '@/lib/${parent}/getters';` : ''}${serviceImports ? `\nimport { ${serviceImports} } from '@/lib/${parent}/service';` : ''}

type Params = { params: Promise<{ id: string }> };
${canView ? `
export async function GET(request: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const { userId } = await authenticateApiKey(request);
    await requireApiPermission(userId, '${model}', 'read');
    const item = await get${parentPascal}Detail(id);
    if (!item) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    return NextResponse.json(item);
  } catch (error) {
    return handleApiError(error);
  }
}
` : ''}${canUpdate ? `
export async function PUT(request: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const { userId } = await authenticateApiKey(request);
    await requireApiPermission(userId, '${model}', 'update');
    const body = await request.json();
    const { ${allBodyFields} } = body;
    const result = await update${parentPascal}(${serviceArgsForUpdate});
    return NextResponse.json(result);
  } catch (error) {
    return handleApiError(error);
  }
}
` : ''}${canDelete ? `
export async function DELETE(request: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const { userId } = await authenticateApiKey(request);
    await requireApiPermission(userId, '${model}', 'delete');
    await delete${parentPascal}([id]);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return handleApiError(error);
  }
}
` : ''}`;
}
