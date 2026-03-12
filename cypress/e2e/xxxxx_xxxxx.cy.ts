// AUTO-GENERATED - DO NOT EDIT
import { TEST_CREDENTIALS } from '../support/test-credentials';
import { fillDataGridRow, assertDataGridEmpty, getDataGridRowCount, assertDataGridRowData } from '../support/datagrid-helpers';

describe('Testing Xxxxx Xxxxx pages and their behavior', () => {
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
      cy.visit('/en/xxxxx_xxxxx');
      assertDataGridEmpty();
    });

    it('1.2 shows list with one item', () => {
      cy.task('db:populateXxxxxXxxxx', 1);
      cy.visit('/en/xxxxx_xxxxx');
      cy.contains('Xxxxx Xxxxx 1').should('be.visible');
      getDataGridRowCount().should('eq', 1);
    });

    it('1.3 shows list with multiple items', () => {
      cy.task('db:populateXxxxxXxxxx', 3);
      cy.visit('/en/xxxxx_xxxxx');
      cy.contains('Xxxxx Xxxxx 1').should('be.visible');
      getDataGridRowCount().should('eq', 3);
    });
  });

  describe('Create', () => {
    it('2.1 creates with minimal data (required fields only)', () => {
      cy.visit('/en/xxxxx_xxxxx');
      cy.clickButton('Create New Xxxxx Xxxxx');
      cy.fillField('Name', 'Test Xxxxx Xxxxx');
      // Add required child: Yyyyy Yyyyys
      cy.clickButton('Add Yyyyy Yyyyys');
      fillDataGridRow(0, { name: 'Test Yyyyy Yyyyys', type: 'string', required: true, written_by: 'Test Written By' });
      cy.clickButton('Save');
      cy.url().should('include', '/xxxxx_xxxxx');
      cy.contains('Test Xxxxx Xxxxx').should('be.visible');
      // Verify on view page
      cy.contains('Test Xxxxx Xxxxx').click();
      cy.url().should('include', '/xxxxx_xxxxx/view');
      cy.checkField('Name', 'Test Xxxxx Xxxxx');
    });

    it('2.2 creates with full data (all fields and children)', () => {
      cy.visit('/en/xxxxx_xxxxx');
      cy.clickButton('Create New Xxxxx Xxxxx');
      cy.fillField('Name', 'Test Xxxxx Xxxxx');
      cy.fillField('Description', 'Test Description');
      cy.fillField('Team', 'Test Team');
      // Add child: Yyyyy Yyyyys
      cy.clickButton('Add Yyyyy Yyyyys');
      fillDataGridRow(0, { name: 'Test Yyyyy Yyyyys', type: 'string', max_length: 100, max: 100, regex: 'Test Regex', required: true, written_by: 'Test Written By' });
      cy.clickButton('Save');
      cy.url().should('include', '/xxxxx_xxxxx');
      cy.contains('Test Xxxxx Xxxxx').should('be.visible');
      // Verify on view page
      cy.contains('Test Xxxxx Xxxxx').click();
      cy.url().should('include', '/xxxxx_xxxxx/view');
      cy.checkField('Name', 'Test Xxxxx Xxxxx');
      cy.checkField('Description', 'Test Description');
      cy.checkField('Team', 'Test Team');
    });
  });

  describe('Edit', () => {
    it('3.1 adds optional data and child items', () => {
      cy.task<any[]>('db:populateXxxxxXxxxx', 1).then((records) => {
        cy.visit('/en/xxxxx_xxxxx');
        cy.contains('Xxxxx Xxxxx 1').click();
        cy.get('[aria-label="Edit"]').click();
        cy.url().should('include', '/xxxxx_xxxxx/edit');
        cy.fillField('Description', 'Test Description');
        cy.fillField('Team', 'Test Team');
        // Add child: Yyyyy Yyyyys
        cy.clickButton('Add Yyyyy Yyyyys');
        fillDataGridRow(0, { name: 'Test Yyyyy Yyyyys', type: 'string', required: true, written_by: 'Test Written By' });
        cy.clickButton('Save');
        cy.url().should('include', '/xxxxx_xxxxx');
        cy.contains('Xxxxx Xxxxx 1').should('be.visible');
        // Verify on view page
        cy.contains('Xxxxx Xxxxx 1').click();
        cy.url().should('include', '/xxxxx_xxxxx/view');
        cy.checkField('Name', 'Xxxxx Xxxxx 1');
      });
    });

    it('3.2 removes optional data and child items', () => {
      cy.task<any[]>('db:populateXxxxxXxxxxFull', 1).then((records) => {
        cy.task('db:populateXxxxxXxxxxYyyyyYyyyy', { parentId: records[0].id, length: 1 });
        cy.visit('/en/xxxxx_xxxxx');
        cy.contains('Xxxxx Xxxxx 1').click();
        cy.get('[aria-label="Edit"]').click();
        cy.url().should('include', '/xxxxx_xxxxx/edit');
        cy.clearField('Description');
        cy.clearField('Team');
        // Delete child: Yyyyy Yyyyys
        cy.selectDataGridRows([0]);
        cy.contains('h2', 'Yyyyy Yyyyys').parent().find('button[aria-label="Delete Selected"]').click();
        cy.get('div[role="dialog"]').find('button').contains('Delete').click();
        cy.clickButton('Save');
        cy.url().should('include', '/xxxxx_xxxxx');
        cy.contains('Xxxxx Xxxxx 1').should('be.visible');
      });
    });

    it('3.3 edits with mixed changes', () => {
      cy.task<any[]>('db:populateXxxxxXxxxx', 1).then((records) => {
        cy.visit('/en/xxxxx_xxxxx');
        cy.contains('Xxxxx Xxxxx 1').click();
        cy.get('[aria-label="Edit"]').click();
        cy.clearAndFillField('Name', 'Updated Xxxxx Xxxxx');
        cy.fillField('Description', 'Updated Description');
        cy.clickButton('Save');
        cy.url().should('include', '/xxxxx_xxxxx');
        cy.contains('Updated Xxxxx Xxxxx').should('be.visible');
        // Verify on view page
        cy.contains('Updated Xxxxx Xxxxx').click();
        cy.url().should('include', '/xxxxx_xxxxx/view');
        cy.checkField('Name', 'Updated Xxxxx Xxxxx');
      });
    });
  });

  describe('Delete', () => {
    it('4.1 deletes a single item from list view', () => {
      cy.task('db:populateXxxxxXxxxx', 2);
      cy.visit('/en/xxxxx_xxxxx');
      cy.selectDataGridRows([0]);
      cy.get('div').find('button[aria-label="Delete Selected"]').click();
      cy.get('div[role="dialog"]').find('button').contains('Delete').click();
      getDataGridRowCount().should('eq', 1);
    });

    it('4.2 deletes multiple items from list view', () => {
      cy.task('db:populateXxxxxXxxxx', 3);
      cy.visit('/en/xxxxx_xxxxx');
      cy.selectDataGridRows([0, 1]);
      cy.get('div').find('button[aria-label="Delete Selected"]').click();
      cy.get('div[role="dialog"]').find('button').contains('Delete').click();
      getDataGridRowCount().should('eq', 1);
    });

    it('4.3 deletes an item from edit page', () => {
      cy.task('db:populateXxxxxXxxxx', 1);
      cy.visit('/en/xxxxx_xxxxx');
      cy.contains('Xxxxx Xxxxx 1').click();
      cy.get('[aria-label="Edit"]').click();
      cy.url().should('include', '/xxxxx_xxxxx/edit');
      cy.clickButton('Delete Xxxxx Xxxxx');
      cy.get('div[role="dialog"]').find('button').contains('Delete').click();
      cy.url().should('include', '/xxxxx_xxxxx');
      cy.contains('Xxxxx Xxxxx 1').should('not.exist');
    });
  });

  describe('Fail create', () => {
    it('5.1 fails when required parent field is missing', () => {
      cy.visit('/en/xxxxx_xxxxx/new');
      cy.clickButton('Save');
      cy.url().should('include', '/xxxxx_xxxxx/new');
    });

    it('5.2 fails when required child scalar field is missing', () => {
      cy.visit('/en/xxxxx_xxxxx/new');
      cy.fillField('Name', 'Test Xxxxx Xxxxx');
      cy.clickButton('Add Yyyyy Yyyyys');
      fillDataGridRow(0, { type: 'string', required: true, written_by: 'Test Written By' });
      cy.clickButton('Save');
      cy.url().should('include', '/xxxxx_xxxxx/new');
    });

  });

  describe('Fail edit', () => {
    it('6.1 fails when required parent field is cleared', () => {
      cy.task('db:populateXxxxxXxxxx', 1);
      cy.visit('/en/xxxxx_xxxxx');
      cy.contains('Xxxxx Xxxxx 1').click();
      cy.get('[aria-label="Edit"]').click();
      cy.clearField('Name');
      cy.clickButton('Save');
      cy.url().should('include', '/xxxxx_xxxxx/edit');
    });

    it('6.2 fails when required child field is cleared', () => {
      cy.task<any[]>('db:populateXxxxxXxxxx', 1).then((records) => {
        cy.task('db:populateXxxxxXxxxxYyyyyYyyyy', { parentId: records[0].id, length: 1 });
        cy.visit('/en/xxxxx_xxxxx');
        cy.contains('Xxxxx Xxxxx 1').click();
        cy.get('[aria-label="Edit"]').click();
        // Clear required child field
        cy.get('div[role="row"][data-rowindex="0"]').find('div[data-field="name"]').dblclick();
        cy.get('div[role="row"][data-rowindex="0"]').find('div[data-field="name"] input').clear().type('{enter}');
        cy.clickButton('Save');
        cy.url().should('include', '/xxxxx_xxxxx/edit');
      });
    });
  });
});
