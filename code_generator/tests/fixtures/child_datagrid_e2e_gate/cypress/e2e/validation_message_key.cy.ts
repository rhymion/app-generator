import { TEST_API_KEY, TEST_CREDENTIALS } from '../../support/test-credentials';

const headers = { 'X-API-Key': TEST_API_KEY };

// parent_only has a hand-written rule (custom_validation/parent_only.ts) that rejects three
// names. One carries a message key present in ValidationMessages, one a key that is not in
// the messages, one no key at all. The standalone edit form shows the translated text for
// the first and the generic text for the others; the REST 422 body carries the key only
// when the error had one.
function seed(): Cypress.Chainable<string> {
  cy.task('db:reset');
  cy.task('db:seed');
  cy.task('db:grantAllPermissions');
  Cypress.session.clearAllSavedSessions();
  cy.clearCookies();
  cy.visit('/en/');
  cy.login(TEST_CREDENTIALS.email, TEST_CREDENTIALS.password);
  return cy
    .request({ method: 'POST', url: '/api/parent_only', headers, body: { name: 'Key Target', parent_only_probes: [] } })
    .then((r) => r.body.id as string);
}

function submitName(id: string, name: string) {
  cy.visit(`/en/parent_only/edit/${id}`);
  cy.fillField('Name', name);
  cy.clickButton('Save');
  cy.url().should('include', `/parent_only/edit/${id}`);
}

describe('hand-written validation with a message key', () => {
  let id: string;
  beforeEach(() => {
    seed().then((v) => (id = v));
  });

  it('edit form: a key present in ValidationMessages shows the translated text with its args', () => {
    submitName(id, 'reject-with-key');
    cy.contains('This name is reserved for fixtures (limit 3).').should('be.visible');
    cy.contains('has an invalid or disallowed value').should('not.exist');
    cy.contains('ValidationMessages').should('not.exist');
  });

  it('edit form: a key that is not in the messages shows the generic text, never the key', () => {
    submitName(id, 'reject-unknown-key');
    cy.contains('name has an invalid or disallowed value.').should('be.visible');
    cy.contains('noSuchKey').should('not.exist');
    cy.contains('ValidationMessages').should('not.exist');
  });

  it('edit form: a rejection without a key shows the generic text', () => {
    submitName(id, 'reject-no-key');
    cy.contains('name has an invalid or disallowed value.').should('be.visible');
  });

  it('REST: the 422 body carries messageKey and messageArgs only when the error had a key', () => {
    cy.request({ method: 'PUT', url: `/api/parent_only/${id}`, headers, failOnStatusCode: false, body: { name: 'reject-with-key', parent_only_probes: [] } }).then((res) => {
      expect(res.status).to.eq(422);
      expect(res.body.code).to.eq('VALIDATION');
      expect(res.body.field).to.eq('name');
      expect(res.body.messageKey).to.eq('ValidationMessages.fixtureNameReserved');
      expect(res.body.messageArgs).to.deep.eq({ max: 3 });
    });
    cy.request({ method: 'PUT', url: `/api/parent_only/${id}`, headers, failOnStatusCode: false, body: { name: 'reject-no-key', parent_only_probes: [] } }).then((res) => {
      expect(res.status).to.eq(422);
      expect(res.body).to.not.have.property('messageKey');
      expect(res.body).to.not.have.property('messageArgs');
    });
  });
});
