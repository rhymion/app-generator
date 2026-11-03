import { canAccessEntity } from '@/lib/authz';

/**
 * Per-caller filtering of the generated OpenAPI document (Issue #1161).
 *
 * `docs/generated/openapi.json` is the full document. GET /api/openapi.json
 * returns, for each caller, only the entities that caller may READ: the tag,
 * the paths and the component schemas of every other entity are removed, and
 * the `x-relationships` entries that point at a removed entity are dropped
 * (the key is removed when no entry is left). A caller who may read every
 * entity receives the full document unchanged.
 *
 * Operations are never removed one by one: a caller who can read but not write
 * an entity still sees its create / update / delete operations. The document
 * describes which endpoints exist and their shapes; per-record abilities come
 * from the capabilities endpoint and writes are enforced by the route (403).
 *
 * An entity tag is a tag that has the collection path `/api/<tag>`, which the
 * generator writes for every entity it documents. A tag that is not an entity
 * is listed in {@link NON_ENTITY_TAGS} with the entity whose read permission
 * governs it. A tag that is neither is hidden from every caller, and
 * lib/openapi/filter.test.ts fails when the generated document contains one.
 */

type JsonObject = Record<string, unknown>;

/** Tags of the document that are not entities, mapped to the entity whose read permission governs them. */
export const NON_ENTITY_TAGS: Readonly<Record<string, string>> = {
  // GET /api/mention/users offers user candidates; searchMentionUserOptions
  // checks the caller's read permission on `user`.
  mention: 'user',
};

const HTTP_METHODS = new Set(['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace']);
const SCHEMA_REF_PREFIX = '#/components/schemas/';

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function documentTags(document: JsonObject): string[] {
  const tags = Array.isArray(document.tags) ? document.tags : [];
  return tags
    .map((tag) => (isObject(tag) && typeof tag.name === 'string' ? tag.name : null))
    .filter((name): name is string => name !== null);
}

/** The tags of the document that are entities (they have the collection path `/api/<tag>`). */
export function entityTagsOf(document: JsonObject): string[] {
  const paths = isObject(document.paths) ? document.paths : {};
  return documentTags(document).filter((tag) => `/api/${tag}` in paths);
}

/**
 * The entity whose read permission governs `tag`: the tag itself for an
 * entity, the mapped entity for a listed non-entity tag, null for any other.
 */
export function governingEntity(document: JsonObject, tag: string): string | null {
  if (entityTagsOf(document).includes(tag)) return tag;
  return NON_ENTITY_TAGS[tag] ?? null;
}

/** Tags that are neither entities nor listed in {@link NON_ENTITY_TAGS}. */
export function unclassifiedTags(document: JsonObject): string[] {
  const entities = new Set(entityTagsOf(document));
  return documentTags(document).filter((tag) => !entities.has(tag) && !(tag in NON_ENTITY_TAGS));
}

/** Every distinct entity whose read permission decides what the caller sees. */
export function entitiesToCheck(document: JsonObject): string[] {
  const names = new Set<string>();
  for (const tag of documentTags(document)) {
    const entity = governingEntity(document, tag);
    if (entity) names.add(entity);
  }
  return [...names];
}

function collectRefs(value: unknown, into: Set<string>): void {
  if (Array.isArray(value)) {
    for (const item of value) collectRefs(item, into);
  } else if (isObject(value)) {
    for (const [key, child] of Object.entries(value)) {
      if (key === '$ref' && typeof child === 'string' && child.startsWith(SCHEMA_REF_PREFIX)) {
        into.add(child.slice(SCHEMA_REF_PREFIX.length));
      } else {
        collectRefs(child, into);
      }
    }
  }
}

/** Names of the component schemas reachable from `roots`, following `$ref` through the schemas. */
function reachableSchemas(roots: unknown[], schemas: JsonObject): Set<string> {
  const reached = new Set<string>();
  const queue: string[] = [];
  const enqueueFrom = (value: unknown) => {
    const refs = new Set<string>();
    collectRefs(value, refs);
    for (const ref of refs) {
      if (!reached.has(ref)) {
        reached.add(ref);
        queue.push(ref);
      }
    }
  };
  roots.forEach(enqueueFrom);
  while (queue.length > 0) {
    const name = queue.pop() as string;
    if (name in schemas) enqueueFrom(schemas[name]);
  }
  return reached;
}

/**
 * Returns the document limited to the entities in `readable` (entity model
 * names the caller may read). The input is not modified. When nothing has to
 * be removed the result is deep-equal to the input.
 */
export function filterOpenApiDocument(document: JsonObject, readable: ReadonlySet<string>): JsonObject {
  const visibleTag = (tag: string): boolean => {
    const entity = governingEntity(document, tag);
    return entity !== null && readable.has(entity);
  };
  const hiddenTags = new Set(documentTags(document).filter((tag) => !visibleTag(tag)));
  if (hiddenTags.size === 0) return structuredClone(document);

  const entityTags = new Set(entityTagsOf(document));
  const hiddenEntities = new Set([...hiddenTags].filter((tag) => entityTags.has(tag)));
  const sourcePaths = isObject(document.paths) ? document.paths : {};
  const keptPaths: JsonObject = {};
  const removedOperations: unknown[] = [];
  const keptOperations: unknown[] = [];

  for (const [path, item] of Object.entries(sourcePaths)) {
    if (!isObject(item)) {
      keptPaths[path] = item;
      continue;
    }
    const keptItem: JsonObject = {};
    let operationsKept = 0;
    let operationsSeen = 0;
    for (const [key, value] of Object.entries(item)) {
      if (!HTTP_METHODS.has(key) || !isObject(value)) {
        keptItem[key] = value;
        continue;
      }
      operationsSeen += 1;
      const tags = Array.isArray(value.tags) ? value.tags.filter((t): t is string => typeof t === 'string') : [];
      if (tags.some((tag) => hiddenTags.has(tag))) {
        removedOperations.push(value);
      } else {
        keptItem[key] = value;
        keptOperations.push(value);
        operationsKept += 1;
      }
    }
    if (operationsSeen === 0 || operationsKept > 0) keptPaths[path] = keptItem;
  }

  const components = isObject(document.components) ? document.components : {};
  const sourceSchemas = isObject(components.schemas) ? components.schemas : {};
  const stillNeeded = reachableSchemas(
    [...keptOperations, ...Object.entries(components).filter(([k]) => k !== 'schemas').map(([, v]) => v)],
    sourceSchemas,
  );
  const goneSchemas = reachableSchemas(removedOperations, sourceSchemas);
  const keptSchemas: JsonObject = {};
  for (const [name, schema] of Object.entries(sourceSchemas)) {
    if (goneSchemas.has(name) && !stillNeeded.has(name)) continue;
    keptSchemas[name] = scrubRelationships(schema, hiddenEntities);
  }

  const result: JsonObject = {
    ...document,
    tags: (Array.isArray(document.tags) ? document.tags : []).filter(
      (tag) => !(isObject(tag) && typeof tag.name === 'string' && hiddenTags.has(tag.name)),
    ),
    paths: keptPaths,
    components: { ...components, schemas: keptSchemas },
  };
  return structuredClone(result);
}

/** Drops the `x-relationships` entries whose target is a removed entity; removes the key when none is left. */
function scrubRelationships(schema: unknown, hiddenEntities: ReadonlySet<string>): unknown {
  if (!isObject(schema) || !Array.isArray(schema['x-relationships'])) return schema;
  const entries = schema['x-relationships'].filter(
    (entry) => !(isObject(entry) && typeof entry.target === 'string' && hiddenEntities.has(entry.target)),
  );
  if (entries.length === schema['x-relationships'].length) return schema;
  const { 'x-relationships': _dropped, ...rest } = schema;
  void _dropped;
  return entries.length > 0 ? { ...rest, 'x-relationships': entries } : rest;
}

/**
 * The document as `userId` may see it: limited to the entities the user may
 * read, using the same permission check as every entity route (so the 30 s
 * permission cache and the single permission query per request are reused).
 */
export async function filterOpenApiDocumentForUser(document: JsonObject, userId: string): Promise<JsonObject> {
  const entities = entitiesToCheck(document);
  const verdicts = await Promise.all(
    entities.map(async (entity) => [entity, await canAccessEntity(entity, 'read', userId)] as const),
  );
  const readable = new Set(verdicts.filter(([, allowed]) => allowed).map(([entity]) => entity));
  return filterOpenApiDocument(document, readable);
}
