// AUTO-GENERATED - DO NOT EDIT
//
// Mobile-viewport spec (Permission). The list page renders a different
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

describe('Testing Permission pages and their behavior [mobile]', () => {
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
    it('1.1 shows 15 seed-only card(s) before any user data', () => {
      cy.visit('/en/permission');
      // db:seed + db:grantAllPermissions pre-populate 15 permission record(s)
      cy.get('input[type="checkbox"][aria-label^="Select "]').should('have.length', 15);
    });

    it('1.2 renders one card per item with the primary value as title', () => {
      cy.task('db:populatePermission', 1);
      cy.visit('/en/permission');
      cy.contains('user').should('be.visible');
      cy.get('input[type="checkbox"][aria-label^="Select "]').should('have.length', 16);
    });

    it('1.3 renders multiple cards', () => {
      cy.task('db:populatePermission', 3);
      cy.visit('/en/permission');
      cy.get('input[type="checkbox"][aria-label^="Select "]').should('have.length', 18);
    });

    it('1.4 opens the view page when the card title is tapped', () => {
      cy.task('db:populatePermission', 1);
      cy.visit('/en/permission');
      cy.contains('user').click();
      cy.url().should('include', '/permission/view');
    });
  });

  describe('Create from card list', () => {
    it('2.1 navigates to the new page via the toolbar add button', () => {
      cy.visit('/en/permission');
      // ResponsiveListClient's `useMediaQuery` returns false during SSR (no
      // window), so the initial HTML at any viewport ships the desktop
      // DataGrid; hydration re-runs the hook and swaps DataGrid → CardListClient
      // at mobile widths. Clicking the toolbar Add button mid-swap lands on a
      // non-hydrated handler and navigation silently no-ops — wait for the
      // CardListClient to finish hydration before clicking.
      // Seed items exist: wait for cards to appear as hydration marker.
      cy.get('input[type="checkbox"][aria-label^="Select "]').should('have.length', 15);
      // CardListClient renders the toolbar add as an IconButton with the same
      // aria-label as the desktop variant ("Create New Permission").
      cy.get('button[aria-label="Create New Permission"]').click();
      cy.url().should('include', '/permission/new');
    });
  });

  describe('Edit from card', () => {
    it('3.1 navigates to the edit page via the card action button', () => {
      cy.task('db:populatePermission', 1);
      cy.visit('/en/permission');
      // CardActions renders an Edit IconButton per card with aria-label="Edit".
      cy.get('[aria-label="Edit"]').first().click();
      cy.url().should('include', '/permission/edit');
    });
  });

  describe('Delete from card list', () => {
    it('4.1 deletes a single item via the card checkbox + toolbar', () => {
      // Use task return value to target a known-populated record by name,
      // avoiding seed items (e.g. the logged-in admin) that cannot be self-deleted.
      cy.task<any[]>('db:populatePermission', 2).then((records) => {
        cy.visit('/en/permission');
        const name = records[0].name as string;
        cy.get(`input[type="checkbox"][aria-label="Select ${name}"]`).first().check();
        // Toolbar delete only enables once at least one card is selected.
        cy.get('button[aria-label="Delete Selected"]').should('not.be.disabled').click();
        // Confirmation Dialog — the Delete button carries aria-label="Delete".
        cy.get('div[role="dialog"]').find('button[aria-label="Delete"]').click();
        // 2 populated + 15 seed − 1 deleted = 16 remaining.
        cy.get('input[type="checkbox"][aria-label^="Select "]').should('have.length', 16);
      });
    });

    it('4.2 deletes multiple items in one toolbar action', () => {
      // Use task return value to target known-populated records by name,
      // avoiding seed items that may have FK restrictions preventing deletion.
      cy.task<any[]>('db:populatePermission', 3).then((records) => {
        cy.visit('/en/permission');
        const firstName = records[0].name as string;
        const secondName = records[1].name as string;
        if (firstName !== secondName) {
          cy.get(`input[type="checkbox"][aria-label="Select ${firstName}"]`).first().check();
          cy.get(`input[type="checkbox"][aria-label="Select ${secondName}"]`).first().check();
        } else {
          cy.get('input[type="checkbox"][aria-label^="Select "]').eq(0).check();
          cy.get('input[type="checkbox"][aria-label^="Select "]').eq(1).check();
        }
        cy.get('button[aria-label="Delete Selected"]').click();
        cy.get('div[role="dialog"]').find('button[aria-label="Delete"]').click();
        // 3 populated + 15 seed − 2 deleted = 16 remaining.
        cy.get('input[type="checkbox"][aria-label^="Select "]').should('have.length', 16);
      });
    });

    it('4.3 toolbar delete button is disabled when no card is selected', () => {
      cy.task('db:populatePermission', 1);
      cy.visit('/en/permission');
      cy.get('button[aria-label="Delete Selected"]').should('be.disabled');
    });
  });
});
