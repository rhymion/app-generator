// Hand-written -- not part of the generated entity test set.
import { TEST_API_KEY, TEST_CREDENTIALS } from '../../support/test-credentials';

const NAV_URL = '/api/mobile/nav';

type TokenPair = { access_token: string };

describe('API: Mobile navigation visibility', () => {
  beforeEach(() => {
    cy.task('db:reset');
    cy.task('db:seed');
    cy.task('db:grantAllPermissions');
  });

  it('rejects a request without credentials', () => {
    cy.request({ url: NAV_URL, failOnStatusCode: false }).its('status').should('eq', 401);
  });

  it('hides no readable entity link from a user with every permission', () => {
    cy.request('POST', '/api/mobile/auth/token', {
      email: TEST_CREDENTIALS.email,
      password: TEST_CREDENTIALS.password,
    }).then((login) => {
      const { access_token } = login.body as TokenPair;
      cy.request({ url: NAV_URL, headers: { Authorization: `Bearer ${access_token}` } }).then((res) => {
        expect(res.status).to.eq(200);
        expect(res.body.hiddenHrefs).to.not.include('/user');
        expect(res.body.hiddenHrefs).to.not.include('/role');
      });
    });
  });

  it('hides the links of entities the caller cannot read and keeps the ones it can', () => {
    cy.task<string>('db:createApiUserWithPermission', {
      entityName: 'role',
      flags: { read: true },
      label: 'mobilenav',
    }).then((apiKey) => {
      cy.request({ url: NAV_URL, headers: { 'X-API-Key': apiKey } }).then((res) => {
        expect(res.status).to.eq(200);
        expect(res.body.hiddenHrefs).to.not.include('/role');
        expect(res.body.hiddenHrefs).to.include('/user');
        expect(res.body.hiddenHrefs).to.include('/permission');
      });
    });
  });

  it('still answers an API-key caller, as every other REST route does', () => {
    cy.request({ url: NAV_URL, headers: { 'X-API-Key': TEST_API_KEY } }).its('status').should('eq', 200);
  });
});
