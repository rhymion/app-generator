/**
 * Property categorization utilities for grouping schema properties by type
 */

import type { SchemaProperty } from '../types';

/**
 * Categorized properties grouped by field type
 */
export interface CategorizedProperties {
  dateTimeProps: string[];
  numberProps: string[];
  imageProps: string[];
  booleanProps: string[];
  textProps: string[];
}

/**
 * Categorizes schema properties by their type for UI generation
 * Groups properties into: datetime, number, image, boolean, and text
 *
 * @param properties - Schema properties to categorize
 * @param filter - Optional filter function to exclude certain properties
 * @returns Categorized property names
 *
 * @example
 * const categorized = categorizeProperties(
 *   parentDef.properties!,
 *   (key) => key !== 'id' && key !== 'created_at'
 * );
 */
export function categorizeProperties(
  properties: Record<string, SchemaProperty>,
  filter?: (key: string, prop: SchemaProperty) => boolean
): CategorizedProperties {
  const categorized: CategorizedProperties = {
    dateTimeProps: [],
    numberProps: [],
    imageProps: [],
    booleanProps: [],
    textProps: [],
  };

  for (const [key, prop] of Object.entries(properties)) {
    // Apply filter if provided
    if (filter && !filter(key, prop)) {
      continue;
    }

    const propType = Array.isArray(prop.type) ? prop.type.find(t => t !== 'null') : prop.type;
    const format = (prop as any).format;

    // Categorize by type and format
    if (propType === 'string' && (format === 'date' || format === 'date-time' || format === 'time')) {
      categorized.dateTimeProps.push(key);
    } else if (propType === 'integer' || propType === 'number') {
      categorized.numberProps.push(key);
    } else if (propType === 'boolean') {
      categorized.booleanProps.push(key);
    } else if (propType === 'string' && format === 'uri') {
      categorized.imageProps.push(key);
    } else {
      categorized.textProps.push(key);
    }
  }

  return categorized;
}
