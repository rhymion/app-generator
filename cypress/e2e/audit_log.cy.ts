// AUTO-GENERATED - DO NOT EDIT
import { TEST_CREDENTIALS } from '../support/test-credentials';
import { getDataGridRowCount, getDataGridTotalRowCount } from '../support/datagrid-helpers';

describe('Testing Audit Log pages and their behavior', () => {
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
      cy.visit('/en/audit_log');
      cy.visit('/en/audit_log');
      // cy.login() in beforeEach fires the NextAuth signIn event, which calls
      // recordAuditEvent({ action: 'auth:signIn', ... }) (auth.ts events.signIn)
      // and writes 1 audit_log row before this test body ever runs.
      getDataGridTotalRowCount().should('eq', 1);
    });

    it('1.2 shows list with one item', () => {
      cy.task('db:populateAuditLog', 1);
      cy.visit('/en/audit_log');
      cy.get('.MuiDataGrid-virtualScroller').scrollTo('bottom', { ensureScrollable: false });
      cy.contains('Test Action 1').scrollIntoView().should('be.visible');
      getDataGridTotalRowCount().should('eq', 2);
    });

    it('1.3 shows list with multiple items', () => {
      cy.task('db:populateAuditLog', 3);
      cy.visit('/en/audit_log');
      cy.get('.MuiDataGrid-virtualScroller').scrollTo('bottom', { ensureScrollable: false });
      cy.contains('Test Action 1').scrollIntoView().should('be.visible');
      // Use aria-rowcount for the total (getDataGridRowCount counts only virtualised DOM rows)
      getDataGridTotalRowCount().should('eq', 4);
    });
  });
});
