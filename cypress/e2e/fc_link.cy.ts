// AUTO-GENERATED - DO NOT EDIT
import { TEST_CREDENTIALS } from '../support/test-credentials';
import { assertDataGridEmpty, getDataGridRowCount, getDataGridTotalRowCount } from '../support/datagrid-helpers';

describe('Testing Fc Link pages and their behavior', () => {
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
      cy.visit('/en/fc_link');
      cy.visit('/en/fc_link');
      assertDataGridEmpty();
    });

    it('1.2 shows list with one item', () => {
      cy.task('db:populateFcLink', 1);
      cy.visit('/en/fc_link');
      cy.get('.MuiDataGrid-virtualScroller').scrollTo('bottom', { ensureScrollable: false });
      cy.contains('Fc Link 1').scrollIntoView().should('be.visible');
      getDataGridTotalRowCount().should('eq', 1);
    });

    it('1.3 shows list with multiple items', () => {
      cy.task('db:populateFcLink', 3);
      cy.visit('/en/fc_link');
      cy.get('.MuiDataGrid-virtualScroller').scrollTo('bottom', { ensureScrollable: false });
      cy.contains('Fc Link 1').scrollIntoView().should('be.visible');
      // Use aria-rowcount for the total (getDataGridRowCount counts only virtualised DOM rows)
      getDataGridTotalRowCount().should('eq', 3);
    });
  });

  describe('Edit', () => {
    it('3.3 edits with mixed changes', () => {
      cy.task<any[]>('db:populateFcLink', 1).then((records) => {
        cy.visit('/en/fc_link');
        cy.get('.MuiDataGrid-virtualScroller').scrollTo('bottom', { ensureScrollable: false });
        cy.contains('.MuiDataGrid-row', 'Fc Link 1').find('a').first().click();
        cy.get('a[aria-label="Edit"]').click();
        cy.clearAndFillField('Name', 'Updated Fc Link');
        cy.clickButton('Save');
        cy.url().should('include', '/fc_link');
        cy.url().should('not.include', '/fc_link/');
        cy.contains('Updated Fc Link').scrollIntoView().should('be.visible');
        // Verify on view page
        cy.contains('Updated Fc Link').click();
        cy.url().should('include', '/fc_link/view');
        cy.checkField('Name', 'Updated Fc Link');
      });
    });
  });

  describe('Delete', () => {
    it('4.1 deletes a single item from list view', () => {
      cy.task('db:populateFcLink', 2);
      cy.visit('/en/fc_link');
      cy.selectDataGridRows([0]);
      cy.get('div').find('button[aria-label="Delete Selected"]').first().click();
      cy.get('div[role="dialog"]').find('button').contains('Delete').first().click();
      cy.contains('Fc Link 1').should('not.exist');
      getDataGridTotalRowCount().should('eq', 1);
    });

    it('4.2 deletes multiple items from list view', () => {
      cy.task('db:populateFcLink', 3);
      cy.visit('/en/fc_link');
      cy.selectDataGridRows([0, 1]);
      cy.get('div').find('button[aria-label="Delete Selected"]').first().click();
      cy.get('div[role="dialog"]').find('button').contains('Delete').first().click();
      cy.contains('Fc Link 1').should('not.exist');
      getDataGridTotalRowCount().should('eq', 1);
    });

    it('4.3 deletes an item from edit page', () => {
      cy.task('db:populateFcLink', 1);
      cy.visit('/en/fc_link');
      cy.get('.MuiDataGrid-virtualScroller').scrollTo('bottom', { ensureScrollable: false });
      cy.contains('Fc Link 1').click();
      cy.get('a[aria-label="Edit"]').click();
      cy.url().should('include', '/fc_link/edit');
      cy.clickButton('Delete Fc Link');
      cy.get('div[role="dialog"]').find('button').contains('Delete').first().click();
      cy.url().should('not.include', '/edit');
      cy.url().should('include', '/fc_link');
      cy.url().should('not.include', '/fc_link/');
      cy.contains('Fc Link 1').should('not.exist');
    });
  });

  describe('Fail edit', () => {
    it('6.1 fails when required parent field is cleared', () => {
      cy.task('db:populateFcLink', 1);
      cy.visit('/en/fc_link');
      cy.get('.MuiDataGrid-virtualScroller').scrollTo('bottom', { ensureScrollable: false });
      cy.contains('Fc Link 1').click();
      cy.get('a[aria-label="Edit"]').click();
      cy.clearField('Name');
      cy.clickButton('Save');
      cy.url().should('include', '/fc_link/edit');
    });

  });
});
