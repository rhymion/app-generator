/**
 * Naming convention utilities for code generation
 * Converts between different naming styles: underscore_case, camelCase, PascalCase, Title Case
 */

export const RESERVED_WORDS = new Set([
  'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger', 'default', 'delete',
  'do', 'else', 'enum', 'export', 'extends', 'false', 'finally', 'for', 'function',
  'if', 'implements', 'import', 'in', 'instanceof', 'interface', 'let', 'new', 'null',
  'package', 'private', 'protected', 'public', 'return', 'super', 'switch', 'static',
  'this', 'throw', 'true', 'try', 'typeof', 'var', 'void', 'while', 'with', 'yield',
  'await'
]);

/**
 * Converts underscore_case to camelCase
 * Example: "user_name" → "userName"
 */
export function toCamelCase(str: string): string {
  return str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
}

/**
 * Converts underscore_case to PascalCase
 * Example: "user_name" → "UserName"
 */
export function toPascalCase(str: string): string {
  const camel = toCamelCase(str);
  return camel.charAt(0).toUpperCase() + camel.slice(1);
}

/**
 * Capitalizes the first letter of a string (assumes already camelCase)
 * Example: "userName" → "UserName"
 */
export function toPascalCaseFromVar(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * Converts underscore_case to Title Case (for UI labels)
 * Example: "user_name" → "User Name"
 */
export function toTitleCase(str: string): string {
  return str.split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
}

/**
 * Converts to camelCase and escapes JavaScript reserved words
 * Example: "class" → "classValue", "user_name" → "userName"
 */
export function safeVarName(name: string): string {
  const camel = toCamelCase(name);
  return RESERVED_WORDS.has(camel) ? `${camel}Value` : camel;
}

/**
 * Removes trailing 's' from a name (basic pluralization)
 * Preserves the original case style
 * Example: "users" → "user", "Users" → "User"
 */
export function singularize(name: string): string {
  if (!name) return name;
  const isPascal = name[0] === name[0].toUpperCase();
  const lower = name.toLowerCase();
  if (!lower.endsWith('s')) {
    return name;
  }
  const base = name.slice(0, -1);
  if (isPascal) {
    return base.charAt(0).toUpperCase() + base.slice(1);
  }
  return base;
}
