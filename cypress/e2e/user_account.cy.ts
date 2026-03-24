// AUTO-GENERATED - DO NOT EDIT
import { TEST_CREDENTIALS } from '../support/test-credentials';
import { assertDataGridEmpty, getDataGridRowCount } from '../support/datagrid-helpers';

describe('Testing User Account pages and their behavior', () => {
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
      cy.visit('/en/user_account');
      cy.visit('/en/user_account');
      getDataGridRowCount().should('eq', 1); // Default seeded user account
    });

    it('1.2 shows list with one item', () => {
      cy.task('db:populateUserAccount', 1);
      cy.visit('/en/user_account');
      cy.contains('User Account 1').should('be.visible');
      getDataGridRowCount().should('eq', 2); // Default seeded + 1 populated
    });

    it('1.3 shows list with multiple items', () => {
      cy.task('db:populateUserAccount', 3);
      cy.visit('/en/user_account');
      cy.contains('User Account 1').should('be.visible');
      getDataGridRowCount().should('eq', 4); // Default seeded + 3 populated
    });
  });

  describe('Edit', () => {
    it('3.1 adds optional data and child items', () => {
      cy.task<any[]>('db:populateUserAccount', 1).then((records) => {
        cy.task('db:populateRole', 2);
        cy.visit('/en/user_account');
        cy.contains('User Account 1').click();
        cy.get('[aria-label="Edit"]').click();
        cy.url().should('include', '/user_account/edit');
        cy.clickButton('Add Roles');
        cy.get('div[role="dialog"]').find('input').type('Role 1');
        cy.get('.MuiAutocomplete-popper li').contains('Role 1').click();
        cy.get('div[role="dialog"]').find('button').contains('Add').click();
        cy.clickButton('Save');
        cy.url().should('include', '/user_account');
        cy.contains('User Account 1').should('be.visible');
        // Verify on view page
        cy.contains('User Account 1').click();
        cy.url().should('include', '/user_account/view');
        cy.checkField('Name', 'User Account 1');
      });
    });

    it('3.2 removes optional data and child items', () => {
      cy.task<any[]>('db:populateUserAccount', 1).then((records) => {
        cy.visit('/en/user_account');
        cy.contains('User Account 1').click();
        cy.get('[aria-label="Edit"]').click();
        cy.url().should('include', '/user_account/edit');
        cy.clickButton('Save');
        cy.url().should('include', '/user_account');
        cy.contains('User Account 1').should('be.visible');
      });
    });

    it('3.3 edits with mixed changes', () => {
      cy.task<any[]>('db:populateUserAccount', 1).then((records) => {
        cy.visit('/en/user_account');
        cy.contains('User Account 1').click();
        cy.get('[aria-label="Edit"]').click();
        cy.clearAndFillField('Name', 'Updated User Account');
        cy.clickButton('Save');
        cy.url().should('include', '/user_account');
        cy.contains('Updated User Account').should('be.visible');
        // Verify on view page
        cy.contains('Updated User Account').click();
        cy.url().should('include', '/user_account/view');
        cy.checkField('Name', 'Updated User Account');
      });
    });
  });

  describe('Delete', () => {
    it('4.1 deletes a single item from list view', () => {
      cy.task('db:populateUserAccount', 2);
      cy.visit('/en/user_account');
      cy.contains('User Account 1').parent().parent().find('input[type="checkbox"]').check();
      //cy.selectDataGridRows([0]);
      cy.get('div').find('button[aria-label="Delete Selected"]').click();
      cy.get('div[role="dialog"]').find('button').contains('Delete').click();
      cy.contains('User Account 1').should('not.exist');
      getDataGridRowCount().should('eq', 2);
    });

    it('4.2 deletes multiple items from list view', () => {
      cy.task('db:populateUserAccount', 3);
      cy.visit('/en/user_account');
      cy.contains('User Account 1').parent().parent().find('input[type="checkbox"]').check();
      cy.contains('User Account 2').parent().parent().find('input[type="checkbox"]').check();
      //cy.selectDataGridRows([0, 1]);
      cy.get('div').find('button[aria-label="Delete Selected"]').click();
      cy.get('div[role="dialog"]').find('button').contains('Delete').click();
      cy.contains('User Account 1').should('not.exist');
      getDataGridRowCount().should('eq', 2);
    });

    it('4.3 deletes an item from edit page', () => {
      cy.task('db:populateUserAccount', 1);
      cy.visit('/en/user_account');
      cy.contains('User Account 1').click();
      cy.get('[aria-label="Edit"]').click();
      cy.url().should('include', '/user_account/edit');
      cy.clickButton('Delete User Account');
      cy.get('div[role="dialog"]').find('button').contains('Delete').click();
      cy.url().should('include', '/user_account');
      cy.contains('User Account 1').should('not.exist');
    });
  });

  describe('Fail edit', () => {
    it('6.1 fails when required parent field is cleared', () => {
      cy.task('db:populateUserAccount', 1);
      cy.visit('/en/user_account');
      cy.contains('User Account 1').click();
      cy.get('[aria-label="Edit"]').click();
      cy.clearField('Name');
      cy.clickButton('Save');
      cy.url().should('include', '/user_account/edit');
    });

  });
});
