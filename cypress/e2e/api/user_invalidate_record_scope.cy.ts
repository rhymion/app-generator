// Hand-written -- not part of the generated entity test set.
// POST /api/user/:id/actions/invalidate authorizes against the record, not just the model:
// a Creator-role delete grant on the model must not let every authenticated caller invalidate
// every record. It applies only to records the caller created.
import { TEST_API_KEY } from '../../support/test-credentials';

const INVALIDATE_PATH = (id: string) => `/api/user/${id}/actions/invalidate`;

function userIdByName(name: string): Cypress.Chainable<string> {
  return cy
    .request({ url: '/api/user', headers: { 'X-API-Key': TEST_API_KEY } })
    .then((res) => {
      const row = (res.body.rows as { id: string; name: string }[]).find((u) => u.name === name);
      expect(row, name).to.exist;
      return row!.id;
    });
}

describe('API: user invalidate is scoped to the record (Creator grant)', () => {
  beforeEach(() => {
    cy.task('db:reset');
    cy.task('db:seed');
    cy.task('db:grantAllPermissions');
    // The Creator role may delete users: the broadest model-level flag is now true for every caller.
    cy.task('db:grantCreatorRolePermission', { entityName: 'user', flags: { read: true, delete: true } });
  });

  it("refuses a caller invalidating a record they did not create, and leaves the record unchanged", () => {
    cy.task<any[]>('db:populateUser', 1).then((records) => {
      const victimId = records[0].id;
      cy.task<string>('db:createLimitedApiUser', 'user').then((limitedKey) => {
        cy.request({
          method: 'POST',
          url: INVALIDATE_PATH(victimId),
          headers: { 'X-API-Key': limitedKey },
          failOnStatusCode: false,
        }).then((res) => {
          expect(res.status).to.eq(403);
        });
      });
      cy.request({ url: `/api/user/${victimId}`, headers: { 'X-API-Key': TEST_API_KEY } }).then((res) => {
        expect(res.status).to.eq(200);
        expect(res.body.name).not.to.eq('[deleted]');
      });
    });
  });

  it('still lets a caller invalidate a record they created (Creator grant applies to own records)', () => {
    cy.task<string>('db:createLimitedApiUser', 'user').then((limitedKey) => {
      // The limited user is its own creator, so the Creator grant covers its own record.
      userIdByName('Limited User (user)').then((ownId) => {
        cy.request({
          method: 'POST',
          url: INVALIDATE_PATH(ownId),
          headers: { 'X-API-Key': limitedKey },
          failOnStatusCode: false,
        }).then((res) => {
          expect(res.status).to.eq(200);
          expect(res.body.success).to.eq(true);
        });
      });
    });
  });

  it('still lets a caller with a general delete grant invalidate any record', () => {
    cy.task<any[]>('db:populateUser', 1).then((records) => {
      const userId = records[0].id;
      cy.task<string>('db:createApiUserWithPermission', {
        entityName: 'user',
        flags: { read: true, delete: true },
        label: 'invalidate_scope',
      }).then((deleterKey) => cy.request({
        method: 'POST',
        url: INVALIDATE_PATH(userId),
        headers: { 'X-API-Key': deleterKey },
      })).then((res) => {
        expect(res.status).to.eq(200);
      });
    });
  });
});
