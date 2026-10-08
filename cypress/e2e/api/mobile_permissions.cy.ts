// Hand-written -- not part of the generated entity test set.
import { TEST_API_KEY, TEST_CREDENTIALS } from '../../support/test-credentials';

const URL = '/api/mobile/permissions';

type TokenPair = { access_token: string };

describe('API: Mobile model permissions', () => {
  beforeEach(() => {
    cy.task('db:reset');
    cy.task('db:seed');
    cy.task('db:grantAllPermissions');
  });

  it('rejects a request without credentials', () => {
    cy.request({ url: `${URL}?entity=role`, failOnStatusCode: false }).its('status').should('eq', 401);
  });

  it('rejects a missing or malformed entity name', () => {
    for (const query of ['', '?entity=', '?entity=Role', '?entity=role;drop']) {
      cy.request({ url: `${URL}${query}`, headers: { 'X-API-Key': TEST_API_KEY }, failOnStatusCode: false })
        .its('status')
        .should('eq', 400);
    }
  });

  it('answers every flag as true for a user with every permission, through a mobile token', () => {
    cy.request('POST', '/api/mobile/auth/token', {
      email: TEST_CREDENTIALS.email,
      password: TEST_CREDENTIALS.password,
    }).then((login) => {
      const { access_token } = login.body as TokenPair;
      cy.request({ url: `${URL}?entity=role`, headers: { Authorization: `Bearer ${access_token}` } }).then((res) => {
        expect(res.status).to.eq(200);
        expect(res.body).to.deep.equal({ create: true, read: true, update: true, delete: true, import: true });
      });
    });
  });

  it('reports exactly the flags granted to the caller', () => {
    cy.task<string>('db:createApiUserWithPermission', {
      entityName: 'role',
      flags: { read: true },
      label: 'mobileperms',
    }).then((apiKey) => {
      cy.request({ url: `${URL}?entity=role`, headers: { 'X-API-Key': apiKey } }).then((res) => {
        expect(res.status).to.eq(200);
        expect(res.body).to.deep.equal({ create: false, read: true, update: false, delete: false, import: false });
      });
    });
  });

  it('answers all flags false for an entity the caller holds no permission on', () => {
    cy.task<string>('db:createApiUserWithPermission', {
      entityName: 'role',
      flags: { read: true },
      label: 'mobileperms2',
    }).then((apiKey) => {
      cy.request({ url: `${URL}?entity=permission`, headers: { 'X-API-Key': apiKey } }).then((res) => {
        expect(res.status).to.eq(200);
        expect(res.body).to.deep.equal({ create: false, read: false, update: false, delete: false, import: false });
      });
    });
  });
});
