import { TEST_CREDENTIALS, TEST_API_KEY } from '../../support/test-credentials';

const headers = { 'X-API-Key': TEST_API_KEY };

// lc_plain_child: no pages of its own, one-to-many, required link, plain label,
// embedded in lc_plain_parent as an `x-outputType: list` child. The child has no
// page of its own, so there is nothing to navigate to: the parent's view and
// edit screens are the only places it shows up.
describe('list child without its own pages', () => {
  beforeEach(() => {
    cy.task('db:reset');
    cy.task('db:seed');
    cy.task('db:grantAllPermissions');
    Cypress.session.clearAllSavedSessions();
    cy.clearCookies();
    cy.visit('/en/');
    cy.login(TEST_CREDENTIALS.email, TEST_CREDENTIALS.password);
  });

  it('shows the children on the parent view and edit screens', () => {
    cy.request({
      method: 'POST', url: '/api/lc_plain_parent', headers,
      body: { name: 'Plain Parent', kids: [{ name: 'Plain Kid A' }, { name: 'Plain Kid B' }] },
    }).its('body.id').then((id) => {
      // Reach the view screen the way a user does: from the parent's list page.
      cy.visit('/en/lc_plain_parent');
      cy.contains('Plain Parent').click();
      cy.url().should('include', `/lc_plain_parent/view/${id}`);
      cy.contains('Plain Kid A').should('be.visible');
      cy.contains('Plain Kid B').should('be.visible');

      cy.visit(`/en/lc_plain_parent/edit/${id}`);
      cy.contains('Plain Kid A').should('be.visible');
      cy.contains('Plain Kid B').should('be.visible');
    });
  });
});
