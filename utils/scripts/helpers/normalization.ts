/**
 * Data normalization utilities for stale-data detection in actions
 * These functions are also generated into actions.ts for runtime use
 */

/**
 * Normalized snapshot type for change detection
 */
export type NormalizedSnapshot = Record<string, unknown>;

/**
 * Normalizes a value to a JSON-safe format for comparison
 * Handles special cases for dates, numbers, booleans, and strings
 *
 * @param value - Value to normalize
 * @param kind - Type hint for normalization
 * @returns Normalized value (JSON-safe)
 */
export function normalizeValue(value: unknown, kind: 'date' | 'number' | 'boolean' | 'string' | 'other'): unknown {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  if (kind === 'date') {
    const date = value instanceof Date ? value : new Date(value as string);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }

  if (kind === 'number') {
    const numberValue = Number(value);
    return Number.isNaN(numberValue) ? null : numberValue;
  }

  if (kind === 'boolean') {
    if (typeof value === 'string') {
      if (value.toLowerCase() === 'true') return true;
      if (value.toLowerCase() === 'false') return false;
    }
    return Boolean(value);
  }

  if (kind === 'string') {
    return String(value);
  }

  return value;
}

/**
 * Extracts and normalizes child reference IDs from an array
 * Filters out non-string IDs and sorts for consistent comparison
 *
 * @param items - Array of child objects with id properties
 * @returns Sorted array of string IDs
 */
export function normalizeChildRefs(items: unknown): string[] {
  if (!Array.isArray(items)) return [];
  return items
    .map((item) => (item && typeof item === 'object' ? (item as { id?: string }).id : undefined))
    .filter((id): id is string => Boolean(id))
    .sort();
}

/**
 * Creates a normalized snapshot of a record for change detection
 * Note: This function signature is a template - actual implementation
 * is generated per-entity based on schema
 *
 * @param snapshot - Raw record data
 * @returns Normalized snapshot with consistent field types
 */
export function normalizeSnapshot(snapshot: Record<string, unknown> | null | undefined): NormalizedSnapshot {
  const safeSnapshot = (snapshot ?? {}) as Record<string, unknown>;
  return {
    id: String(safeSnapshot.id ?? ''),
    // Additional fields are added by generator based on schema
  };
}

/**
 * Template string for generating normalizeValue in actions.ts
 * This is used by the code generator to embed the function in output
 */
export const normalizeValueTemplate = `function normalizeValue(value: unknown, kind: 'date' | 'number' | 'boolean' | 'string' | 'other') {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  if (kind === 'date') {
    const date = value instanceof Date ? value : new Date(value as string);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }

  if (kind === 'number') {
    const numberValue = Number(value);
    return Number.isNaN(numberValue) ? null : numberValue;
  }

  if (kind === 'boolean') {
    if (typeof value === 'string') {
      if (value.toLowerCase() === 'true') return true;
      if (value.toLowerCase() === 'false') return false;
    }
    return Boolean(value);
  }

  if (kind === 'string') {
    return String(value);
  }

  return value;
}`;

/**
 * Template string for generating normalizeChildRefs in actions.ts
 */
export const normalizeChildRefsTemplate = `function normalizeChildRefs(items: unknown): string[] {
  if (!Array.isArray(items)) return [];
  return items
    .map((item) => (item && typeof item === 'object' ? (item as { id?: string }).id : undefined))
    .filter((id): id is string => Boolean(id))
    .sort();
}`;
