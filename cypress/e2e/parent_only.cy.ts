// AUTO-GENERATED - DO NOT EDIT
import { TEST_CREDENTIALS } from '../support/test-credentials';
import { assertDataGridEmpty, getDataGridRowCount } from '../support/datagrid-helpers';

describe('Testing Parent Only pages and their behavior', () => {
  beforeEach(() => {
    cy.task('db:reset');
    cy.task('db:seed');
    Cypress.session.clearAllSavedSessions();
    cy.clearCookies();
    cy.clearLocalStorage();
    cy.visit('/');
    cy.window().then((win) => { win.sessionStorage.clear(); });
    cy.login(TEST_CREDENTIALS.email, TEST_CREDENTIALS.password);
  });

  describe('Display list', () => {
    it('1.1 shows empty state with no items', () => {
      cy.visit('/parent_only');
      assertDataGridEmpty();
    });

    it('1.2 shows list with one item', () => {
      cy.task('db:populateParentOnly', 1);
      cy.visit('/parent_only');
      getDataGridRowCount().should('eq', 1);
      cy.contains('Parent Only 1').should('be.visible');
    });

    it('1.3 shows list with multiple items', () => {
      cy.task('db:populateParentOnly', 3);
      cy.visit('/parent_only');
      getDataGridRowCount().should('eq', 3);
    });
  });

  describe('Create', () => {
    it('2.1 creates with minimal data (required fields only)', () => {
      cy.visit('/parent_only');
      cy.clickButton('Create New Parent Only');
      cy.fillField('Name', 'Test Parent Only');
      cy.clickButton('Save');
      cy.url().should('include', '/parent_only');
      cy.contains('Test Parent Only').should('be.visible');
      // Verify on view page
      cy.contains('Test Parent Only').click();
      cy.url().should('include', '/parent_only/view');
      cy.checkField('Name', 'Test Parent Only');
    });

    it('2.2 creates with full data (all fields and children)', () => {
      cy.visit('/parent_only');
      cy.clickButton('Create New Parent Only');
      cy.fillField('Name', 'Test Parent Only');
      cy.fillField('Description', 'Test Description');
      cy.fillDateTime('Login Time', '01/15/2025 09:00 AM');
      cy.fillDateTime('Logout Time', '01/15/2025 05:00 PM');
      cy.clickButton('Save');
      cy.url().should('include', '/parent_only');
      cy.contains('Test Parent Only').should('be.visible');
      // Verify on view page
      cy.contains('Test Parent Only').click();
      cy.url().should('include', '/parent_only/view');
      cy.checkField('Name', 'Test Parent Only');
      cy.checkField('Description', 'Test Description');
      cy.checkField('Login Time', '01/15/2025 09:00 AM');
      cy.checkField('Logout Time', '01/15/2025 05:00 PM');
    });
  });

  describe('Edit', () => {
    it('3.1 adds optional data and child items', () => {
      cy.task<any[]>('db:populateParentOnly', 1).then((records) => {
        cy.visit('/parent_only');
        cy.contains('Parent Only 1').click();
        cy.contains('Edit').click();
        cy.url().should('include', '/parent_only/edit');
        cy.fillField('Description', 'Test Description');
        cy.fillDateTime('Login Time', '01/15/2025 09:00 AM');
        cy.fillDateTime('Logout Time', '01/15/2025 05:00 PM');
        cy.clickButton('Save');
        cy.url().should('include', '/parent_only');
        cy.contains('Parent Only 1').should('be.visible');
        // Verify on view page
        cy.contains('Parent Only 1').click();
        cy.url().should('include', '/parent_only/view');
        cy.checkField('Name', 'Parent Only 1');
      });
    });

    it('3.2 removes optional data and child items', () => {
      cy.task<any[]>('db:populateParentOnlyFull', 1).then((records) => {
        cy.visit('/parent_only');
        cy.contains('Parent Only 1').click();
        cy.contains('Edit').click();
        cy.url().should('include', '/parent_only/edit');
        cy.clearField('Description');
        cy.clearDateTime('Login Time');
        cy.clearDateTime('Logout Time');
        cy.clickButton('Save');
        cy.url().should('include', '/parent_only');
        cy.contains('Parent Only 1').should('be.visible');
      });
    });

    it('3.3 edits with mixed changes', () => {
      cy.task<any[]>('db:populateParentOnly', 1).then((records) => {
        cy.visit('/parent_only');
        cy.contains('Parent Only 1').click();
        cy.contains('Edit').click();
        cy.clearAndFillField('Name', 'Updated Parent Only');
        cy.fillField('Description', 'Updated Description');
        cy.clickButton('Save');
        cy.url().should('include', '/parent_only');
        cy.contains('Updated Parent Only').should('be.visible');
        // Verify on view page
        cy.contains('Updated Parent Only').click();
        cy.url().should('include', '/parent_only/view');
        cy.checkField('Name', 'Updated Parent Only');
      });
    });
  });

  describe('Delete', () => {
    it('4.1 deletes a single item from list view', () => {
      cy.task('db:populateParentOnly', 2);
      cy.visit('/parent_only');
      cy.selectDataGridRows([0]);
      cy.clickButton('Delete Selected');
      cy.get('div[role="dialog"]').find('button').contains('Delete').click();
      getDataGridRowCount().should('eq', 1);
    });

    it('4.2 deletes multiple items from list view', () => {
      cy.task('db:populateParentOnly', 3);
      cy.visit('/parent_only');
      cy.selectDataGridRows([0, 1]);
      cy.clickButton('Delete Selected');
      cy.get('div[role="dialog"]').find('button').contains('Delete').click();
      getDataGridRowCount().should('eq', 1);
    });

    it('4.3 deletes an item from edit page', () => {
      cy.task('db:populateParentOnly', 1);
      cy.visit('/parent_only');
      cy.contains('Parent Only 1').click();
      cy.contains('Edit').click();
      cy.url().should('include', '/parent_only/edit');
      cy.clickButton('Delete Parent Only');
      cy.get('div[role="dialog"]').find('button').contains('Delete').click();
      cy.url().should('include', '/parent_only');
      cy.contains('Parent Only 1').should('not.exist');
    });
  });

  describe('Fail create', () => {
    it('5.1 fails when required parent field is missing', () => {
      cy.visit('/parent_only/new');
      cy.clickButton('Save');
      cy.url().should('include', '/parent_only/new');
    });

  });

  describe('Fail edit', () => {
    it('6.1 fails when required parent field is cleared', () => {
      cy.task('db:populateParentOnly', 1);
      cy.visit('/parent_only');
      cy.contains('Parent Only 1').click();
      cy.contains('Edit').click();
      cy.clearField('Name');
      cy.clickButton('Save');
      cy.url().should('include', '/parent_only/edit');
    });

  });
});
