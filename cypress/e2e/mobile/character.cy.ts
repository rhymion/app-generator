// AUTO-GENERATED - DO NOT EDIT
//
// Mobile-viewport spec (Character). The list page renders a different
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

describe('Testing Character pages and their behavior [mobile]', () => {
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
      cy.visit('/en/character');
      cy.contains('No items found.').should('be.visible');
      // Sanity: no row Checkboxes when the list is empty.
      cy.get('input[type="checkbox"][aria-label^="Select "]').should('not.exist');
    });

    it('1.2 renders one card per item with the primary value as title', () => {
      cy.task('db:populateCharacter', 1);
      cy.visit('/en/character');
      cy.contains('Character 1').should('be.visible');
      cy.get('input[type="checkbox"][aria-label^="Select "]').should('have.length', 1);
    });

    it('1.3 renders multiple cards', () => {
      cy.task('db:populateCharacter', 3);
      cy.visit('/en/character');
      cy.get('input[type="checkbox"][aria-label^="Select "]').should('have.length', 3);
    });

    it('1.4 opens the view page when the card title is tapped', () => {
      cy.task('db:populateCharacter', 1);
      cy.visit('/en/character');
      cy.contains('Character 1').click();
      cy.url().should('include', '/character/view');
    });
  });

  describe('Create from card list', () => {
    it('2.1 navigates to the new page via the toolbar add button', () => {
      cy.visit('/en/character');
      // ResponsiveListClient's `useMediaQuery` returns false during SSR (no
      // window), so the initial HTML at any viewport ships the desktop
      // DataGrid; hydration re-runs the hook and swaps DataGrid → CardListClient
      // at mobile widths. Clicking the toolbar Add button mid-swap lands on a
      // non-hydrated handler and navigation silently no-ops — wait for the
      // CardListClient to finish hydration before clicking.
      // No seed items: wait for the "No items found" message as hydration marker.
      cy.get('p[class*="MuiTypography-root"]').should('exist');
      // CardListClient renders the toolbar add as an IconButton with the same
      // aria-label as the desktop variant ("Create New Character").
      cy.get('button[aria-label="Create New Character"]').click();
      cy.url().should('include', '/character/new');
    });
  });

  describe('Edit from card', () => {
    it('3.1 navigates to the edit page via the card action button', () => {
      cy.task('db:populateCharacter', 1);
      cy.visit('/en/character');
      // CardActions renders an Edit IconButton per card with aria-label="Edit".
      cy.get('[aria-label="Edit"]').first().click();
      cy.url().should('include', '/character/edit');
    });
  });

  describe('Delete from card list', () => {
    it('4.1 deletes a single item via the card checkbox + toolbar', () => {
      cy.task('db:populateCharacter', 2);
      cy.visit('/en/character');
      // Select the first card via its Checkbox (aria-label="Select <title>").
      cy.get('input[type="checkbox"][aria-label^="Select "]').first().check();
      // Toolbar delete only enables once at least one card is selected.
      cy.get('button[aria-label="Delete Selected"]').should('not.be.disabled').click();
      // Confirmation Dialog — the Delete button carries aria-label="Delete".
      cy.get('div[role="dialog"]').find('button[aria-label="Delete"]').click();
      // 2 populated − 1 deleted = 1 remaining.
      cy.get('input[type="checkbox"][aria-label^="Select "]').should('have.length', 1);
    });

    it('4.2 deletes multiple items in one toolbar action', () => {
      cy.task('db:populateCharacter', 3);
      cy.visit('/en/character');
      cy.get('input[type="checkbox"][aria-label^="Select "]').eq(0).check();
      cy.get('input[type="checkbox"][aria-label^="Select "]').eq(1).check();
      cy.get('button[aria-label="Delete Selected"]').click();
      cy.get('div[role="dialog"]').find('button[aria-label="Delete"]').click();
      // 3 populated − 2 deleted = 1 remaining.
      cy.get('input[type="checkbox"][aria-label^="Select "]').should('have.length', 1);
    });

    it('4.3 toolbar delete button is disabled when no card is selected', () => {
      cy.task('db:populateCharacter', 1);
      cy.visit('/en/character');
      cy.get('button[aria-label="Delete Selected"]').should('be.disabled');
    });
  });
});
