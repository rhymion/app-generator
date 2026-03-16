// AUTO-GENERATED - DO NOT EDIT
import { TEST_CREDENTIALS } from '../support/test-credentials';
import { assertDataGridEmpty, getDataGridRowCount } from '../support/datagrid-helpers';

describe('Testing Product pages and their behavior', () => {
  beforeEach(() => {
    cy.task('db:reset');
    cy.task('db:seed');
    Cypress.session.clearAllSavedSessions();
    cy.clearCookies();
    cy.clearLocalStorage();
    cy.visit('/en/');
    cy.window().then((win) => { win.sessionStorage.clear(); });
    cy.login(TEST_CREDENTIALS.email, TEST_CREDENTIALS.password);
  });

  describe('Display list', () => {
    it('1.1 shows empty state with no items', () => {
      cy.visit('/en/product');
      assertDataGridEmpty();
    });

    it('1.2 shows list with one item', () => {
      cy.task('db:populateProduct', 1);
      cy.visit('/en/product');
      cy.contains('Test Code 1').should('be.visible');
      getDataGridRowCount().should('eq', 1);
    });

    it('1.3 shows list with multiple items', () => {
      cy.task('db:populateProduct', 3);
      cy.visit('/en/product');
      cy.contains('Test Code 1').should('be.visible');
      getDataGridRowCount().should('eq', 3);
    });
  });

  describe('Create', () => {
    it('2.1 creates with minimal data (required fields only)', () => {
      cy.visit('/en/product');
      cy.clickButton('Create New Product');
      cy.fillField('Code', 'Test Code');
      cy.fillField('Name', 'Test Product');
      cy.fillField('Price', '100');
      cy.clickButton('Save');
      cy.url().should('include', '/product');
      cy.contains('Test Code').should('be.visible');
      // Verify on view page
      cy.contains('Test Code').click();
      cy.url().should('include', '/product/view');
      cy.checkField('Code', 'Test Code');
      cy.checkField('Name', 'Test Product');
      cy.checkField('Price', '100');
    });

    it('2.2 creates with full data (all fields and children)', () => {
      cy.visit('/en/product');
      cy.clickButton('Create New Product');
      cy.fillField('Code', 'Test Code');
      cy.fillField('Name', 'Test Product');
      cy.fillField('Price', '100');
      cy.clickButton('Save');
      cy.url().should('include', '/product');
      cy.contains('Test Code').should('be.visible');
      // Verify on view page
      cy.contains('Test Code').click();
      cy.url().should('include', '/product/view');
      cy.checkField('Code', 'Test Code');
      cy.checkField('Name', 'Test Product');
      cy.checkField('Price', '100');
    });
  });

  describe('Edit', () => {
    it('3.3 edits with mixed changes', () => {
      cy.task<any[]>('db:populateProduct', 1).then((records) => {
        cy.visit('/en/product');
        cy.contains('Test Code 1').click();
        cy.get('[aria-label="Edit"]').click();
        cy.clearAndFillField('Code', 'Updated Code');
        cy.clickButton('Save');
        cy.url().should('include', '/product');
        cy.contains('Updated Code').should('be.visible');
        // Verify on view page
        cy.contains('Updated Code').click();
        cy.url().should('include', '/product/view');
        cy.checkField('Code', 'Updated Code');
      });
    });
  });

  describe('Delete', () => {
    it('4.1 deletes a single item from list view', () => {
      cy.task('db:populateProduct', 2);
      cy.visit('/en/product');
      cy.selectDataGridRows([0]);
      cy.get('div').find('button[aria-label="Delete Selected"]').click();
      cy.get('div[role="dialog"]').find('button').contains('Delete').click();
      cy.contains('Test Code 1').should('not.exist');
      getDataGridRowCount().should('eq', 1);
    });

    it('4.2 deletes multiple items from list view', () => {
      cy.task('db:populateProduct', 3);
      cy.visit('/en/product');
      cy.selectDataGridRows([0, 1]);
      cy.get('div').find('button[aria-label="Delete Selected"]').click();
      cy.get('div[role="dialog"]').find('button').contains('Delete').click();
      cy.contains('Test Code 1').should('not.exist');
      getDataGridRowCount().should('eq', 1);
    });

    it('4.3 deletes an item from edit page', () => {
      cy.task('db:populateProduct', 1);
      cy.visit('/en/product');
      cy.contains('Test Code 1').click();
      cy.get('[aria-label="Edit"]').click();
      cy.url().should('include', '/product/edit');
      cy.clickButton('Delete Product');
      cy.get('div[role="dialog"]').find('button').contains('Delete').click();
      cy.url().should('include', '/product');
      cy.contains('Test Code 1').should('not.exist');
    });
  });

  describe('Fail create', () => {
    it('5.1 fails when required parent field is missing', () => {
      cy.visit('/en/product/new');
      cy.fillField('Code', 'Test Code');
      cy.fillField('Price', '100');
      cy.clickButton('Save');
      cy.url().should('include', '/product/new');
    });

  });

  describe('Fail edit', () => {
    it('6.1 fails when required parent field is cleared', () => {
      cy.task('db:populateProduct', 1);
      cy.visit('/en/product');
      cy.contains('Test Code 1').click();
      cy.get('[aria-label="Edit"]').click();
      cy.clearField('Name');
      cy.clickButton('Save');
      cy.url().should('include', '/product/edit');
    });

  });
});
