// Hand-written (not generator-produced) — cmd_665.
//
// Recovered from the generator-produced cypress/e2e/mobile/approval_flow.cy.ts
// as it existed immediately before x-generate.test was set to false for
// approval_flow (app-generator commit 4e8ae006, the last commit where this
// file was still generated). See ../approval_flow_desktop_crud.cy.ts for
// the full rationale. All 9 tests here are usable unmodified: none of them
// touch preceded_by/followed_by at all (the mobile create/edit flow only
// exercises plain scalar-field navigation), so none needed a
// same-entity_name adjustment — only the seeding mechanism changed, from a
// generated Cypress task to direct API calls (../../support/approval_flow_seed.ts).
import { TEST_CREDENTIALS } from '../../support/test-credentials';
import { seedApprovalFlowRows } from '../../support/approval_flow_seed';

const MOBILE = { width: 375, height: 667 }; // iPhone SE

describe('Testing Approval Flow pages and their behavior [mobile] (hand-written port, cmd_665)', () => {
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
    it('1.1 shows the empty state when there are no items', () => {
      cy.visit('/en/approval_flow');
      cy.contains('No items found.').should('be.visible');
      cy.get('input[type="checkbox"][aria-label^="Select "]').should('not.exist');
    });

    it('1.2 renders one card per item with the primary value as title', () => {
      seedApprovalFlowRows(1);
      cy.visit('/en/approval_flow');
      cy.contains('user').should('be.visible');
      cy.get('input[type="checkbox"][aria-label^="Select "]').should('have.length', 1);
    });

    it('1.3 renders multiple cards', () => {
      seedApprovalFlowRows(3);
      cy.visit('/en/approval_flow');
      cy.get('input[type="checkbox"][aria-label^="Select "]').should('have.length', 3);
    });

    it('1.4 opens the view page when the card title is tapped', () => {
      seedApprovalFlowRows(1);
      cy.visit('/en/approval_flow');
      cy.contains('user').click();
      cy.url().should('include', '/approval_flow/view');
    });
  });

  describe('Create from card list', () => {
    it('2.1 navigates to the new page via the toolbar add button', () => {
      cy.visit('/en/approval_flow');
      // See the original generated file's comment history (cmd_653) for why
      // this waits on CardListClient's own root rather than a "not.exist"
      // marker: TableSkeleton and the desktop->mobile hydration swap are two
      // independent async gaps, and only a positive marker owned by the
      // mobile component itself proves it has actually mounted.
      cy.get('[data-testid="mobile-card-list"]').should('exist');
      cy.get('[data-testid="mobile-card-list"] button[aria-label="Create New Approval Flow"]').click();
      cy.url().should('include', '/approval_flow/new');
    });
  });

  describe('Edit from card', () => {
    it('3.1 navigates to the edit page via the card action button', () => {
      seedApprovalFlowRows(1);
      cy.visit('/en/approval_flow');
      cy.get('[aria-label="Edit"]').first().click();
      cy.url().should('include', '/approval_flow/edit');
    });
  });

  describe('Delete from card list', () => {
    it('4.1 deletes a single item via the card checkbox + toolbar', () => {
      seedApprovalFlowRows(2);
      cy.visit('/en/approval_flow');
      cy.get('input[type="checkbox"][aria-label^="Select "]').first().check();
      cy.get('button[aria-label="Delete Selected"]').should('not.be.disabled').click();
      cy.get('div[role="dialog"]').find('button[aria-label="Delete"]').click();
      cy.get('input[type="checkbox"][aria-label^="Select "]').should('have.length', 1);
    });

    it('4.2 deletes multiple items in one toolbar action', () => {
      seedApprovalFlowRows(3);
      cy.visit('/en/approval_flow');
      cy.get('input[type="checkbox"][aria-label^="Select "]').eq(0).check();
      cy.get('input[type="checkbox"][aria-label^="Select "]').eq(1).check();
      cy.get('button[aria-label="Delete Selected"]').click();
      cy.get('div[role="dialog"]').find('button[aria-label="Delete"]').click();
      cy.get('input[type="checkbox"][aria-label^="Select "]').should('have.length', 1);
    });

    it('4.3 toolbar delete button is disabled when no card is selected', () => {
      seedApprovalFlowRows(1);
      cy.visit('/en/approval_flow');
      cy.get('button[aria-label="Delete Selected"]').should('be.disabled');
    });
  });
});
