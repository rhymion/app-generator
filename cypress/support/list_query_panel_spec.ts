// Shared by the desktop and the mobile-viewport list search panel specs: the same scenarios run
// against the role list, whose rows are drawn as a grid on a desktop viewport and as cards on a phone.
import { TEST_CREDENTIALS, TEST_API_KEY } from './test-credentials';

type Layout = 'grid' | 'cards';

const ROLES = [
  { name: 'Zeta Panel', description: 'common' },
  { name: 'Alpha Panel', description: 'common' },
  { name: 'Beta Panel', description: 'unique' },
];

function seedRoles() {
  ROLES.forEach((role) => {
    cy.request({
      method: 'POST',
      url: '/api/role',
      headers: { 'X-API-Key': TEST_API_KEY },
      body: role,
    }).its('status').should('eq', 201);
  });
}

/** The text of every row (or card) of the list that carries "Panel", in display order. */
function namesOf($rows: JQuery<HTMLElement>): string[] {
  return $rows
    .toArray()
    .map((row) => (row.textContent ?? '').match(/(Alpha|Beta|Zeta) Panel/)?.[0])
    .filter((name): name is string => Boolean(name));
}

/**
 * Asserts the names shown, in order. The check is one retried `should` callback: a `.then` after
 * `cy.get` is not retried, so it would read the rows once, before the list has answered.
 */
function expectNames(layout: Layout, expected: string[]) {
  const rows = layout === 'grid' ? '.MuiDataGrid-row' : '[data-testid="mobile-card-list"] .MuiCard-root';
  return cy.get(rows).should(($rows) => {
    expect(namesOf($rows)).to.deep.equal(expected);
  });
}

function expectCount(layout: Layout, count: number) {
  const rows = layout === 'grid' ? '.MuiDataGrid-row' : '[data-testid="mobile-card-list"] .MuiCard-root';
  return cy.get(rows).should(($rows) => {
    expect(namesOf($rows)).to.have.length(count);
  });
}

export function describeListQueryPanel(label: string, viewport: { width: number; height: number }, layout: Layout) {
  describe(`List search panel (${label})`, () => {
    beforeEach(() => {
      cy.task('db:reset');
      cy.task('db:seed');
      cy.task('db:grantAllPermissions');
      Cypress.session.clearAllSavedSessions();
      cy.clearCookies();
      cy.clearLocalStorage();
      cy.viewport(viewport.width, viewport.height);
      cy.visit('/en/');
      cy.window().then((win) => { win.sessionStorage.clear(); });
      cy.login(TEST_CREDENTIALS.email, TEST_CREDENTIALS.password);
      seedRoles();
      cy.visit('/en/role');
      // Wait for the layout of the viewport to be the one on screen (the list first renders as a grid
      // and swaps to cards on a phone), then for the panel to be hydrated: React marks a node it has
      // attached handlers to with a `__reactProps$` key, and a click or key press before that is lost.
      cy.get(layout === 'grid' ? '.MuiDataGrid-root' : '[data-testid="mobile-card-list"]').should('be.visible');
      cy.get('[data-testid="list-query-panel"]').should('be.visible');
      cy.get('[data-testid="list-search"]').should(($input) => {
        expect(Object.keys($input[0]).some((key) => key.startsWith('__reactProps$'))).to.eq(true);
      });
    });

    it('lays the list out for the viewport', () => {
      if (layout === 'cards') cy.get('[data-testid="mobile-card-list"]').should('be.visible');
      else cy.get('.MuiDataGrid-root').should('be.visible');
    });

    it('searches the name column', () => {
      cy.get('[data-testid="list-search"]').type('beta');
      expectNames(layout, ['Beta Panel']);
      cy.get('[data-testid="list-search"]').clear();
      expectCount(layout, 3);
    });

    it('filters on several fields at once', () => {
      cy.get('[data-testid="list-filter-toggle"]').click();
      cy.get('[data-testid="list-filter-name"]').type('Panel');
      cy.get('[data-testid="list-filter-description"]').type('common');
      expectCount(layout, 2);
      cy.get('[data-testid="list-filter-toggle"]').should('contain.text', 'Filter (2)');
      cy.get('[data-testid="list-filter-description"]').clear().type('unique');
      expectNames(layout, ['Beta Panel']);
      cy.get('[data-testid="list-filter-clear"]').click();
      expectCount(layout, 3);
    });

    it('sorts by several columns, each ascending or descending', () => {
      cy.get('[data-testid="list-search"]').type('Panel');
      cy.get('[data-testid="list-sort-toggle"]').click();
      // description ascending first (common < unique), then name descending within a description.
      cy.get('[data-testid="list-sort-description"]').click();
      cy.get('[data-testid="list-sort-name"]').click();
      cy.get('[data-testid="list-sort-name"]').click();
      cy.get('[data-testid="list-sort-name"]').should('contain.text', '↓ 2');
      expectNames(layout, ['Zeta Panel', 'Alpha Panel', 'Beta Panel']);
      cy.get('[data-testid="list-sort-description"]').click();
      expectNames(layout, ['Beta Panel', 'Zeta Panel', 'Alpha Panel']);
      cy.get('[data-testid="list-sort-clear"]').click();
      expectCount(layout, 3);
    });

    if (layout === 'grid') {
      // The grid keeps sorting from its column headers; a header click sorts by that column alone and
      // the panel shows it.
      it('lets a column header replace the panel sort', () => {
        cy.get('[data-testid="list-search"]').type('Panel');
        cy.get('[data-testid="list-sort-toggle"]').click();
        cy.get('[data-testid="list-sort-description"]').click();
        cy.get('[data-testid="list-sort-name"]').click();
        cy.get('[data-testid="list-sort-toggle"]').should('contain.text', 'Sort: Description ↑ +1');
        cy.get('.MuiDataGrid-columnHeader[data-field="name"] .MuiDataGrid-columnHeaderTitle').click();
        cy.get('[data-testid="list-sort-toggle"]').should('have.text', 'Sort: Name ↑');
        expectNames(layout, ['Alpha Panel', 'Beta Panel', 'Zeta Panel']);
        cy.get('.MuiDataGrid-columnHeader[data-field="name"] .MuiDataGrid-columnHeaderTitle').click();
        expectNames(layout, ['Zeta Panel', 'Beta Panel', 'Alpha Panel']);
      });
    }

    it('combines the search, a filter and a sort', () => {
      cy.get('[data-testid="list-search"]').type('Panel');
      cy.get('[data-testid="list-filter-toggle"]').click();
      cy.get('[data-testid="list-filter-description"]').type('common');
      cy.get('[data-testid="list-sort-toggle"]').click();
      cy.get('[data-testid="list-sort-name"]').click();
      expectNames(layout, ['Alpha Panel', 'Zeta Panel']);
      cy.get('[data-testid="list-sort-name"]').click();
      expectNames(layout, ['Zeta Panel', 'Alpha Panel']);
    });
  });
}
