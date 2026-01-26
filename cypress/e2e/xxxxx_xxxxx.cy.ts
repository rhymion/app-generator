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

  it('Edit existing xxxxx xxxxx', () => {
    // Populate data using Cypress tasks (runs in Node.js context)
    cy.task<any[]>('db:populateXxxxxXxxxx', 1).then((records) => {
      const xxxxxXxxxx = records[0];
      cy.task('db:populateYyyyyYyyyy', { xxxxxXxxxxId: xxxxxXxxxx.id, length: 1 });
    });
    
    cy.visit('/xxxxx_xxxxx');
    cy.contains('Xxxxx Xxxxx 1').click();
    cy.contains('Edit').click();
    cy.url().should('include', '/xxxxx_xxxxx/edit');

    // Update form fields
    cy.fillField('Description', 'Updated description for test xxxxx xxxxx.');
    
    // Update child row
    fillDataGridRow(0, {
      name: 'field1_updated',
      type: 'number',
      max: 100,
      required: false,
    });

    // Save and verify
    cy.clickButton('Save');
    cy.url().should('include', '/xxxxx_xxxxx');
    cy.contains('Xxxxx Xxxxx 1').should('be.visible');
    cy.contains('Updated description for test xxxxx xxxxx.').should('be.visible');
  });

  it('Delete existing xxxxx xxxxx', () => {
    cy.task<any[]>('db:populateXxxxxXxxxx', 1).then((records) => {
      const xxxxxXxxxx = records[0];
      cy.task('db:populateYyyyyYyyyy', { xxxxxXxxxxId: xxxxxXxxxx.id, length: 1 });
    });
    cy.visit('/xxxxx_xxxxx');
    cy.contains('Xxxxx Xxxxx 1').click();
    cy.contains('Edit').click();
    cy.url().should('include', '/xxxxx_xxxxx/edit');

    // Delete and verify
    cy.clickButton('Delete Xxxxx Xxxxx');
    cy.get('div[role="dialog"]').find('button').contains('Delete').click();
    cy.url().should('include', '/xxxxx_xxxxx');
    cy.contains('Xxxxx Xxxxx 1').should('not.exist');
  });
});
