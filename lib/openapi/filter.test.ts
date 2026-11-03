import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { canAccessEntity } = vi.hoisted(() => ({ canAccessEntity: vi.fn() }));
vi.mock('@/lib/authz', () => ({ canAccessEntity }));

import {
  NON_ENTITY_TAGS,
  entitiesToCheck,
  entityTagsOf,
  filterOpenApiDocument,
  filterOpenApiDocumentForUser,
  unclassifiedTags,
} from './filter';
import { findOpenApiProblems } from './validate';

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const okResponse = (schema: unknown) => ({ '200': { description: 'ok', content: { 'application/json': { schema } } } });

/** A small document shaped like the generated one: three entities plus the non-entity `mention` tag. */
function fixture(): Record<string, unknown> {
  return {
    openapi: '3.1.0',
    info: { title: 'Generated API', version: '1.0.0' },
    tags: [{ name: 'user' }, { name: 'role' }, { name: 'widget' }, { name: 'mention' }],
    paths: {
      '/api/user': { get: { tags: ['user'], responses: okResponse(ref('User')) }, post: { tags: ['user'], responses: okResponse(ref('Error')) } },
      '/api/user/{id}': { parameters: [], get: { tags: ['user'], responses: okResponse(ref('User')) } },
      '/api/role': { get: { tags: ['role'], responses: okResponse(ref('Role')) } },
      '/api/widget': { get: { tags: ['widget'], responses: okResponse(ref('Widget')) }, post: { tags: ['widget'], responses: okResponse(ref('Error')) } },
      '/api/mention/users': { get: { tags: ['mention'], responses: okResponse(ref('MentionUserOption')) } },
    },
    components: {
      schemas: {
        Error: { type: 'object' },
        MentionUserOption: { type: 'object' },
        User: {
          type: 'object',
          'x-relationships': [
            { cardinality: 'many-to-many', field: 'roles', target: 'role' },
            { cardinality: 'one-to-many', field: 'items', target: 'dashboard_widget' },
          ],
        },
        Role: { type: 'object', 'x-relationships': [{ cardinality: 'many-to-many', field: 'users', target: 'user' }] },
        Widget: { type: 'object', 'x-relationships': [{ cardinality: 'one-to-many', field: 'owner', target: 'role' }] },
      },
      securitySchemes: { ApiKeyHeader: { type: 'apiKey', in: 'header', name: 'X-API-Key' } },
    },
    security: [{ ApiKeyHeader: [] }],
  };
}

const tagNames = (doc: Record<string, unknown>) => (doc.tags as { name: string }[]).map((t) => t.name);
const schemaNames = (doc: Record<string, unknown>) => Object.keys((doc.components as { schemas: object }).schemas);

describe('filterOpenApiDocument', () => {
  it('returns a deep-equal document when every entity is readable', () => {
    const doc = fixture();
    const filtered = filterOpenApiDocument(doc, new Set(['user', 'role', 'widget']));
    expect(filtered).toEqual(doc);
    expect(filtered).not.toBe(doc);
  });

  it('removes the tag, paths and schemas of an unreadable entity and keeps the rest', () => {
    const filtered = filterOpenApiDocument(fixture(), new Set(['user', 'widget']));
    expect(tagNames(filtered)).toEqual(['user', 'widget', 'mention']);
    expect(Object.keys(filtered.paths as object)).not.toContain('/api/role');
    expect(schemaNames(filtered)).not.toContain('Role');
    expect(schemaNames(filtered)).toEqual(expect.arrayContaining(['User', 'Widget', 'Error', 'MentionUserOption']));
    expect(findOpenApiProblems(filtered)).toEqual([]);
  });

  it('drops x-relationships entries that point at a removed entity and keeps the other entries', () => {
    const filtered = filterOpenApiDocument(fixture(), new Set(['user', 'widget']));
    const schemas = (filtered.components as { schemas: Record<string, Record<string, unknown>> }).schemas;
    expect(schemas.User['x-relationships']).toEqual([{ cardinality: 'one-to-many', field: 'items', target: 'dashboard_widget' }]);
  });

  it('removes the x-relationships key when no entry is left', () => {
    const filtered = filterOpenApiDocument(fixture(), new Set(['user', 'widget']));
    const schemas = (filtered.components as { schemas: Record<string, Record<string, unknown>> }).schemas;
    expect('x-relationships' in schemas.Widget).toBe(false);
  });

  it('keeps create, update and delete operations for an entity the caller can read', () => {
    const filtered = filterOpenApiDocument(fixture(), new Set(['widget']));
    const paths = filtered.paths as Record<string, Record<string, unknown>>;
    expect(Object.keys(paths['/api/widget'])).toEqual(['get', 'post']);
  });

  it('hides the mention tag from a caller who cannot read user, and shows it to one who can', () => {
    expect(tagNames(filterOpenApiDocument(fixture(), new Set(['widget'])))).not.toContain('mention');
    expect(Object.keys(filterOpenApiDocument(fixture(), new Set(['widget'])).paths as object)).not.toContain('/api/mention/users');
    expect(tagNames(filterOpenApiDocument(fixture(), new Set(['user'])))).toContain('mention');
  });

  it('keeps a shared schema that a remaining operation still uses', () => {
    // Error is used by user POST and widget POST; removing widget must keep it for a user reader.
    const filtered = filterOpenApiDocument(fixture(), new Set(['user']));
    expect(schemaNames(filtered)).toContain('Error');
  });

  it('leaves no tag and no path for a caller who can read nothing', () => {
    const filtered = filterOpenApiDocument(fixture(), new Set());
    expect(tagNames(filtered)).toEqual([]);
    expect(filtered.paths).toEqual({});
    expect(findOpenApiProblems(filtered)).toEqual([]);
  });

  it('does not modify the input document', () => {
    const doc = fixture();
    const before = JSON.stringify(doc);
    filterOpenApiDocument(doc, new Set(['widget']));
    expect(JSON.stringify(doc)).toBe(before);
  });

  it('hides a tag that is neither an entity nor listed, even from a caller who can read everything', () => {
    const doc = fixture();
    (doc.tags as unknown[]).push({ name: 'unknown_tag' });
    (doc.paths as Record<string, unknown>)['/api/unknown/thing'] = { get: { tags: ['unknown_tag'], responses: okResponse(ref('Error')) } };
    expect(unclassifiedTags(doc)).toEqual(['unknown_tag']);
    expect(tagNames(filterOpenApiDocument(doc, new Set(['user', 'role', 'widget'])))).not.toContain('unknown_tag');
  });
});

describe('tag classification', () => {
  it('treats a tag that owns a path at or below /api/<tag> as an entity', () => {
    expect(entityTagsOf(fixture())).toEqual(['user', 'role', 'widget']);
  });

  it('checks the entity behind each non-entity tag instead of the tag name', () => {
    expect(NON_ENTITY_TAGS).toEqual({ mention: 'user' });
    expect(entitiesToCheck(fixture()).sort()).toEqual(['role', 'user', 'widget']);
    expect(unclassifiedTags(fixture())).toEqual([]);
  });
});

describe('the real generated document', () => {
  const real = JSON.parse(readFileSync(join(process.cwd(), 'docs/generated/openapi.json'), 'utf8')) as Record<string, unknown>;
  const names = (real.tags as { name: string }[]).map((t) => t.name);

  it('has no tag that is neither an entity nor listed in the exception table', () => {
    expect(unclassifiedTags(real)).toEqual([]);
  });

  it('classifies a self-only entity without a bare collection path (setting) as an entity', () => {
    expect(names).toContain('setting');
    expect(Object.keys(real.paths as object)).not.toContain('/api/setting');
    expect(entityTagsOf(real)).toContain('setting');
  });

  it('classifies every tag as an entity or an exception-table tag, with mention governed by user', () => {
    const entities = new Set(entityTagsOf(real));
    for (const tag of names) expect(entities.has(tag) || tag in NON_ENTITY_TAGS).toBe(true);
    expect(entitiesToCheck(real)).not.toContain('mention');
  });

  it('returns a document identical to the source for a caller who can read every entity', () => {
    const readable = new Set(entitiesToCheck(real));
    expect(filterOpenApiDocument(real, readable)).toEqual(real);
  });
});

describe('filterOpenApiDocumentForUser', () => {
  beforeEach(() => canAccessEntity.mockReset());

  it('asks the permission check for read on each governing entity and filters by the answers', async () => {
    canAccessEntity.mockImplementation(async (entity: string) => entity === 'widget');
    const filtered = await filterOpenApiDocumentForUser(fixture(), 'user-1');
    expect(tagNames(filtered)).toEqual(['widget']);
    expect(canAccessEntity).toHaveBeenCalledWith('role', 'read', 'user-1');
    expect(canAccessEntity).toHaveBeenCalledTimes(3);
  });

  it('returns the full document for a caller who can read every entity', async () => {
    canAccessEntity.mockResolvedValue(true);
    expect(await filterOpenApiDocumentForUser(fixture(), 'admin')).toEqual(fixture());
  });
});

describe('findOpenApiProblems', () => {
  it('reports a dangling $ref and an undeclared tag', () => {
    const doc = fixture();
    (doc.paths as Record<string, Record<string, Record<string, unknown>>>)['/api/role'].get.responses = okResponse(ref('Gone'));
    (doc.tags as unknown[]).splice(1, 1);
    const problems = findOpenApiProblems(doc);
    expect(problems.some((p) => p.includes('#/components/schemas/Gone'))).toBe(true);
    expect(problems.some((p) => p.includes('undeclared tag role'))).toBe(true);
  });
});
