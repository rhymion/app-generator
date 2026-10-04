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
      cy.contains('.MuiDataGrid-cell', 'Plain Parent').find('a').first().click();
      cy.url().should('include', `/lc_plain_parent/view/${id}`);
      cy.contains('Plain Kid A').should('be.visible');
      cy.contains('Plain Kid B').should('be.visible');

      cy.visit(`/en/lc_plain_parent/edit/${id}`);
      cy.contains('Plain Kid A').should('be.visible');
      cy.contains('Plain Kid B').should('be.visible');
    });
  });

  it('creates a child record by typing its text on the parent screen', () => {
    cy.visit('/en/lc_plain_parent/new');
    cy.clearAndFillField('Name', 'Typed Parent');
    cy.clickButton('Add Kids');
    cy.get('div[role="dialog"]').find('input').type('Typed Kid');
    cy.get('div[role="dialog"]').find('button').contains('Add').click();
    cy.clickButton('Save');
    cy.url().should('not.include', '/lc_plain_parent/new');
    // The record was created with the child; the parent's view screen shows it.
    cy.visit('/en/lc_plain_parent');
    cy.contains('.MuiDataGrid-cell', 'Typed Parent').find('a').first().click();
    cy.url().should('include', '/lc_plain_parent/view/');
    cy.contains('Typed Kid').should('be.visible');
  });
});
