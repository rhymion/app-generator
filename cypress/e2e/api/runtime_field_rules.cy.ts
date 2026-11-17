// Hand-written -- not part of the generated entity test set.
// Issue #1271 (ASVS V2.2.1): the generated service validation rejects a value of the wrong JSON
// type, and a value outside a declared enum, with 422 and writes nothing. Unknown body keys are
// still dropped, not rejected.
import { TEST_API_KEY } from '../../support/test-credentials';

const headers = { 'X-API-Key': TEST_API_KEY };

type Row = { id: string; [k: string]: unknown };

function roleTotal(): Cypress.Chainable<number> {
  return cy.request({ url: '/api/role?pageSize=1', headers }).then((res) => res.body.total as number);
}

describe('API: submitted values are checked against the schema rules (Issue #1271)', () => {
  beforeEach(() => {
    cy.task('db:reset');
    cy.task('db:seed');
    cy.task('db:grantAllPermissions');
  });

  it('refuses a value of the wrong type with 422 and creates nothing', () => {
    roleTotal().then((before) => {
      cy.request({ method: 'POST', url: '/api/role', headers, body: { name: 12345 }, failOnStatusCode: false }).then((res) => {
        expect(res.status).to.eq(422);
        expect(JSON.stringify(res.body)).to.contain('Name must be a string');
      });
      roleTotal().should('eq', before);
    });
  });

  it('drops an unknown key and accepts the rest of the body', () => {
    cy.request({ method: 'POST', url: '/api/role', headers, body: { name: `rules-${Date.now()}`, not_a_field: 'x' } }).then((res) => {
      expect(res.status).to.eq(201);
      expect(res.body).not.to.have.property('not_a_field');
    });
  });

  it('refuses a value outside a declared enum and a wrongly typed boolean, leaving the row unchanged', () => {
    cy.task<Row[]>('db:populateAppSetting', 1).then((rows) => {
      const id = rows[0].id;
      cy.request({ url: `/api/app_setting/${id}`, headers }).then((before) => {
        cy.request({ method: 'PUT', url: `/api/app_setting/${id}`, headers, body: { ...before.body, timezone: 'mars_olympus_mons' }, failOnStatusCode: false }).then((res) => {
          expect(res.status).to.eq(422);
          expect(JSON.stringify(res.body)).to.contain('Timezone must be one of the allowed values');
        });
        cy.request({ method: 'PUT', url: `/api/app_setting/${id}`, headers, body: { ...before.body, is_pinned: 'yes' }, failOnStatusCode: false }).then((res) => {
          expect(res.status).to.eq(422);
          expect(JSON.stringify(res.body)).to.contain('Is Pinned must be true or false');
        });
        cy.request({ url: `/api/app_setting/${id}`, headers }).then((after) => {
          expect(after.body.timezone).to.eq(before.body.timezone);
          expect(after.body.is_pinned).to.eq(before.body.is_pinned);
        });
      });
    });
  });
});
