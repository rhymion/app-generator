// The list search box follows the entity's search columns: role is a cross-entity search target
// (box shown by default); user is excluded from search (`search: false`), so its list has the
// sort/filter panel but no search box.
import { TEST_CREDENTIALS } from '../support/test-credentials';

describe('List search box presence', () => {
  beforeEach(() => {
    cy.task('db:reset');
    cy.task('db:seed');
    cy.task('db:grantAllPermissions');
    Cypress.session.clearAllSavedSessions();
    cy.clearCookies();
    cy.clearLocalStorage();
    cy.viewport(1280, 720);
    cy.visit('/en/');
    cy.window().then((win) => { win.sessionStorage.clear(); });
    cy.login(TEST_CREDENTIALS.email, TEST_CREDENTIALS.password);
  });

  it('shows the search box on a search-target entity list', () => {
    cy.visit('/en/role');
    cy.get('[data-testid="list-query-panel"]').should('be.visible');
    cy.get('[data-testid="list-search"]').should('exist');
  });

  it('hides the search box on an entity that is not a search target', () => {
    cy.visit('/en/user');
    cy.get('[data-testid="list-query-panel"]').should('be.visible');
    cy.get('[data-testid="list-search"]').should('not.exist');
  });
});
