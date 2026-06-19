// Handwritten supplemental spec — NOT auto-generated, NOT overwritten by generate-code.
// Tests: /en/search — global search page UI.
import { TEST_CREDENTIALS } from '../support/test-credentials';

describe('Search page UI', () => {
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

  describe('Page display', () => {
    it('1.1 shows search page with input and button', () => {
      cy.visit('/en/search');
      cy.get('[data-testid="search-input"]').should('be.visible');
      cy.get('button[aria-label="Search"]').should('be.visible');
    });

    it('1.2 redirects unauthenticated users to login', () => {
      cy.clearCookies();
      cy.visit('/en/search');
      cy.url().should('include', '/login');
    });
  });

  describe('Search interaction', () => {
    beforeEach(() => {
      cy.task('db:populateOrganizationWithUser', 2);
    });

    it('2.1 shows results when query matches existing data', () => {
      cy.visit('/en/search');
      cy.get('[data-testid="search-input"]').type('Organization');
      cy.get('button[aria-label="Search"]').click();
      cy.get('[data-testid="search-results"]', { timeout: 10000 }).should('be.visible');
    });

    it('2.2 shows entity type chip in results', () => {
      cy.visit('/en/search');
      cy.get('[data-testid="search-input"]').type('Organization 1');
      cy.get('button[aria-label="Search"]').click();
      cy.get('[data-testid="search-results"]', { timeout: 10000 }).should('be.visible');
      cy.get('[data-testid="search-results"]').contains('Organization').should('be.visible');
    });

    it('2.3 shows no-results message when query has no matches', () => {
      cy.visit('/en/search');
      cy.get('[data-testid="search-input"]').type('zzznomatchxxx');
      cy.get('button[aria-label="Search"]').click();
      cy.get('[data-testid="no-results"]', { timeout: 10000 }).should('be.visible');
    });

    it('2.4 clicking a result navigates to the detail page', () => {
      cy.task('db:populateOrganizationWithUser', 1);
      cy.visit('/en/search');
      cy.get('[data-testid="search-input"]').type('Organization');
      cy.get('button[aria-label="Search"]').click();
      cy.get('[data-testid="search-results"]', { timeout: 10000 }).should('be.visible');
      cy.get('[data-testid="search-results"]').contains('View details').first().click();
      cy.url().should('include', '/organization/view');
    });
  });

  describe('Initial state', () => {
    it('3.1 shows no results before any search', () => {
      cy.visit('/en/search');
      cy.get('[data-testid="search-results"]').should('not.exist');
      cy.get('[data-testid="no-results"]').should('not.exist');
    });
  });
});
