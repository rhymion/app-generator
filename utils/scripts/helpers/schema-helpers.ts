/**
 * Schema exploration utilities for navigating and extracting information from JSON Schema definitions
 */

import type { Schema, SchemaDefinition, SchemaProperty } from '../types';

/**
 * Metadata for many-to-one parent relationships
 */
export type ParentRelationshipMeta = {
  propName: string;
  target: string;
  labelField?: string;
  required?: boolean;
};

/**
 * Map of detail properties (may be undefined if detail def doesn't exist)
 */
export type DetailPropertyMap = Record<string, SchemaProperty> | undefined;

/**
 * Extracts properties from a {parent}_detail definition
 * Supports both direct properties and allOf composition patterns
 *
 * @param parent - Parent entity name
 * @param schema - Full schema
 * @returns Map of properties or undefined if detail def doesn't exist
 */
export function getDetailProperties(parent: string, schema: Schema): DetailPropertyMap {
  const detailDef = schema.definitions[`${parent}_detail`];
  if (!detailDef) return undefined;

  if (detailDef.properties) {
    return detailDef.properties;
  }

  if (detailDef.allOf) {
    const propsObj = detailDef.allOf.find((item: any) => item.properties);
    return propsObj?.properties;
  }

  return undefined;
}

/**
 * Finds the property name that references a target entity in the detail definition
 * Used to map relationships back to their property names
 *
 * @param parent - Parent entity name
 * @param target - Target entity name to find
 * @param schema - Full schema
 * @returns Property name that references the target, or target name if not found
 */
export function getDetailRelationName(parent: string, target: string, schema: Schema): string {
  const properties = getDetailProperties(parent, schema);
  if (!properties) return target;

  for (const [propName, prop] of Object.entries(properties)) {
    const propAny = prop as any;
    const ref = propAny.$ref as string | undefined;
    if (ref && ref.split('/').pop() === target) {
      return propName;
    }
  }

  return target;
}

/**
 * Extracts many-to-one relationships from a parent definition
 * Filters out creator_id relationships
 *
 * @param parentDef - Parent schema definition
 * @returns Array of parent relationship metadata
 */
export function getParentRelationships(parentDef?: SchemaDefinition): ParentRelationshipMeta[] {
  if (!parentDef?.properties) return [];

  return Object.entries(parentDef.properties).flatMap(([propName, prop]) => {
    const rel = (prop as any)['x-relationship'] as SchemaProperty['x-relationship'] | undefined;
    if (!rel || rel.type !== 'many-to-one' || !rel.target) {
      return [];
    }

    if (propName === 'creator_id') {
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
