// AUTO-GENERATED - DO NOT EDIT
import { TEST_CREDENTIALS } from '../support/test-credentials';
import { assertDataGridEmpty, getDataGridRowCount } from '../support/datagrid-helpers';

describe('Testing Role pages and their behavior', () => {
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
      cy.visit('/en/role');
      assertDataGridEmpty();
    });

    it('1.2 shows list with one item', () => {
      cy.task('db:populateRole', 1);
      cy.visit('/en/role');
      cy.contains('Role 1').should('be.visible');
      getDataGridRowCount().should('eq', 1);
    });

    it('1.3 shows list with multiple items', () => {
      cy.task('db:populateRole', 3);
      cy.visit('/en/role');
      cy.contains('Role 1').should('be.visible');
      getDataGridRowCount().should('eq', 3);
    });
  });

  describe('Create', () => {
    it('2.1 creates with minimal data (required fields only)', () => {
      cy.visit('/en/role');
      cy.clickButton('Create New Role');
      cy.fillField('Name', 'Test Role');
      cy.clickButton('Save');
      cy.url().should('include', '/role');
      cy.contains('Test Role').should('be.visible');
      // Verify on view page
      cy.contains('Test Role').click();
      cy.url().should('include', '/role/view');
      cy.checkField('Name', 'Test Role');
    });

    it('2.2 creates with full data (all fields and children)', () => {
      cy.task('db:populateUserAccount', 2);
      cy.visit('/en/role');
      cy.clickButton('Create New Role');
      cy.fillField('Name', 'Test Role');
      cy.fillField('Description', 'Test Description');
      // Add list item: User Accounts
      cy.clickButton('Add UserAccount');
      cy.get('div[role="dialog"]').find('input').type('User Account 1');
      cy.get('.MuiAutocomplete-popper li').contains('User Account 1').click();
      cy.get('div[role="dialog"]').find('button').contains('Add').click();
      cy.clickButton('Save');
      cy.url().should('include', '/role');
      cy.contains('Test Role').should('be.visible');
      // Verify on view page
      cy.contains('Test Role').click();
      cy.url().should('include', '/role/view');
      cy.checkField('Name', 'Test Role');
      cy.checkField('Description', 'Test Description');
    });
  });

  describe('Edit', () => {
    it('3.1 adds optional data and child items', () => {
      cy.task<any[]>('db:populateRole', 1).then((records) => {
        cy.task('db:populateUserAccount', 2);
        cy.visit('/en/role');
        cy.contains('Role 1').click();
        cy.get('[aria-label="Edit"]').click();
        cy.url().should('include', '/role/edit');
        cy.fillField('Description', 'Test Description');
        cy.clickButton('Add UserAccount');
        cy.get('div[role="dialog"]').find('input').type('User Account 1');
        cy.get('.MuiAutocomplete-popper li').contains('User Account 1').click();
        cy.get('div[role="dialog"]').find('button').contains('Add').click();
        cy.clickButton('Save');
        cy.url().should('include', '/role');
        cy.contains('Role 1').should('be.visible');
        // Verify on view page
        cy.contains('Role 1').click();
        cy.url().should('include', '/role/view');
        cy.checkField('Name', 'Role 1');
      });
    });

    it('3.2 removes optional data and child items', () => {
      cy.task<any[]>('db:populateRoleFull', 1).then((records) => {
        cy.visit('/en/role');
        cy.contains('Role 1').click();
        cy.get('[aria-label="Edit"]').click();
        cy.url().should('include', '/role/edit');
        cy.clearField('Description');
        cy.clickButton('Save');
        cy.url().should('include', '/role');
        cy.contains('Role 1').should('be.visible');
      });
    });

    it('3.3 edits with mixed changes', () => {
      cy.task<any[]>('db:populateRole', 1).then((records) => {
        cy.visit('/en/role');
        cy.contains('Role 1').click();
        cy.get('[aria-label="Edit"]').click();
        cy.clearAndFillField('Name', 'Updated Role');
        cy.fillField('Description', 'Updated Description');
        cy.clickButton('Save');
        cy.url().should('include', '/role');
        cy.contains('Updated Role').should('be.visible');
        // Verify on view page
        cy.contains('Updated Role').click();
        cy.url().should('include', '/role/view');
        cy.checkField('Name', 'Updated Role');
      });
    });
  });

  describe('Delete', () => {
    it('4.1 deletes a single item from list view', () => {
      cy.task('db:populateRole', 2);
      cy.visit('/en/role');
      cy.selectDataGridRows([0]);
      cy.get('div').find('button[aria-label="Delete Selected"]').click();
      cy.get('div[role="dialog"]').find('button').contains('Delete').click();
      getDataGridRowCount().should('eq', 1);
    });

    it('4.2 deletes multiple items from list view', () => {
      cy.task('db:populateRole', 3);
      cy.visit('/en/role');
      cy.selectDataGridRows([0, 1]);
      cy.get('div').find('button[aria-label="Delete Selected"]').click();
      cy.get('div[role="dialog"]').find('button').contains('Delete').click();
      getDataGridRowCount().should('eq', 1);
    });

    it('4.3 deletes an item from edit page', () => {
      cy.task('db:populateRole', 1);
      cy.visit('/en/role');
      cy.contains('Role 1').click();
      cy.get('[aria-label="Edit"]').click();
      cy.url().should('include', '/role/edit');
      cy.clickButton('Delete Role');
      cy.get('div[role="dialog"]').find('button').contains('Delete').click();
      cy.url().should('include', '/role');
      cy.contains('Role 1').should('not.exist');
    });
  });

  describe('Fail create', () => {
    it('5.1 fails when required parent field is missing', () => {
      cy.visit('/en/role/new');
      cy.clickButton('Save');
      cy.url().should('include', '/role/new');
    });

  });

  describe('Fail edit', () => {
    it('6.1 fails when required parent field is cleared', () => {
      cy.task('db:populateRole', 1);
      cy.visit('/en/role');
      cy.contains('Role 1').click();
      cy.get('[aria-label="Edit"]').click();
      cy.clearField('Name');
      cy.clickButton('Save');
      cy.url().should('include', '/role/edit');
    });

  });
});
