import { TEST_API_KEY, TEST_CREDENTIALS } from '../support/test-credentials';

// The dashboard edit form draws widgets with components/dashboard/widgets.tsx (x-custom-component on
// dashboard.widgets). The default schema opts no entity into the dashboard, so the data-source list is empty here;
// selecting an entity from a populated list is covered by the component test and by consumer projects.
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

  function createDashboardWithWidget(entityName: string) {
    return cy.request({
      method: 'POST',
      url: '/api/dashboard',
      headers: { 'X-API-Key': TEST_API_KEY },
      body: {
        name: 'Editor Dashboard',
        widgets: [{ name: 'Old widget', entity_name: entityName, group_by_field: 'status', chart_type: 'column', order: 0 }],
      },
    }).then((res) => {
      expect(res.status).to.eq(201);
      return res.body.id as string;
    });
  }

  it('says there is no data source to choose when no entity opts into the dashboard', () => {
    cy.visit('/en/dashboard/new');
    cy.contains('No entity is enabled for dashboards').should('be.visible');
    cy.contains('button', 'Add widget').click();
    cy.get('[data-testid="widget-row-0"]').should('be.visible');
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
});
