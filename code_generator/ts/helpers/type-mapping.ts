/**
 * Type mapping utilities for converting JSON Schema types to TypeScript types
 */

import type { SchemaProperty } from '../types';

/**
 * Maps JSON Schema primitive types to TypeScript types
 * @param type - JSON Schema type (string, integer, number, boolean, null)
 * @returns TypeScript type as string
 */
export function mapJsonTypeToTs(type: string): string {
  switch (type) {
    case 'string': return 'string';
    case 'integer': return 'number';
    case 'number': return 'number';
    case 'boolean': return 'boolean';
    case 'null': return 'null';
    default: return 'any';
  }
}

/**
 * Converts a JSON Schema property definition to a TypeScript type string
 * Handles:
 * - Date/DateTime/Time formats (converts to Date type)
 * - Nullable types (union with null)
 * - Arrays
 * - Primitive types
 *
 * @param prop - JSON Schema property definition
 * @returns TypeScript type as string
 */
export function getTsType(prop: SchemaProperty, forViewProps: boolean = false): string {
  // Check for date/datetime/time format
  const format = (prop as any).format;
  const isDateType = format === 'date' || format === 'date-time' || format === 'time';

  if (Array.isArray(prop.type)) {
    // Union type for nullable
    if (isDateType) {
      // For nullable date types
      return prop.type.includes('null') || forViewProps ? 'Date | null' : 'Date';
    }
    return prop.type.map(t => t === 'null' ? 'null' : mapJsonTypeToTs(t)).join(' | ');
  }

  if (prop.type === 'array') {
    return 'any[]'; // Simplified
  }

  if (isDateType && prop.type === 'string') {
    return forViewProps ? 'Date | null' : 'Date';
  }

  return mapJsonTypeToTs(prop.type);
}
