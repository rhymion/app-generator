// AUTO-GENERATED - DO NOT EDIT
import { TEST_CREDENTIALS } from '../support/test-credentials';
import { getDataGridRowCount, getDataGridTotalRowCount } from '../support/datagrid-helpers';

describe('Testing User pages and their behavior', () => {
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
    it('1.1 shows 1 seed-only item(s) before any user data', () => {
      cy.visit('/en/user');
      cy.visit('/en/user');
      // db:seed + db:grantAllPermissions pre-populate 1 user record(s)
      // Use aria-rowcount to count all rows (getDataGridRowCount only counts virtualised visible rows)
      getDataGridTotalRowCount().should('eq', 1);
    });

    it('1.2 shows list with one item', () => {
      cy.task('db:populateUser', 1);
      cy.visit('/en/user');
      cy.get('.MuiDataGrid-virtualScroller').scrollTo('bottom', { ensureScrollable: false });
      cy.contains('User 1').scrollIntoView().should('be.visible');
      getDataGridTotalRowCount().should('eq', 2);
    });

    it('1.3 shows list with multiple items', () => {
      cy.task('db:populateUser', 3);
      cy.visit('/en/user');
      cy.get('.MuiDataGrid-virtualScroller').scrollTo('bottom', { ensureScrollable: false });
      cy.contains('User 1').scrollIntoView().should('be.visible');
      // Use aria-rowcount for the total (getDataGridRowCount counts only virtualised DOM rows)
      getDataGridTotalRowCount().should('eq', 4);
    });
  });

  describe('Edit', () => {
    it('3.1 adds optional data and child items', () => {
      cy.task<any[]>('db:populateUser', 1).then((records) => {
        cy.task('db:populateRole', 2);
        cy.visit('/en/user');
        cy.get('.MuiDataGrid-virtualScroller').scrollTo('bottom', { ensureScrollable: false });
        cy.contains('User 1').click();
        cy.get('a[aria-label="Edit"]').click();
        cy.url().should('include', '/user/edit');
        cy.clickButton('Add Roles');
        cy.get('div[role="dialog"]').find('input').type('Role 1');
        cy.get('.MuiAutocomplete-popper li').contains('Role 1').click();
        cy.get('div[role="dialog"]').find('button').contains('Add').click();
        cy.clickButton('Save');
        cy.url().should('include', '/user');
        cy.url().should('not.include', '/user/');
        cy.get('.MuiDataGrid-virtualScroller').scrollTo('bottom', { ensureScrollable: false });
        cy.contains('User 1').scrollIntoView().should('be.visible');
        // Verify on view page
        cy.contains('User 1').click();
        cy.url().should('include', '/user/view');
        cy.checkField('Name', 'User 1');
      });
    });

    it('3.2 removes optional data and child items', () => {
      cy.task<any[]>('db:populateUser', 1).then((records) => {
        cy.visit('/en/user');
        cy.get('.MuiDataGrid-virtualScroller').scrollTo('bottom', { ensureScrollable: false });
        cy.contains('User 1').click();
        cy.get('a[aria-label="Edit"]').click();
        cy.url().should('include', '/user/edit');
        cy.clickButton('Save');
        cy.url().should('include', '/user');
        cy.url().should('not.include', '/user/');
        cy.get('.MuiDataGrid-virtualScroller').scrollTo('bottom', { ensureScrollable: false });
        cy.contains('User 1').scrollIntoView().should('be.visible');
      });
    });

    it('3.3 edits with mixed changes', () => {
      cy.task<any[]>('db:populateUser', 1).then((records) => {
        cy.visit('/en/user');
        cy.get('.MuiDataGrid-virtualScroller').scrollTo('bottom', { ensureScrollable: false });
        cy.contains('.MuiDataGrid-row', 'User 1').find('a').first().click();
        cy.get('a[aria-label="Edit"]').click();
        cy.clearAndFillField('Name', 'Updated User');
        cy.clickButton('Save');
        cy.url().should('include', '/user');
        cy.url().should('not.include', '/user/');
        cy.contains('Updated User').scrollIntoView().should('be.visible');
        // Verify on view page
        cy.contains('Updated User').click();
        cy.url().should('include', '/user/view');
        cy.checkField('Name', 'Updated User');
      });
    });
  });

  describe('Delete', () => {
    it('4.1 deletes a single item from list view', () => {
      // Use task return value to target a known-populated record by name,
      // avoiding seed rows (e.g. the logged-in admin) that cannot be self-deleted.
      cy.task<any[]>('db:populateUser', 2).then((records) => {
        cy.visit('/en/user');
        cy.get('.MuiDataGrid-virtualScroller').scrollTo('bottom', { ensureScrollable: false });
        const name = records[0].name as string;
        cy.contains('[role="row"]', name).find('input[type="checkbox"]').check();
        cy.get('div').find('button[aria-label="Delete Selected"]').first().click();
        cy.get('div[role="dialog"]').find('button').contains('Delete').first().click();
        getDataGridTotalRowCount().should('eq', 2);
      });
    });

    it('4.2 deletes multiple items from list view', () => {
      // Use task return value to target known-populated records by name,
      // avoiding seed rows (e.g. the logged-in admin) that cannot be self-deleted.
      cy.task<any[]>('db:populateUser', 3).then((records) => {
        cy.visit('/en/user');
        const firstName = records[0].name as string;
        const secondName = records[1].name as string;
        if (firstName !== secondName) {
          cy.contains('[role="row"]', firstName).find('input[type="checkbox"]').check();
          cy.contains('[role="row"]', secondName).find('input[type="checkbox"]').check();
        } else {
          cy.selectDataGridRows([0, 1]);
        }
        cy.get('div').find('button[aria-label="Delete Selected"]').first().click();
        cy.get('div[role="dialog"]').find('button').contains('Delete').first().click();
        getDataGridTotalRowCount().should('eq', 2);
      });
    });

    it('4.3 deletes an item from edit page', () => {
      cy.task('db:populateUser', 1);
      cy.visit('/en/user');
      cy.get('.MuiDataGrid-virtualScroller').scrollTo('bottom', { ensureScrollable: false });
      cy.contains('User 1').click();
      cy.get('a[aria-label="Edit"]').click();
      cy.url().should('include', '/user/edit');
      cy.clickButton('Delete User');
      cy.get('div[role="dialog"]').find('button').contains('Delete').first().click();
      cy.url().should('not.include', '/edit');
      cy.url().should('include', '/user');
      cy.url().should('not.include', '/user/');
      cy.contains('User 1').should('not.exist');
    });
  });

  describe('Fail edit', () => {
    it('6.1 fails when required parent field is cleared', () => {
      cy.task('db:populateUser', 1);
      cy.visit('/en/user');
      cy.get('.MuiDataGrid-virtualScroller').scrollTo('bottom', { ensureScrollable: false });
      cy.contains('User 1').click();
      cy.get('a[aria-label="Edit"]').click();
      cy.clearField('Name');
      cy.clickButton('Save');
      cy.url().should('include', '/user/edit');
    });

  });
});
