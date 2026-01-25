import { dividerClasses } from '@mui/material/Divider';
import { TEST_CREDENTIALS } from '../support/test-credentials';

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
    cy.contains('No rows').should('be.visible');
  });

  it('Create new xxxxx xxxxx', () => {
    cy.visit('/xxxxx_xxxxx');
    cy.contains('Create New Xxxxx Xxxxx').click();

    // Fill in form fields
    cy.contains('label', 'Name').parent().find('input').type('Test Xxxxx');
    cy.contains('label', 'Description').parent().find('textarea[rows="4"]').type('This is a test xxxxx xxxxx.');
    cy.contains('label', 'Team').parent().find('input').type('Test Team');
    cy.contains('button', 'Add Yyyyy Yyyyy').click();
    cy.get('div[role="row"]').find('div[data-field="name"]').dblclick();
    cy.get('div[role="row"]').find('div[data-field="name"]').find('input').type('field1');
    cy.get('div[role="row"]').find('div[data-field="type"]').dblclick();
    cy.get('div[role="row"]').find('div[data-field="type"]').find('input').type('string');
    cy.get('div[role="row"]').find('div[data-field="max_length"]').dblclick();
    cy.get('div[role="row"]').find('div[data-field="max_length"]').find('input').type('255');
    cy.get('div[role="row"]').find('div[data-field="required"]').dblclick();
    cy.get('div[role="row"]').find('div[data-field="required"]').find('input').check();
    cy.get('div[role="row"]').find('div[data-field="required"]').find('input').type('{enter}');

    cy.contains('button', 'Save').click();
    cy.url().should('include', '/xxxxx_xxxxx');
    cy.contains('Test Xxxxx').should('be.visible');
  })
});
