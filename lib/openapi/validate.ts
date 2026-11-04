/**
 * Structural validity checks for a (filtered) OpenAPI document: the problems
 * a filter could introduce. No dependencies, so Vitest and Cypress share it.
 * Returns a list of problems; an empty list means the document is valid.
 */
type JsonObject = Record<string, unknown>;

const HTTP_METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'];

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function resolvePointer(root: unknown, ref: string): boolean {
  if (!ref.startsWith('#/')) return false;
  let node: unknown = root;
  for (const raw of ref.slice(2).split('/')) {
    const key = raw.replace(/~1/g, '/').replace(/~0/g, '~');
    if (!isObject(node) || !(key in node)) return false;
    node = node[key];
  }
  return true;
}

function walkRefs(value: unknown, visit: (ref: string) => void): void {
  if (Array.isArray(value)) value.forEach((item) => walkRefs(item, visit));
  else if (isObject(value)) {
    for (const [key, child] of Object.entries(value)) {
      if (key === '$ref' && typeof child === 'string') visit(child);
      else walkRefs(child, visit);
    }
  }
}

export function findOpenApiProblems(document: unknown): string[] {
  const problems: string[] = [];
  if (!isObject(document)) return ['document is not an object'];
  if (typeof document.openapi !== 'string' || !/^3\.\d+\.\d+$/.test(document.openapi)) problems.push('openapi version missing or malformed');
  if (!isObject(document.info) || typeof document.info.title !== 'string' || typeof document.info.version !== 'string') {
    problems.push('info.title / info.version missing');
  }
  if (!isObject(document.paths)) return [...problems, 'paths is not an object'];

  const declaredTags = new Set(
    (Array.isArray(document.tags) ? document.tags : []).map((t) => (isObject(t) ? String(t.name) : '')),
  );
  const schemas = isObject(document.components) && isObject(document.components.schemas) ? document.components.schemas : {};

  walkRefs(document, (ref) => {
    if (!resolvePointer(document, ref)) problems.push(`unresolved $ref ${ref}`);
  });
  for (const [path, item] of Object.entries(document.paths)) {
    if (!path.startsWith('/')) problems.push(`path ${path} does not start with /`);
    if (!isObject(item)) {
      problems.push(`path ${path} is not an object`);
      continue;
    }
    const methods = HTTP_METHODS.filter((m) => m in item);
    if (methods.length === 0) problems.push(`path ${path} has no operation`);
    for (const method of methods) {
      const op = item[method];
      if (!isObject(op) || !isObject(op.responses) || Object.keys(op.responses).length === 0) {
        problems.push(`${method.toUpperCase()} ${path} has no responses`);
        continue;
      }
      for (const tag of Array.isArray(op.tags) ? op.tags : []) {
        if (!declaredTags.has(String(tag))) problems.push(`${method.toUpperCase()} ${path} uses undeclared tag ${String(tag)}`);
      }
    }
  }
  for (const [name, schema] of Object.entries(schemas)) {
    if (!isObject(schema)) problems.push(`schema ${name} is not an object`);
    else if (Array.isArray(schema['x-relationships']) && schema['x-relationships'].length === 0) {
      problems.push(`schema ${name} has an empty x-relationships`);
    }
  }
  return problems;
}
