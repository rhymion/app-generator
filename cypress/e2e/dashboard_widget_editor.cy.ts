import { TEST_API_KEY, TEST_CREDENTIALS } from '../support/test-credentials';

// The dashboard edit form draws widgets with components/dashboard/widgets.tsx (x-custom-component on
// dashboard.widgets). The spec runs against any schema: it reads whether the schema opts entities into the dashboard
// (the data-source list is empty or not) and expects the matching behavior. Widgets whose data source is unavailable
// are inserted into the database, because the save API rejects them. Selecting an entity from a populated list is
// covered by the component test.
describe('Dashboard widget editor', () => {
  beforeEach(() => {
    cy.task('db:reset');
    cy.task('db:seed');
    cy.task('db:grantAllPermissions');
    Cypress.session.clearAllSavedSessions();
    cy.clearCookies();
    cy.clearLocalStorage();
    cy.visit('/en/');
    cy.login(TEST_CREDENTIALS.email, TEST_CREDENTIALS.password);
  });

  // The editor shows its empty-catalog hint only when the schema opts no entity into the dashboard.
  function withCatalogState(run: (catalogIsEmpty: boolean) => void) {
    cy.visit('/en/dashboard/new');
    cy.contains('button', 'Add widget').should('be.visible');
    cy.get('body').then(($body) => {
      run($body.text().includes('No entity is enabled for dashboards'));
    });
  }

  // Stores a dashboard with one widget whose data source is not available, whatever the schema's catalog holds.
  function createDashboardWithWidget(entityName: string) {
    return cy.task<string>('db:seedDashboardWithWidget', { entityName, groupByField: 'status', widgetName: 'Old widget' });
  }

  it('says there is no data source to choose when no entity opts into the dashboard', () => {
    withCatalogState((catalogIsEmpty) => {
      if (catalogIsEmpty) {
        cy.contains('No entity is enabled for dashboards').should('be.visible');
      } else {
        // Entities are enabled: the hint must not be shown, and a new widget still gets a row to fill in.
        cy.contains('No entity is enabled for dashboards').should('not.exist');
      }
      cy.contains('button', 'Add widget').click();
      cy.get('[data-testid="widget-row-0"]').should('be.visible');
    });
  });

  it('shows an existing widget whose data source is not available and lets the user remove it', () => {
    createDashboardWithWidget('removed_entity').then((id) => {
      cy.visit(`/en/dashboard/edit/${id}`);
      cy.get('[data-testid="widget-row-0"]').within(() => {
        cy.contains('Unknown data source "removed_entity"').should('be.visible');
        cy.contains('button', 'Remove widget').click();
      });
      cy.get('[data-testid="widget-row-0"]').should('not.exist');
      cy.clickButton('Save');
      cy.url().should('not.include', '/dashboard/edit');
      cy.request({ url: `/api/dashboard/${id}`, headers: { 'X-API-Key': TEST_API_KEY } }).then((res) => {
        expect(res.body.widgets).to.have.length(0);
      });
    });
  });

  it('shows the stored group-by field in a dropdown that offers no other field when the data source is unavailable', () => {
    createDashboardWithWidget('removed_entity').then((id) => {
      cy.visit(`/en/dashboard/edit/${id}`);
      cy.get('[data-testid="widget-row-0"]').within(() => {
        cy.get('input[role="combobox"]').filter((_, el) => (el as HTMLInputElement).value === 'status').should('have.length', 1);
        cy.contains('label', 'Group By Field').invoke('attr', 'for').then((inputId) => {
          cy.get(`#${inputId}`).click();
        });
      });
      cy.get('[role="listbox"] [role="option"]').should('have.length', 1).and('have.attr', 'aria-disabled', 'true');
    });
  });

  it('keeps the stored values of an existing widget when the dashboard is saved unchanged', () => {
    createDashboardWithWidget('removed_entity').then((id) => {
      cy.visit(`/en/dashboard/edit/${id}`);
      cy.get('[data-testid="widget-row-0"]').within(() => {
        cy.get('input').first().should('have.value', 'Old widget');
      });
      cy.clickButton('Save');
      cy.url().should('not.include', '/dashboard/edit');
      cy.request({ url: `/api/dashboard/${id}`, headers: { 'X-API-Key': TEST_API_KEY } }).then((res) => {
        expect(res.body.widgets).to.have.length(1);
        expect(res.body.widgets[0]).to.include({ name: 'Old widget', entity_name: 'removed_entity', group_by_field: 'status' });
      });
    });
  });

  // The widget is told why it cannot be drawn through the Server Action's return value, so the translated message
  // reaches the browser under `next build && next start` as well (a thrown error would be replaced by a generic one).
  it('tells the viewer why a widget cannot be drawn, in the page language', () => {
    withCatalogState((catalogIsEmpty) => {
      // With no data source in the schema the widget cannot be drawn at all; otherwise only its own source is gone.
      const en = catalogIsEmpty
        ? 'No entity is enabled for dashboards, so there is nothing to chart'
        : 'The data source “removed_entity” is not available';
      const ja = catalogIsEmpty
        ? 'ダッシュボードに有効なエンティティがないため、表示できるデータがありません'
        : 'データソース「removed_entity」は利用できません';
      createDashboardWithWidget('removed_entity').then((id) => {
        cy.visit(`/en/dashboard/view/${id}`);
        cy.contains(en).should('be.visible');
        cy.contains('Minified React error').should('not.exist');
        cy.visit(`/ja/dashboard/view/${id}`);
        cy.contains(ja).should('be.visible');
      });
    });
  });
});
