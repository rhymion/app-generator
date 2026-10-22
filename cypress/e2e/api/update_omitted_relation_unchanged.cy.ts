// Hand-written (not generator-produced) — Issue #777.
//
// A REST update that omits a relation/child-list field must leave the
// existing relation unchanged; an explicitly supplied list (including [])
// replaces it. Exercised against role.users (a many-to-many, connect-style
// relation) via both PUT /api/role/:id and bulk PUT /api/role/bulk.
import { TEST_API_KEY } from '../../support/test-credentials';

const headers = { 'X-API-Key': TEST_API_KEY };

function firstUserId(): Cypress.Chainable<string> {
  return cy.request({ url: '/api/user', headers }).then((res) => {
    expect(res.status).to.eq(200);
    expect(res.body.rows.length).to.be.greaterThan(0);
    return res.body.rows[0].id as string;
  });
}

function createRoleWithUser(userId: string): Cypress.Chainable<string> {
  return cy.request({
    method: 'POST',
    url: '/api/role',
    headers,
    body: { name: `issue777-${Date.now()}`, description: 'before', users_ids: [userId] },
  }).then((res) => {
    expect(res.status).to.eq(201);
    return res.body.id as string;
  });
}

function roleUserIds(roleId: string): Cypress.Chainable<string[]> {
  return cy.request({ url: `/api/role/${roleId}`, headers }).then((res) => {
    expect(res.status).to.eq(200);
    return (res.body.users as { id: string }[]).map((u) => u.id);
  });
}

describe('API: update keeps an omitted relation unchanged (Issue #777)', () => {
  beforeEach(() => {
    cy.task('db:reset');
    cy.task('db:seed');
    cy.task('db:grantAllPermissions');
  });

  it('PUT without users_ids keeps the role users; users_ids: [] clears them', () => {
    firstUserId().then((userId) => {
      createRoleWithUser(userId).then((roleId) => {
        roleUserIds(roleId).should('deep.eq', [userId]);

        cy.request({
          method: 'PUT',
          url: `/api/role/${roleId}`,
          headers,
          body: { name: `issue777-renamed-${Date.now()}`, description: 'after' },
        }).its('status').should('eq', 200);
        roleUserIds(roleId).should('deep.eq', [userId]);

        cy.request({
          method: 'PUT',
          url: `/api/role/${roleId}`,
          headers,
          body: { name: `issue777-cleared-${Date.now()}`, description: 'after', users_ids: [] },
        }).its('status').should('eq', 200);
        roleUserIds(roleId).should('deep.eq', []);
      });
    });
  });

  it('bulk PUT without users_ids keeps the role users', () => {
    firstUserId().then((userId) => {
      createRoleWithUser(userId).then((roleId) => {
        cy.request({
          method: 'PUT',
          url: '/api/role/bulk',
          headers,
          body: [{ id: roleId, name: `issue777-bulk-${Date.now()}`, description: 'bulk' }],
        }).then((res) => {
          expect(res.status).to.eq(207);
          expect(res.body.results[0].success).to.eq(true);
        });
        roleUserIds(roleId).should('deep.eq', [userId]);
      });
    });
  });
});
