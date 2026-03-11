// AUTO-GENERATED - DO NOT EDIT
import { TEST_CREDENTIALS } from '../support/test-credentials';
import { assertDataGridEmpty, getDataGridRowCount } from '../support/datagrid-helpers';

describe('Testing Inventory pages and their behavior', () => {
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
      cy.visit('/en/inventory');
      assertDataGridEmpty();
    });

    it('1.2 shows list with one item', () => {
      cy.task('db:populateInventory', 1);
      cy.visit('/en/inventory');
      cy.contains('Inventory 1').should('be.visible');
      getDataGridRowCount().should('eq', 1);
    });

    it('1.3 shows list with multiple items', () => {
      cy.task('db:populateInventory', 3);
      cy.visit('/en/inventory');
      cy.contains('Inventory 1').should('be.visible');
      getDataGridRowCount().should('eq', 3);
    });
  });

  describe('Create', () => {
    it('2.1 creates with minimal data (required fields only)', () => {
      cy.task<any>('db:populateInventoryDependencies').then((deps) => {
        cy.visit('/en/inventory');
        cy.clickButton('Create New Inventory');
        cy.selectAutocomplete('Product', deps.product.name);
        cy.fillField('Quantity', '100');
        cy.fillField('Reserved Quantity', '100');
        cy.clickButton('Save');
        cy.url().should('include', '/inventory');
        cy.contains('Test Inventory').should('be.visible');
        // Verify on view page
        cy.contains('Test Inventory').click();
        cy.url().should('include', '/inventory/view');
        cy.checkField('Product', 'Test Product');
        cy.checkField('Quantity', '100');
        cy.checkField('Reserved Quantity', '100');
      });
    });

    it('2.2 creates with full data (all fields and children)', () => {
      cy.task<any>('db:populateInventoryDependencies').then((deps) => {
        cy.visit('/en/inventory');
        cy.clickButton('Create New Inventory');
        cy.selectAutocomplete('Product', deps.product.name);
        cy.fillField('Quantity', '100');
        cy.fillField('Reserved Quantity', '100');
        cy.fillField('Location', 'Test Location');
        cy.fillField('Lot Number', 'Test Lot Number');
        cy.fillDateTime('Expiration Date', '01/15/2025');
        cy.clickButton('Save');
        cy.url().should('include', '/inventory');
        cy.contains('Test Inventory').should('be.visible');
        // Verify on view page
        cy.contains('Test Inventory').click();
        cy.url().should('include', '/inventory/view');
        cy.checkField('Product', 'Test Product');
        cy.checkField('Quantity', '100');
        cy.checkField('Reserved Quantity', '100');
        cy.checkField('Location', 'Test Location');
        cy.checkField('Lot Number', 'Test Lot Number');
        cy.checkField('Expiration Date', '01/15/2025');
      });
    });
  });

  describe('Edit', () => {
    it('3.1 adds optional data and child items', () => {
      cy.task<any[]>('db:populateInventory', 1).then((records) => {
        cy.visit('/en/inventory');
        cy.contains('Inventory 1').click();
        cy.get('[aria-label="Edit"]').click();
        cy.url().should('include', '/inventory/edit');
        cy.fillField('Location', 'Test Location');
        cy.fillField('Lot Number', 'Test Lot Number');
        cy.fillDateTime('Expiration Date', '01/15/2025');
        cy.clickButton('Save');
        cy.url().should('include', '/inventory');
        cy.contains('Inventory 1').should('be.visible');
        // Verify on view page
        cy.contains('Inventory 1').click();
        cy.url().should('include', '/inventory/view');
        cy.checkField('Name', 'Inventory 1');
      });
    });

    it('3.2 removes optional data and child items', () => {
      cy.task<any[]>('db:populateInventoryFull', 1).then((records) => {
        cy.visit('/en/inventory');
        cy.contains('Inventory 1').click();
        cy.get('[aria-label="Edit"]').click();
        cy.url().should('include', '/inventory/edit');
        cy.clearField('Location');
        cy.clearField('Lot Number');
        cy.clearDateTime('Expiration Date');
        cy.clickButton('Save');
        cy.url().should('include', '/inventory');
        cy.contains('Inventory 1').should('be.visible');
      });
    });

    it('3.3 edits with mixed changes', () => {
      cy.task<any[]>('db:populateInventory', 1).then((records) => {
        cy.visit('/en/inventory');
        cy.contains('Inventory 1').click();
        cy.get('[aria-label="Edit"]').click();
        cy.clearAndFillField('Name', 'Updated Inventory');
        cy.fillField('Location', 'Updated Location');
        cy.clickButton('Save');
        cy.url().should('include', '/inventory');
        cy.contains('Updated Inventory').should('be.visible');
        // Verify on view page
        cy.contains('Updated Inventory').click();
        cy.url().should('include', '/inventory/view');
        cy.checkField('Name', 'Updated Inventory');
      });
    });
  });

  describe('Delete', () => {
    it('4.1 deletes a single item from list view', () => {
      cy.task('db:populateInventory', 2);
      cy.visit('/en/inventory');
      cy.selectDataGridRows([0]);
      cy.get('div').find('button[aria-label="Delete Selected"]').click();
      cy.get('div[role="dialog"]').find('button').contains('Delete').click();
      getDataGridRowCount().should('eq', 1);
    });

    it('4.2 deletes multiple items from list view', () => {
      cy.task('db:populateInventory', 3);
      cy.visit('/en/inventory');
      cy.selectDataGridRows([0, 1]);
      cy.get('div').find('button[aria-label="Delete Selected"]').click();
      cy.get('div[role="dialog"]').find('button').contains('Delete').click();
      getDataGridRowCount().should('eq', 1);
    });

    it('4.3 deletes an item from edit page', () => {
      cy.task('db:populateInventory', 1);
      cy.visit('/en/inventory');
      cy.contains('Inventory 1').click();
      cy.get('[aria-label="Edit"]').click();
      cy.url().should('include', '/inventory/edit');
      cy.clickButton('Delete Inventory');
      cy.get('div[role="dialog"]').find('button').contains('Delete').click();
      cy.url().should('include', '/inventory');
      cy.contains('Inventory 1').should('not.exist');
    });
  });

  describe('Fail create', () => {
    it('5.1 fails when required parent field is missing', () => {
      cy.task<any>('db:populateInventoryDependencies').then((deps) => {
        cy.visit('/en/inventory/new');
        cy.selectAutocomplete('Product', deps.product.name);
        cy.fillField('Reserved Quantity', '100');
        cy.clickButton('Save');
        cy.url().should('include', '/inventory/new');
      });
    });

  });

  describe('Fail edit', () => {
    it('6.1 fails when required parent field is cleared', () => {
      cy.task('db:populateInventory', 1);
      cy.visit('/en/inventory');
      cy.contains('Inventory 1').click();
      cy.get('[aria-label="Edit"]').click();
      cy.clearField('Quantity');
      cy.clickButton('Save');
      cy.url().should('include', '/inventory/edit');
    });

  });
});
