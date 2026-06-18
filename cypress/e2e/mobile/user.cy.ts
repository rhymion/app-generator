// AUTO-GENERATED - DO NOT EDIT
//
// Mobile-viewport spec (User). The list page renders a different
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

describe('Testing User pages and their behavior [mobile]', () => {
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
    it('1.1 shows 1 seed-only card(s) before any user data', () => {
      cy.visit('/en/user');
      // db:seed + db:grantAllPermissions pre-populate 1 user record(s)
      cy.get('input[type="checkbox"][aria-label^="Select "]').should('have.length', 1);
    });

    it('1.2 renders one card per item with the primary value as title', () => {
      cy.task('db:populateUser', 1);
      cy.visit('/en/user');
      cy.contains('User 1').should('be.visible');
      cy.get('input[type="checkbox"][aria-label^="Select "]').should('have.length', 2);
    });

    it('1.3 renders multiple cards', () => {
      cy.task('db:populateUser', 3);
      cy.visit('/en/user');
      cy.get('input[type="checkbox"][aria-label^="Select "]').should('have.length', 4);
    });

    it('1.4 opens the view page when the card title is tapped', () => {
      cy.task('db:populateUser', 1);
      cy.visit('/en/user');
      cy.contains('User 1').click();
      cy.url().should('include', '/user/view');
    });
  });

  describe('Edit from card', () => {
    it('3.1 navigates to the edit page via the card action button', () => {
      cy.task('db:populateUser', 1);
      cy.visit('/en/user');
      // CardActions renders an Edit IconButton per card with aria-label="Edit".
      cy.get('[aria-label="Edit"]').first().click();
      cy.url().should('include', '/user/edit');
    });
  });

  describe('Delete from card list', () => {
    it('4.1 deletes a single item via the card checkbox + toolbar', () => {
      // Use task return value to target a known-populated record by name,
      // avoiding seed items (e.g. the logged-in admin) that cannot be self-deleted.
      cy.task<any[]>('db:populateUser', 2).then((records) => {
        cy.visit('/en/user');
        const name = records[0].name as string;
        cy.get(`input[type="checkbox"][aria-label="Select ${name}"]`).first().check();
        // Toolbar delete only enables once at least one card is selected.
        cy.get('button[aria-label="Delete Selected"]').should('not.be.disabled').click();
        // Confirmation Dialog — the Delete button carries aria-label="Delete".
        cy.get('div[role="dialog"]').find('button[aria-label="Delete"]').click();
        // 2 populated + 1 seed − 1 deleted = 2 remaining.
        cy.get('input[type="checkbox"][aria-label^="Select "]').should('have.length', 2);
      });
    });

    it('4.2 deletes multiple items in one toolbar action', () => {
      // Use task return value to target known-populated records by name,
      // avoiding seed items that may have FK restrictions preventing deletion.
      cy.task<any[]>('db:populateUser', 3).then((records) => {
        cy.visit('/en/user');
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
        // 3 populated + 1 seed − 2 deleted = 2 remaining.
        cy.get('input[type="checkbox"][aria-label^="Select "]').should('have.length', 2);
      });
    });

    it('4.3 toolbar delete button is disabled when no card is selected', () => {
      cy.task('db:populateUser', 1);
      cy.visit('/en/user');
      cy.get('button[aria-label="Delete Selected"]').should('be.disabled');
    });
  });
});
