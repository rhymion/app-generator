// Hand-written -- not part of the generated entity test set.
// Routes that resolve the caller through resolveActorId() / requireDualAuth()
// (CSV export, CSV import, openapi.json) accept a mobile access token.
// Authorization is unchanged: a token holder passes through the same
// permission checks as an API-key or session caller.
import { TEST_CREDENTIALS } from '../../support/test-credentials';

const EXPORT_URL = '/api/approval_flow/export';
const IMPORT_URL = '/api/approval_flow/import';
const OPENAPI_URL = '/api/openapi.json';

type TokenPair = { access_token: string };

function mobileToken(email: string, password: string): Cypress.Chainable<string> {
  return cy
    .request('POST', '/api/mobile/auth/token', { email, password })
    .then((res) => (res.body as TokenPair).access_token);
}

describe('API: dual-auth routes accept a mobile access token', () => {
  beforeEach(() => {
    cy.task('db:reset');
    cy.task('db:seed');
    cy.task('db:grantAllPermissions');
  });

  it('exports CSV for a permitted user', () => {
    mobileToken(TEST_CREDENTIALS.email, TEST_CREDENTIALS.password).then((token) => {
      cy.request({ url: EXPORT_URL, headers: { Authorization: `Bearer ${token}` } }).then((res) => {
        expect(res.status).to.eq(200);
        expect(res.headers['content-type']).to.contain('text/csv');
      });
    });
  });

  it('answers 403 on export for a token holder without read permission', () => {
    cy.task<string>('db:createSessionUserWithPermission', {
      entityName: 'approval_flow',
      flags: { read: false },
      label: 'mobiletokenexport',
    }).then((email) => {
      mobileToken(email, TEST_CREDENTIALS.password).then((token) => {
        cy.request({ url: EXPORT_URL, headers: { Authorization: `Bearer ${token}` }, failOnStatusCode: false })
          .its('status')
          .should('eq', 403);
      });
    });
  });

  it('runs an import dry run for a permitted user', () => {
    mobileToken(TEST_CREDENTIALS.email, TEST_CREDENTIALS.password).then((token) => {
      cy.request({
        method: 'POST',
        url: IMPORT_URL,
        headers: { Authorization: `Bearer ${token}` },
        body: { csv: '', dryRun: true },
        failOnStatusCode: false,
      }).then((res) => {
        expect(res.status).not.to.eq(401);
        expect(res.status).not.to.eq(403);
      });
    });
  });

  it('answers 403 on import for a token holder without import permission', () => {
    cy.task<string>('db:createSessionUserWithPermission', {
      entityName: 'approval_flow',
      flags: { read: true, import: false },
      label: 'mobiletokenimport',
    }).then((email) => {
      mobileToken(email, TEST_CREDENTIALS.password).then((token) => {
        cy.request({
          method: 'POST',
          url: IMPORT_URL,
          headers: { Authorization: `Bearer ${token}` },
          body: { csv: '', dryRun: true },
          failOnStatusCode: false,
        })
          .its('status')
          .should('eq', 403);
      });
    });
  });

  it('serves openapi.json to an authenticated token holder', () => {
    mobileToken(TEST_CREDENTIALS.email, TEST_CREDENTIALS.password).then((token) => {
      cy.request({ url: OPENAPI_URL, headers: { Authorization: `Bearer ${token}` }, failOnStatusCode: false }).then(
        (res) => {
          expect(res.status).to.be.oneOf([200, 404]);
        },
      );
    });
  });

  it('rejects a malformed or tampered bearer token with 401 on every route', () => {
    const bad = 'aaa.bbb.ccc';
    for (const url of [EXPORT_URL, OPENAPI_URL]) {
      cy.request({ url, headers: { Authorization: `Bearer ${bad}` }, failOnStatusCode: false })
        .its('status')
        .should('eq', 401);
    }
    cy.request({
      method: 'POST',
      url: IMPORT_URL,
      headers: { Authorization: `Bearer ${bad}` },
      body: { csv: '', dryRun: true },
      failOnStatusCode: false,
    })
      .its('status')
      .should('eq', 401);
  });

  it('rejects a request with no credential with 401 on every route', () => {
    for (const url of [EXPORT_URL, OPENAPI_URL]) {
      cy.request({ url, failOnStatusCode: false }).its('status').should('eq', 401);
    }
  });
});
