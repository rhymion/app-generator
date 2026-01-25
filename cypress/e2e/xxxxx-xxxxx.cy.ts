import { TEST_CREDENTIALS } from '../support/test-credentials';
import { fillDataGridRow, assertDataGridEmpty } from '../support/datagrid-helpers';

describe('Testing xxxxx xxxxx pages and their behavior', () => {
  beforeEach(() => {
    cy.task('db:reset');
    cy.task('db:seed');
    cy.login(TEST_CREDENTIALS.email, TEST_CREDENTIALS.password);
  });

  it('View xxxxx xxxxx list page', () => {
    cy.visit('/');
    cy.contains('Xxxxx Xxxxx').click();
    cy.url().should('include', '/xxxxx_xxxxx');
    assertDataGridEmpty();
  });

  it('Create new xxxxx xxxxx', () => {
    cy.visit('/xxxxx_xxxxx');
    cy.clickButton('Create New Xxxxx Xxxxx');

    // Fill in form fields
    cy.fillField('Name', 'Test Xxxxx');
    cy.fillField('Description', 'This is a test xxxxx xxxxx.');
    cy.fillField('Team', 'Test Team');
    
    // Add and fill child row
    cy.clickButton('Add Yyyyy Yyyyy');
    fillDataGridRow(0, {
      name: 'field1',
      type: 'string',
      max_length: 255,
      required: true,
    });

    // Save and verify
    cy.clickButton('Save');
    cy.url().should('include', '/xxxxx_xxxxx');
    cy.contains('Test Xxxxx').should('be.visible');
  });
});
