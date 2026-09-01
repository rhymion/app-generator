import { TEST_API_KEY } from '../../support/test-credentials';

const API_BASE = '/api/user';
const INVALIDATE_PATH = (id: string) => `${API_BASE}/${id}/actions/invalidate`;

describe('API: User Invalidate (cmd_243)', () => {
  beforeEach(() => {
    cy.task('db:reset');
    cy.task('db:seed');
    cy.task('db:grantAllPermissions');
  });

  it('Delete permission holder can invalidate user', () => {
    cy.task<any[]>('db:populateUser', 1).then((records) => {
      const userId = records[0].id;
      cy.request({
        method: 'POST',
        url: INVALIDATE_PATH(userId),
        headers: { 'X-API-Key': TEST_API_KEY },
      }).then((res) => {
        expect(res.status).to.eq(200);
        expect(res.body.success).to.eq(true);
        // Verify PII scrubbed: fetch user via API and confirm anonymization.
        // `name` is checked via /api/user itself; `email` is not part of
        // user's own x-generate.fields (deliberately -- it is exposed only
        // through the self-only, admin-bypass-with-audit `setting` proxy
        // view, see json_schema.yaml's `setting` entity comment), so its
        // post-scrub value is verified through /api/setting/<id> instead
        // (subtask_892d GAP2: get{Parent}Detail()'s findUnique/findFirst is
        // now select-scoped to the declared fields, so /api/user no longer
        // leaks columns outside that declared set -- email included).
        cy.request({
          url: `${API_BASE}/${userId}`,
          headers: { 'X-API-Key': TEST_API_KEY },
        }).then((getRes) => {
          expect(getRes.status).to.eq(200);
          expect(getRes.body.name).to.eq('[deleted]');
        });
        cy.request({
          url: `/api/setting/${userId}`,
          headers: { 'X-API-Key': TEST_API_KEY },
        }).then((settingRes) => {
          expect(settingRes.status).to.eq(200);
          expect(settingRes.body.email).to.include('@deleted.invalid');
        });
      });
    });
  });

  it('Non-delete-permission user cannot invalidate (API rejects)', () => {
    cy.task<any[]>('db:populateUser', 1).then((records) => {
      const userId = records[0].id;
      cy.task<string>('db:createLimitedApiUser', 'user').then((limitedKey) => {
        cy.request({
          method: 'POST',
          url: INVALIDATE_PATH(userId),
          headers: { 'X-API-Key': limitedKey },
          failOnStatusCode: false,
        }).then((res) => {
          expect(res.status).to.eq(403);
        });
      });
    });
  });

  it('delete:false entity has no Delete button in UI', () => {
    // Verify the generated FormUpsert passes onDelete=undefined (delete:false in schema)
    cy.readFile('components/user/FormUpsert.tsx').then((content: string) => {
      expect(content).to.include('onDelete={undefined}');
      expect(content).not.to.include('remove{{ parent_pascal }}');
      expect(content).not.to.include('handleDelete');
    });
  });

  it('invalidate: false entity has no Invalidate button and no API endpoint', () => {
    // Verify that an entity without invalidate flag (e.g. role) has no invalidate API route
    cy.request({
      method: 'POST',
      url: '/api/role/some-id/actions/invalidate',
      headers: { 'X-API-Key': TEST_API_KEY },
      failOnStatusCode: false,
    }).then((res) => {
      expect(res.status).to.eq(404);
    });
    // Verify FormUpsert for role has no onInvalidate prop
    cy.readFile('components/role/FormUpsert.tsx').then((content: string) => {
      expect(content).not.to.include('onInvalidate');
      expect(content).not.to.include('handleInvalidate');
    });
  });
});
