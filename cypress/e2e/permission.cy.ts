// AUTO-GENERATED - DO NOT EDIT
import { TEST_CREDENTIALS } from '../support/test-credentials';
import { assertDataGridEmpty, getDataGridRowCount } from '../support/datagrid-helpers';

describe('Testing Permission pages and their behavior', () => {
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
      cy.visit('/en/permission');
      cy.visit('/en/permission');
      assertDataGridEmpty();
    });

    it('1.2 shows list with one item', () => {
      cy.task('db:populatePermission', 1);
      cy.visit('/en/permission');
      cy.contains('user').should('be.visible');
      getDataGridRowCount().should('eq', 1);
    });

    it('1.3 shows list with multiple items', () => {
      cy.task('db:populatePermission', 3);
      cy.visit('/en/permission');
      cy.contains('user').should('be.visible');
      getDataGridRowCount().should('eq', 3);
    });
  });

  describe('Create', () => {
    it('2.1 creates with minimal data (required fields only)', () => {
      cy.task<any>('db:populatePermissionDependencies').then((deps) => {
        cy.visit('/en/permission');
        cy.clickButton('Create New Permission');
        cy.url().should('include', '/permission/new');
        cy.selectAutocomplete('Name', 'User');
        cy.setCheckbox('Create', true);
        cy.setCheckbox('Read', true);
        cy.setCheckbox('Update', true);
        cy.setCheckbox('Delete', true);
        cy.clickButton('Save');
        cy.url().should('include', '/permission');
        cy.url().should('not.include', '/permission/');
        cy.contains('user').should('be.visible');
        // Verify on view page
        cy.get('.MuiDataGrid-row').last().find('a').first().click();
        cy.url().should('include', '/permission/view');
        cy.checkField('Name', 'User');
      });
    });

    it('2.2 creates with full data (all fields and children)', () => {
      cy.task<any>('db:populatePermissionDependencies').then((deps) => {
        cy.visit('/en/permission');
        cy.clickButton('Create New Permission');
        cy.url().should('include', '/permission/new');
        cy.selectAutocomplete('Name', 'User');
        cy.setCheckbox('Create', true);
        cy.setCheckbox('Read', true);
        cy.setCheckbox('Update', true);
        cy.setCheckbox('Delete', true);
        cy.selectAutocomplete('Role', deps.role.name);
        cy.clickButton('Save');
        cy.url().should('include', '/permission');
        cy.url().should('not.include', '/permission/');
        cy.contains('user').should('be.visible');
        // Verify on view page
        cy.get('.MuiDataGrid-row').last().find('a').first().click();
        cy.url().should('include', '/permission/view');
        cy.checkField('Name', 'User');
        cy.checkField('Role', 'Test Role');
      });
    });
  });

  describe('Edit', () => {
    it('3.1 adds optional data and child items', () => {
      cy.task<any>('db:populatePermissionDependencies').then((deps) => {
        cy.task('db:populatePermission', 1);
        cy.visit('/en/permission');
        cy.contains('user').click();
        cy.get('a[aria-label="Edit"]').click();
        cy.url().should('include', '/permission/edit');
        cy.selectAutocomplete('Role', deps.role.name);
        cy.clickButton('Save');
        cy.url().should('include', '/permission');
        cy.url().should('not.include', '/permission/');
        cy.contains('user').should('be.visible');
        // Verify on view page
        cy.contains('user').click();
        cy.url().should('include', '/permission/view');
        cy.checkField('Name', 'User');
      });
    });

    it('3.2 removes optional data and child items', () => {
      cy.task<any[]>('db:populatePermissionFull', 1).then((records) => {
        cy.visit('/en/permission');
        cy.contains('user').click();
        cy.get('a[aria-label="Edit"]').click();
        cy.url().should('include', '/permission/edit');
        cy.clickButton('Save');
        cy.url().should('include', '/permission');
        cy.url().should('not.include', '/permission/');
        cy.contains('user').should('be.visible');
      });
    });

    it('3.3 edits with mixed changes', () => {
      cy.task<any[]>('db:populatePermission', 1).then((records) => {
        cy.visit('/en/permission');
        cy.contains('user').click();
        cy.get('a[aria-label="Edit"]').click();
        cy.selectAutocomplete('Name', 'Setting');
        cy.clickButton('Save');
        cy.url().should('include', '/permission');
        cy.url().should('not.include', '/permission/');
        cy.contains('setting').should('be.visible');
        // Verify on view page
        cy.contains('setting').click();
        cy.url().should('include', '/permission/view');
        cy.checkField('Name', 'Setting');
      });
    });
  });

  describe('Delete', () => {
    it('4.1 deletes a single item from list view', () => {
      cy.task('db:populatePermission', 2);
      cy.visit('/en/permission');
      cy.selectDataGridRows([0]);
      cy.get('div').find('button[aria-label="Delete Selected"]').click();
      cy.get('div[role="dialog"]').find('button').contains('Delete').first().click();
      getDataGridRowCount().should('eq', 1);
    });

    it('4.2 deletes multiple items from list view', () => {
      cy.task('db:populatePermission', 3);
      cy.visit('/en/permission');
      cy.selectDataGridRows([0, 1]);
      cy.get('div').find('button[aria-label="Delete Selected"]').click();
      cy.get('div[role="dialog"]').find('button').contains('Delete').first().click();
      getDataGridRowCount().should('eq', 1);
    });

    it('4.3 deletes an item from edit page', () => {
      cy.task('db:populatePermission', 1);
      cy.visit('/en/permission');
      cy.contains('user').click();
      cy.get('a[aria-label="Edit"]').click();
      cy.url().should('include', '/permission/edit');
      cy.clickButton('Delete Permission');
      cy.get('div[role="dialog"]').find('button').contains('Delete').first().click();
      cy.url().should('include', '/permission');
      cy.url().should('not.include', '/permission/');
    });
  });

  describe('Fail create', () => {
    it('5.1 fails when required parent field is missing', () => {
      cy.task<any>('db:populatePermissionDependencies').then((deps) => {
        cy.visit('/en/permission/new');
        cy.setCheckbox('Create', true);
        cy.setCheckbox('Read', true);
        cy.setCheckbox('Update', true);
        cy.setCheckbox('Delete', true);
        cy.clickButton('Save');
        cy.url().should('include', '/permission/new');
      });
    });

  });

  describe('Fail edit', () => {
    it('6.1 fails when required parent field is cleared', () => {
      cy.task('db:populatePermission', 1);
      cy.visit('/en/permission');
      cy.contains('user').click();
      cy.get('a[aria-label="Edit"]').click();
      cy.clearAutocomplete('Name');
      cy.clickButton('Save');
      cy.url().should('include', '/permission/edit');
    });

  });
});
