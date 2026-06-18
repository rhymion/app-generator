// AUTO-GENERATED - DO NOT EDIT
import { TEST_CREDENTIALS } from '../support/test-credentials';
import { assertDataGridEmpty, getDataGridRowCount, getDataGridTotalRowCount } from '../support/datagrid-helpers';

describe('Testing Tip Tx pages and their behavior', () => {
  beforeEach(() => {
    cy.task('db:reset');
    cy.task('db:seed');
    cy.task('db:grantAllPermissions');
    Cypress.session.clearAllSavedSessions();
    cy.clearCookies();
    cy.clearLocalStorage();
    cy.visit('/en/');
    cy.window().then((win) => { win.sessionStorage.clear(); });
    cy.login(TEST_CREDENTIALS.email, TEST_CREDENTIALS.password);
  });

  describe('Display list', () => {
    it('1.1 shows empty state with no items', () => {
      cy.visit('/en/tip_tx');
      cy.visit('/en/tip_tx');
      assertDataGridEmpty();
    });

    it('1.2 shows list with one item', () => {
      cy.task('db:populateTipTx', 1);
      cy.visit('/en/tip_tx');
      cy.get('.MuiDataGrid-virtualScroller').scrollTo('bottom', { ensureScrollable: false });
      cy.contains('Pending').scrollIntoView().should('be.visible');
      getDataGridTotalRowCount().should('eq', 1);
    });

    it('1.3 shows list with multiple items', () => {
      cy.task('db:populateTipTx', 3);
      cy.visit('/en/tip_tx');
      cy.get('.MuiDataGrid-virtualScroller').scrollTo('bottom', { ensureScrollable: false });
      cy.contains('Pending').scrollIntoView().should('be.visible');
      // Use aria-rowcount for the total (getDataGridRowCount counts only virtualised DOM rows)
      getDataGridTotalRowCount().should('eq', 3);
    });
  });

  describe('Create', () => {
    it('2.1 creates with minimal data (required fields only)', () => {
      cy.task<any>('db:populateTipTxDependencies').then((deps) => {
        cy.visit('/en/tip_tx');
        cy.clickButton('Create New Tip Tx');
        cy.url().should('include', '/tip_tx/new');
        cy.fillField('Gross Amount', '100');
        cy.fillField('Operator Fee', '100');
        cy.fillField('Payment Fee', '100');
        cy.fillField('Contract Split Id', 'Test Contract Split Id');
        cy.selectAutocomplete('Status', 'Pending');
        cy.selectAutocomplete('Comment', deps.comment.name);
        cy.clickButton('Save');
        cy.url().should('include', '/tip_tx');
        cy.url().should('not.include', '/tip_tx/');
        cy.get('.MuiDataGrid-virtualScroller').scrollTo('bottom', { ensureScrollable: false });
        cy.contains('Pending').scrollIntoView().should('be.visible');
        // Verify on view page
        cy.get('.MuiDataGrid-virtualScroller').scrollTo('bottom', { ensureScrollable: false });
        cy.contains('.MuiDataGrid-row', 'Pending').find('a').first().click();
        cy.url().should('include', '/tip_tx/view');
        cy.checkField('Gross Amount', '100');
        cy.checkField('Operator Fee', '100');
        cy.checkField('Payment Fee', '100');
        cy.checkField('Contract Split Id', 'Test Contract Split Id');
        cy.checkField('Status', 'Pending');
        cy.checkField('Comment', 'Test Message');
      });
    });

    it('2.2 creates with full data (all fields and children)', () => {
      cy.task<any>('db:populateTipTxDependencies').then((deps) => {
        cy.visit('/en/tip_tx');
        cy.clickButton('Create New Tip Tx');
        cy.url().should('include', '/tip_tx/new');
        cy.fillField('Gross Amount', '100');
        cy.fillField('Operator Fee', '100');
        cy.fillField('Payment Fee', '100');
        cy.fillField('Contract Split Id', 'Test Contract Split Id');
        cy.selectAutocomplete('Status', 'Pending');
        cy.selectAutocomplete('Comment', deps.comment.name);
        cy.clickButton('Save');
        cy.url().should('include', '/tip_tx');
        cy.url().should('not.include', '/tip_tx/');
        cy.get('.MuiDataGrid-virtualScroller').scrollTo('bottom', { ensureScrollable: false });
        cy.contains('Pending').scrollIntoView().should('be.visible');
        // Verify on view page
        cy.get('.MuiDataGrid-virtualScroller').scrollTo('bottom', { ensureScrollable: false });
        cy.get('.MuiDataGrid-row').last().find('a').first().click();
        cy.url().should('include', '/tip_tx/view');
        cy.checkField('Gross Amount', '100');
        cy.checkField('Operator Fee', '100');
        cy.checkField('Payment Fee', '100');
        cy.checkField('Contract Split Id', 'Test Contract Split Id');
        cy.checkField('Status', 'Pending');
        cy.checkField('Comment', 'Test Message');
      });
    });
  });

  describe('Edit', () => {
    it('3.3 edits with mixed changes', () => {
      cy.task<any[]>('db:populateTipTx', 1).then((records) => {
        // Use record ID to navigate directly — list_id_1 may not be unique (e.g. entity_select
        // overlap with seed data from grantAllEntityPermissions), causing the wrong row to be
        // clicked and leading to a unique-constraint conflict on save.
        cy.visit(`/en/tip_tx/edit/${records[0].id}`);
        cy.clearAutocomplete('Status');
        cy.selectAutocomplete('Status', 'Held');
        cy.clickButton('Save');
        cy.url().should('include', '/tip_tx');
        cy.url().should('not.include', '/tip_tx/');
        // Verify on view page
        // Non-unique list_id: navigate by record ID to avoid virtual-scroll
        // range issues (the renamed value may be beyond the initial viewport).
        cy.visit(`/en/tip_tx/view/${records[0].id}`);
        cy.url().should('include', '/tip_tx/view');
        cy.checkField('Status', 'Held');
      });
    });
  });

  describe('Delete', () => {
    it('4.1 deletes a single item from list view', () => {
      cy.task('db:populateTipTx', 2);
      cy.visit('/en/tip_tx');
      cy.selectDataGridRows([0]);
      cy.get('div').find('button[aria-label="Delete Selected"]').first().click();
      cy.get('div[role="dialog"]').find('button').contains('Delete').first().click();
      getDataGridTotalRowCount().should('eq', 1);
    });

    it('4.2 deletes multiple items from list view', () => {
      cy.task('db:populateTipTx', 3);
      cy.visit('/en/tip_tx');
      cy.selectDataGridRows([0, 1]);
      cy.get('div').find('button[aria-label="Delete Selected"]').first().click();
      cy.get('div[role="dialog"]').find('button').contains('Delete').first().click();
      getDataGridTotalRowCount().should('eq', 1);
    });

    it('4.3 deletes an item from edit page', () => {
      cy.task('db:populateTipTx', 1);
      cy.visit('/en/tip_tx');
      cy.get('.MuiDataGrid-virtualScroller').scrollTo('bottom', { ensureScrollable: false });
      cy.contains('.MuiDataGrid-row', 'Pending').find('a').first().click();
      cy.get('a[aria-label="Edit"]').click();
      cy.url().should('include', '/tip_tx/edit');
      cy.clickButton('Delete Tip Tx');
      cy.get('div[role="dialog"]').find('button').contains('Delete').first().click();
      cy.url().should('not.include', '/edit');
      cy.url().should('include', '/tip_tx');
      cy.url().should('not.include', '/tip_tx/');
    });
  });

  describe('Fail create', () => {
    it('5.1 fails when required parent field is missing', () => {
      cy.task<any>('db:populateTipTxDependencies').then((deps) => {
        cy.visit('/en/tip_tx/new');
        // Wait for form to fully render before interacting (async autocomplete options can
        // cause a re-render that detaches checkbox elements mid-assertion).
        cy.get('button[aria-label="Save"]').should('be.visible');
        cy.fillField('Operator Fee', '100');
        cy.fillField('Payment Fee', '100');
        cy.fillField('Contract Split Id', 'Test Contract Split Id');
        cy.selectAutocomplete('Status', 'Pending');
        cy.selectAutocomplete('Comment', deps.comment.name);
        cy.clickButton('Save');
        cy.url().should('include', '/tip_tx/new');
      });
    });

  });

  describe('Fail edit', () => {
    it('6.1 fails when required parent field is cleared', () => {
      cy.task('db:populateTipTx', 1);
      cy.visit('/en/tip_tx');
      cy.get('.MuiDataGrid-virtualScroller').scrollTo('bottom', { ensureScrollable: false });
      cy.contains('.MuiDataGrid-row', 'Pending').find('a').first().click();
      cy.get('a[aria-label="Edit"]').click();
      cy.clearField('Gross Amount');
      cy.clickButton('Save');
      cy.url().should('include', '/tip_tx/edit');
    });

  });
});
