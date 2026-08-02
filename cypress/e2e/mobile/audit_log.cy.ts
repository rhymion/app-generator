// AUTO-GENERATED - DO NOT EDIT
//
// Mobile-viewport spec (Audit Log). The list page renders a different
// component below 768px: ResponsiveListClient swaps in CardListClient (cards
// with per-row Checkboxes and CardActions) instead of the desktop DataGrid.
// The selectors and interactions below target that mobile DOM directly —
// `assertDataGridEmpty` / `getDataGridRowCount` / `selectDataGridRows` don't
// apply here because there is no DataGrid in the tree at this viewport.
//
// Forms (`/new`, `/edit`) keep the same FormUpsert at every viewport, so this
// spec exercises the form via the desktop fill helpers — what's different at
// mobile is the *list* view and how the user gets in and out of it.
import { TEST_CREDENTIALS } from '../../support/test-credentials';

const MOBILE = { width: 375, height: 667 }; // iPhone SE

describe('Testing Audit Log pages and their behavior [mobile]', () => {
  beforeEach(() => {
    cy.viewport(MOBILE.width, MOBILE.height);
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

  describe('Card list', () => {
    it('1.1 shows 1 seed-only item(s) before any user data', () => {
      cy.visit('/en/audit_log');
      // cy.login() in beforeEach fires the NextAuth signIn event, which calls
      // recordAuditEvent({ action: 'auth:signIn', ... }) (auth.ts events.signIn)
      // and writes 1 audit_log row before this test body ever runs.
      // audit_log has no delete capability (read-only feature — permissions.delete
      // is always false for it, since it isn't in ALL_ENTITIES / never gets a
      // permission grant), so CardListClient's per-row Select checkbox (gated on
      // `permissions.delete &&`) never renders here. Count cards by their MUI
      // Card container instead.
      cy.get('.MuiCard-root').should('have.length', 1);
    });

    it('1.2 renders one card per item with the primary value as title', () => {
      cy.task('db:populateAuditLog', 1);
      cy.visit('/en/audit_log');
      cy.contains('Test Action 1').should('be.visible');
      cy.get('.MuiCard-root').should('have.length', 2);
    });

    it('1.3 renders multiple cards', () => {
      cy.task('db:populateAuditLog', 3);
      cy.visit('/en/audit_log');
      cy.get('.MuiCard-root').should('have.length', 4);
    });

    it('1.4 opens the view page when the card title is tapped', () => {
      cy.task('db:populateAuditLog', 1);
      cy.visit('/en/audit_log');
      cy.contains('Test Action 1').click();
      cy.url().should('include', '/audit_log/view');
    });
  });
});
