// AUTO-GENERATED - DO NOT EDIT
import { TEST_CREDENTIALS } from '../support/test-credentials';
import { fillDataGridRow, assertDataGridEmpty, getDataGridRowCount, assertDataGridRowData } from '../support/datagrid-helpers';

describe('Testing Purchase Order pages and their behavior', () => {
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
      cy.visit('/en/purchase_order');
      assertDataGridEmpty();
    });

    it('1.2 shows list with one item', () => {
      cy.task('db:populatePurchaseOrder', 1);
      cy.visit('/en/purchase_order');
      cy.contains('Purchase Order 1').should('be.visible');
      getDataGridRowCount().should('eq', 1);
    });

    it('1.3 shows list with multiple items', () => {
      cy.task('db:populatePurchaseOrder', 3);
      cy.visit('/en/purchase_order');
      cy.contains('Purchase Order 1').should('be.visible');
      getDataGridRowCount().should('eq', 3);
    });
  });

  describe('Create', () => {
    it('2.1 creates with minimal data (required fields only)', () => {
      cy.visit('/en/purchase_order');
      cy.clickButton('Create New Purchase Order');
      cy.fillField('Order No', 'Test Order No');
      // Add required child: Items
      cy.clickButton('Add Items');
      fillDataGridRow(0, { product_id: '', quantity: 100 });
      cy.clickButton('Save');
      cy.url().should('include', '/purchase_order');
      cy.contains('Test Purchase Order').should('be.visible');
      // Verify on view page
      cy.contains('Test Purchase Order').click();
      cy.url().should('include', '/purchase_order/view');
      cy.checkField('Order No', 'Test Order No');
    });

    it('2.2 creates with full data (all fields and children)', () => {
      cy.visit('/en/purchase_order');
      cy.clickButton('Create New Purchase Order');
      cy.fillField('Order No', 'Test Order No');
      // Add child: Items
      cy.clickButton('Add Items');
      fillDataGridRow(0, { product_id: '', quantity: 100, price: 100 });
      cy.clickButton('Save');
      cy.url().should('include', '/purchase_order');
      cy.contains('Test Purchase Order').should('be.visible');
      // Verify on view page
      cy.contains('Test Purchase Order').click();
      cy.url().should('include', '/purchase_order/view');
      cy.checkField('Order No', 'Test Order No');
    });
  });

  describe('Edit', () => {
    it('3.1 adds optional data and child items', () => {
      cy.task<any[]>('db:populatePurchaseOrder', 1).then((records) => {
        cy.visit('/en/purchase_order');
        cy.contains('Purchase Order 1').click();
        cy.get('[aria-label="Edit"]').click();
        cy.url().should('include', '/purchase_order/edit');
        // Add child: Items
        cy.clickButton('Add Items');
        fillDataGridRow(0, { product_id: '', quantity: 100 });
        cy.clickButton('Save');
        cy.url().should('include', '/purchase_order');
        cy.contains('Purchase Order 1').should('be.visible');
        // Verify on view page
        cy.contains('Purchase Order 1').click();
        cy.url().should('include', '/purchase_order/view');
        cy.checkField('Name', 'Purchase Order 1');
      });
    });

    it('3.2 removes optional data and child items', () => {
      cy.task<any[]>('db:populatePurchaseOrder', 1).then((records) => {
        cy.task('db:populatePurchaseOrderPurchasePerItem', { parentId: records[0].id, length: 1 });
        cy.visit('/en/purchase_order');
        cy.contains('Purchase Order 1').click();
        cy.get('[aria-label="Edit"]').click();
        cy.url().should('include', '/purchase_order/edit');
        // Delete child: Items
        cy.selectDataGridRows([0]);
        cy.contains('h2', 'Items').parent().find('button[aria-label="Delete Selected"]').click();
        cy.get('div[role="dialog"]').find('button').contains('Delete').click();
        cy.clickButton('Save');
        cy.url().should('include', '/purchase_order');
        cy.contains('Purchase Order 1').should('be.visible');
      });
    });

    it('3.3 edits with mixed changes', () => {
      cy.task<any[]>('db:populatePurchaseOrder', 1).then((records) => {
        cy.visit('/en/purchase_order');
        cy.contains('Purchase Order 1').click();
        cy.get('[aria-label="Edit"]').click();
        cy.clearAndFillField('Name', 'Updated Purchase Order');
        cy.clickButton('Save');
        cy.url().should('include', '/purchase_order');
        cy.contains('Updated Purchase Order').should('be.visible');
        // Verify on view page
        cy.contains('Updated Purchase Order').click();
        cy.url().should('include', '/purchase_order/view');
        cy.checkField('Name', 'Updated Purchase Order');
      });
    });
  });

  describe('Delete', () => {
    it('4.1 deletes a single item from list view', () => {
      cy.task('db:populatePurchaseOrder', 2);
      cy.visit('/en/purchase_order');
      cy.selectDataGridRows([0]);
      cy.get('div').find('button[aria-label="Delete Selected"]').click();
      cy.get('div[role="dialog"]').find('button').contains('Delete').click();
      getDataGridRowCount().should('eq', 1);
    });

    it('4.2 deletes multiple items from list view', () => {
      cy.task('db:populatePurchaseOrder', 3);
      cy.visit('/en/purchase_order');
      cy.selectDataGridRows([0, 1]);
      cy.get('div').find('button[aria-label="Delete Selected"]').click();
      cy.get('div[role="dialog"]').find('button').contains('Delete').click();
      getDataGridRowCount().should('eq', 1);
    });

    it('4.3 deletes an item from edit page', () => {
      cy.task('db:populatePurchaseOrder', 1);
      cy.visit('/en/purchase_order');
      cy.contains('Purchase Order 1').click();
      cy.get('[aria-label="Edit"]').click();
      cy.url().should('include', '/purchase_order/edit');
      cy.clickButton('Delete Purchase Order');
      cy.get('div[role="dialog"]').find('button').contains('Delete').click();
      cy.url().should('include', '/purchase_order');
      cy.contains('Purchase Order 1').should('not.exist');
    });
  });

  describe('Fail create', () => {
    it('5.1 fails when required parent field is missing', () => {
      cy.visit('/en/purchase_order/new');
      cy.clickButton('Save');
      cy.url().should('include', '/purchase_order/new');
    });

    it('5.2 fails when required child field is missing', () => {
      cy.visit('/en/purchase_order/new');
      cy.fillField('Order No', 'Test Order No');
      cy.clickButton('Add Items');
      fillDataGridRow(0, { product_id: '' });
      cy.clickButton('Save');
      cy.url().should('include', '/purchase_order/new');
    });
  });

  describe('Fail edit', () => {
    it('6.1 fails when required parent field is cleared', () => {
      cy.task('db:populatePurchaseOrder', 1);
      cy.visit('/en/purchase_order');
      cy.contains('Purchase Order 1').click();
      cy.get('[aria-label="Edit"]').click();
      cy.clearField('Order No');
      cy.clickButton('Save');
      cy.url().should('include', '/purchase_order/edit');
    });

    it('6.2 fails when required child field is cleared', () => {
      cy.task<any[]>('db:populatePurchaseOrder', 1).then((records) => {
        cy.task('db:populatePurchaseOrderPurchasePerItem', { parentId: records[0].id, length: 1 });
        cy.visit('/en/purchase_order');
        cy.contains('Purchase Order 1').click();
        cy.get('[aria-label="Edit"]').click();
        // Clear required child field
        cy.get('div[role="row"][data-rowindex="0"]').find('div[data-field="product_id"]').dblclick();
        cy.get('div[role="row"][data-rowindex="0"]').find('div[data-field="product_id"] input').clear().type('{enter}');
        cy.clickButton('Save');
        cy.url().should('include', '/purchase_order/edit');
      });
    });
  });
});
