// Hand-written -- not part of the generated entity test set.
// PUT /api/setting/:id with the write-only fields (password, api_key) left out of the body must leave
// both stored values unchanged (Issue #1155). Both are checked through the credentials they back:
// the password through the mobile token endpoint, the api_key through the X-API-Key header that
// authenticates the follow-up request itself. An explicit new password value is still written.
import { TEST_API_KEY, TEST_CREDENTIALS, hashPassword } from '../../support/test-credentials';

const SETTING_URL = '/api/setting';

function ownUserId(): Cypress.Chainable<string> {
  return cy
    .request({ url: '/api/user', headers: { 'X-API-Key': TEST_API_KEY } })
    .then((res) => {
      const row = (res.body.rows as { id: string; name: string }[]).find((u) => u.name === TEST_CREDENTIALS.name);
      expect(row, 'test user').to.exist;
      return row!.id;
    });
}

function mobileLogin(password: string) {
  return cy.request({
    method: 'POST',
    url: '/api/mobile/auth/token',
    body: { email: TEST_CREDENTIALS.email, password },
    failOnStatusCode: false,
  });
}

describe('API: setting update leaves omitted write-only fields unchanged', () => {
  beforeEach(() => {
    cy.task('db:reset');
    cy.task('db:seed');
    cy.task('db:grantAllPermissions');
  });

  it('keeps the password and api_key when the body omits both', () => {
    ownUserId().then((id) => {
      cy.request({
        method: 'PUT',
        url: `${SETTING_URL}/${id}`,
        headers: { 'X-API-Key': TEST_API_KEY },
        body: { name: TEST_CREDENTIALS.name, email: TEST_CREDENTIALS.email },
      }).then((res) => {
        expect(res.status).to.eq(200);
      });
      // The api_key still authenticates, and the password still signs in.
      cy.request({ url: `${SETTING_URL}/${id}`, headers: { 'X-API-Key': TEST_API_KEY } })
        .its('status').should('eq', 200);
      mobileLogin(TEST_CREDENTIALS.password).its('status').should('eq', 200);
    });
  });

  it('keeps the password and api_key when the body sends them empty', () => {
    ownUserId().then((id) => {
      cy.request({
        method: 'PUT',
        url: `${SETTING_URL}/${id}`,
        headers: { 'X-API-Key': TEST_API_KEY },
        body: { name: TEST_CREDENTIALS.name, email: TEST_CREDENTIALS.email, password: '', api_key: '' },
      }).its('status').should('eq', 200);
      cy.request({ url: `${SETTING_URL}/${id}`, headers: { 'X-API-Key': TEST_API_KEY } })
        .its('status').should('eq', 200);
      mobileLogin(TEST_CREDENTIALS.password).its('status').should('eq', 200);
    });
  });

  it('still writes an explicitly supplied password', () => {
    const newPassword = 'changed-password-456';
    ownUserId().then((id) => {
      cy.wrap(hashPassword(newPassword)).then((hash) => {
        cy.request({
          method: 'PUT',
          url: `${SETTING_URL}/${id}`,
          headers: { 'X-API-Key': TEST_API_KEY },
          body: { name: TEST_CREDENTIALS.name, email: TEST_CREDENTIALS.email, password: hash },
        }).its('status').should('eq', 200);
      });
      mobileLogin(newPassword).its('status').should('eq', 200);
      mobileLogin(TEST_CREDENTIALS.password).its('status').should('eq', 401);
    });
  });
});
