/**
 * Child entity naming and utility functions
 */

import { safeVarName, toPascalCase, toTitleCase, singularize } from './naming';

/**
 * Relationship type information for child entities
 */
export interface RelationshipInfo {
  type: 'many-to-many' | 'one-to-many';
  target: string;
}

/**
 * Child entity information passed to generators
 */
export interface ChildInfo {
  name: string;
  propertyName: string;
  outputType?: string;
  fileType?: 'file' | 'image';
  relationship?: RelationshipInfo;
}

/**
 * All naming variations for a child entity
 */
export interface ChildNames {
  varName: string;           // camelCase variable name
  pascalName: string;        // PascalCase type name
  singularVarName: string;   // Singular camelCase
  singularPascalName: string; // Singular PascalCase
  title: string;             // Title Case for UI
  formKey: string;           // Form field key (singular)
  columnsFnName: string;     // Column definition function name
}

/**
 * Factory function to get all naming variations for a child entity
 * Recommended over individual functions for consistency
 *
 * @param child - Child entity info
 * @returns All naming variations
 */
export function getChildNames(child: ChildInfo): ChildNames {
  const varName = safeVarName(child.propertyName);
  const pascalName = toPascalCase(child.propertyName);

  return {
    varName,
    pascalName,
    singularVarName: singularize(varName),
    singularPascalName: singularize(pascalName),
    title: toTitleCase(child.propertyName),
    formKey: singularize(child.propertyName),
    columnsFnName: `${child.propertyName}_columns`,
  };
}

// Individual naming functions for backward compatibility
// Prefer using getChildNames() factory instead

export function childVarName(child: ChildInfo): string {
  return safeVarName(child.propertyName);
}

export function childPascalName(child: ChildInfo): string {
  return toPascalCase(child.propertyName);
}

export function childTitle(child: ChildInfo): string {
  return toTitleCase(child.propertyName);
}

export function childColumnsFnName(child: ChildInfo): string {
  return `${child.propertyName}_columns`;
}

export function childSingularVarName(child: ChildInfo): string {
  return singularize(childVarName(child));
}

export function childSingularPascalName(child: ChildInfo): string {
  return singularize(childPascalName(child));
}

export function childFormKey(child: ChildInfo): string {
  return singularize(child.propertyName);
}
