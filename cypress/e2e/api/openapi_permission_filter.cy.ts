// Handwritten supplemental spec — NOT auto-generated, NOT overwritten by generate-code.
// Tests: GET /api/openapi.json is limited to the entities the caller may READ
// (Issue #1161). The full document is docs/generated/openapi.json; a caller who may
// read every entity receives it unchanged.
import { TEST_API_KEY } from '../../support/test-credentials';
import { findOpenApiProblems } from '../../../lib/openapi/validate';

const OPENAPI_URL = '/api/openapi.json';

type OpenApiDoc = {
  tags: { name: string }[];
  paths: Record<string, Record<string, { tags?: string[] }>>;
  components: { schemas: Record<string, { 'x-relationships'?: { target: string }[] }> };
};

const tagNames = (doc: OpenApiDoc) => doc.tags.map((t) => t.name);
const fetchDocument = (apiKey: string) =>
  cy.request({ url: OPENAPI_URL, headers: { 'X-API-Key': apiKey } }).then((res) => {
    expect(res.status).to.eq(200);
    return res.body as OpenApiDoc;
  });

describe('API: GET /api/openapi.json is limited to the caller\'s readable entities', () => {
  beforeEach(() => {
    cy.task('db:reset');
    cy.task('db:seed');
  });

  it('gives a caller with every permission the full document, unchanged', () => {
    cy.task('db:grantAllPermissions');
    cy.readFile('docs/generated/openapi.json').then((full: OpenApiDoc) => {
      fetchDocument(TEST_API_KEY).then((doc) => {
        expect(doc).to.deep.eq(full);
        expect(findOpenApiProblems(doc)).to.deep.eq([]);
      });
    });
  });

  it('lists only entity-free content for a caller without any read permission', () => {
    cy.task<string>('db:createLimitedApiUser', 'audit_log').then((key) => {
      fetchDocument(key).then((doc) => {
        expect(tagNames(doc), 'tags').to.deep.eq([]);
        expect(Object.keys(doc.paths), 'paths').to.deep.eq([]);
        expect(Object.keys(doc.components.schemas), 'schemas').to.not.include.members(['User', 'Role', 'Permission']);
        expect(findOpenApiProblems(doc)).to.deep.eq([]);
      });
    });
  });

  it('lists only the entity a single-entity reader may read, and keeps its write operations', () => {
    cy.task<string>('db:createApiUserWithPermission', {
      entityName: 'role',
      flags: { read: true },
      label: 'openapireader',
    }).then((key) => {
      fetchDocument(key).then((doc) => {
        expect(tagNames(doc)).to.deep.eq(['role']);
        expect(Object.keys(doc.paths).every((p) => p.startsWith('/api/role'))).to.eq(true);
        const methods = Object.keys(doc.paths['/api/role']);
        expect(methods, 'create stays listed for a reader').to.include.members(['get', 'post']);
        expect(Object.keys(doc.components.schemas)).to.include('Role');
        expect(Object.keys(doc.components.schemas)).to.not.include('User');
        // No remaining schema points at a removed entity.
        for (const schema of Object.values(doc.components.schemas)) {
          for (const rel of schema['x-relationships'] ?? []) {
            expect(['user', 'permission', 'organization', 'approval_flow']).to.not.include(rel.target);
          }
        }
        expect(findOpenApiProblems(doc)).to.deep.eq([]);
      });
    });
  });

  it('offers the mention search only to a caller who may read user', () => {
    cy.task<string>('db:createApiUserWithPermission', {
      entityName: 'user',
      flags: { read: true },
      label: 'openapimention',
    }).then((key) => {
      fetchDocument(key).then((doc) => {
        expect(tagNames(doc)).to.include('user');
        expect(findOpenApiProblems(doc)).to.deep.eq([]);
      });
    });
    cy.task<string>('db:createApiUserWithPermission', {
      entityName: 'role',
      flags: { read: true },
      label: 'openapinomention',
    }).then((key) => {
      fetchDocument(key).then((doc) => {
        expect(tagNames(doc)).to.not.include('mention');
        expect(Object.keys(doc.paths)).to.not.include('/api/mention/users');
      });
    });
  });

  it('follows the key owner: a key whose owner has no read permission gets nothing an owner with it would see', () => {
    cy.task<string>('db:createApiUserWithPermission', {
      entityName: 'role',
      flags: { read: false, create: true },
      label: 'openapiwriteonly',
    }).then((key) => {
      fetchDocument(key).then((doc) => {
        expect(tagNames(doc)).to.not.include('role');
      });
    });
  });

  it('lists only declared tags that own an entity path or are the mention search in the full document', () => {
    cy.task('db:grantAllPermissions');
    fetchDocument(TEST_API_KEY).then((doc) => {
      for (const tag of tagNames(doc)) {
        const ownsPath = Object.keys(doc.paths).some((p) => p === `/api/${tag}` || p.startsWith(`/api/${tag}/`));
        expect(ownsPath || tag === 'mention', `tag ${tag}`).to.eq(true);
      }
    });
  });
});

describe('Swagger UI shows the filtered document', () => {
  it('loads the spec from the filtered route, same origin', () => {
    cy.readFile('app/[locale]/swagger/SwaggerUIClient.tsx').should('include', "url: '/api/openapi.json'");
  });
});
