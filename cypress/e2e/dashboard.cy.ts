// AUTO-GENERATED - DO NOT EDIT
import { TEST_CREDENTIALS } from '../support/test-credentials';
import { fillDataGridRow, assertDataGridEmpty, getDataGridRowCount, getDataGridTotalRowCount, assertDataGridRowData } from '../support/datagrid-helpers';

describe('Testing Dashboard pages and their behavior', () => {
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

  describe('Display list', () => {
    it('1.1 shows empty state with no items', () => {
      cy.visit('/en/dashboard');
      cy.visit('/en/dashboard');
      assertDataGridEmpty();
    });

    it('1.2 shows list with one item', () => {
      cy.task('db:populateDashboard', 1);
      cy.visit('/en/dashboard');
      cy.get('.MuiDataGrid-virtualScroller').scrollTo('bottom', { ensureScrollable: false });
      cy.contains('Dashboard 1').scrollIntoView().should('be.visible');
      getDataGridTotalRowCount().should('eq', 1);
    });

    it('1.3 shows list with multiple items', () => {
      cy.task('db:populateDashboard', 3);
      cy.visit('/en/dashboard');
      cy.get('.MuiDataGrid-virtualScroller').scrollTo('bottom', { ensureScrollable: false });
      cy.contains('Dashboard 1').scrollIntoView().should('be.visible');
      // Use aria-rowcount for the total (getDataGridRowCount counts only virtualised DOM rows)
      getDataGridTotalRowCount().should('eq', 3);
    });
  });

  describe('Create', () => {
    it('2.1 creates with minimal data (required fields only)', () => {
      cy.visit('/en/dashboard');
      cy.clickButton('Create New Dashboard');
      cy.url().should('include', '/dashboard/new');
      cy.fillField('Name', 'Test Dashboard');
      // Add required child: Widgets
      cy.clickButton('Add Widgets');
      fillDataGridRow(0, { name: 'Test Widgets', entity_name: 'Test Entity Name', group_by_field: 'Test Group By Field' });
      cy.clickButton('Save');
      cy.url().should('include', '/dashboard');
      cy.url().should('not.include', '/dashboard/');
      cy.get('.MuiDataGrid-virtualScroller').scrollTo('bottom', { ensureScrollable: false });
      cy.contains('Test Dashboard').scrollIntoView().should('be.visible');
      // Verify on view page
      cy.contains('Test Dashboard').click();
      cy.url().should('include', '/dashboard/view');
      cy.checkField('Name', 'Test Dashboard');
    });

    it('2.2 creates with full data (all fields and children)', () => {
      cy.visit('/en/dashboard');
      cy.clickButton('Create New Dashboard');
      cy.url().should('include', '/dashboard/new');
      cy.fillField('Name', 'Test Dashboard');
      // Add child: Widgets
      cy.clickButton('Add Widgets');
      fillDataGridRow(0, { name: 'Test Widgets', entity_name: 'Test Entity Name', series_field: 'Test Series Field', group_by_field: 'Test Group By Field', filter_field: 'Test Filter Field', filter_value: 'Test Filter Value' });
      cy.clickButton('Save');
      cy.url().should('include', '/dashboard');
      cy.url().should('not.include', '/dashboard/');
      cy.get('.MuiDataGrid-virtualScroller').scrollTo('bottom', { ensureScrollable: false });
      cy.contains('Test Dashboard').scrollIntoView().should('be.visible');
      // Verify on view page
      cy.contains('Test Dashboard').click();
      cy.url().should('include', '/dashboard/view');
      cy.checkField('Name', 'Test Dashboard');
    });
  });

  describe('Edit', () => {
    it('3.1 adds optional data and child items', () => {
      cy.task<any[]>('db:populateDashboard', 1).then((records) => {
        cy.visit('/en/dashboard');
        cy.get('.MuiDataGrid-virtualScroller').scrollTo('bottom', { ensureScrollable: false });
        cy.contains('Dashboard 1').click();
        cy.get('a[aria-label="Edit"]').click();
        cy.url().should('include', '/dashboard/edit');
        // Add child: Widgets
        cy.clickButton('Add Widgets');
        fillDataGridRow(0, { name: 'Test Widgets', entity_name: 'Test Entity Name', group_by_field: 'Test Group By Field' });
        cy.clickButton('Save');
        cy.url().should('include', '/dashboard');
        cy.url().should('not.include', '/dashboard/');
        cy.get('.MuiDataGrid-virtualScroller').scrollTo('bottom', { ensureScrollable: false });
        cy.contains('Dashboard 1').scrollIntoView().should('be.visible');
        // Verify on view page
        cy.contains('Dashboard 1').click();
        cy.url().should('include', '/dashboard/view');
        cy.checkField('Name', 'Dashboard 1');
      });
    });

    it('3.2 removes optional data and child items', () => {
      cy.task<any[]>('db:populateDashboard', 1).then((records) => {
        cy.task('db:populateDashboardDashboardWidget', { parentId: records[0].id, length: 1 });
        cy.visit('/en/dashboard');
        cy.get('.MuiDataGrid-virtualScroller').scrollTo('bottom', { ensureScrollable: false });
        cy.contains('Dashboard 1').click();
        cy.get('a[aria-label="Edit"]').click();
        cy.url().should('include', '/dashboard/edit');
        // Delete child: Widgets
        cy.selectDataGridRows([0]);
        cy.contains('h2', 'Widgets').parent().find('button[aria-label="Delete Selected"]').click();
        cy.get('div[role="dialog"]').find('button').contains('Delete').first().click();
        cy.clickButton('Save');
        cy.url().should('include', '/dashboard');
        cy.url().should('not.include', '/dashboard/');
        cy.get('.MuiDataGrid-virtualScroller').scrollTo('bottom', { ensureScrollable: false });
        cy.contains('Dashboard 1').scrollIntoView().should('be.visible');
      });
    });

    it('3.3 edits with mixed changes', () => {
      cy.task<any[]>('db:populateDashboard', 1).then((records) => {
        cy.visit('/en/dashboard');
        cy.get('.MuiDataGrid-virtualScroller').scrollTo('bottom', { ensureScrollable: false });
        cy.contains('.MuiDataGrid-row', 'Dashboard 1').find('a').first().click();
        cy.get('a[aria-label="Edit"]').click();
        cy.clearAndFillField('Name', 'Updated Dashboard');
        cy.clickButton('Save');
        cy.url().should('include', '/dashboard');
        cy.url().should('not.include', '/dashboard/');
        cy.contains('Updated Dashboard').scrollIntoView().should('be.visible');
        // Verify on view page
        cy.contains('Updated Dashboard').click();
        cy.url().should('include', '/dashboard/view');
        cy.checkField('Name', 'Updated Dashboard');
      });
    });
  });

  describe('Delete', () => {
    it('4.1 deletes a single item from list view', () => {
      cy.task('db:populateDashboard', 2);
      cy.visit('/en/dashboard');
      cy.selectDataGridRows([0]);
      cy.get('div').find('button[aria-label="Delete Selected"]').first().click();
      cy.get('div[role="dialog"]').find('button').contains('Delete').first().click();
      cy.contains('Dashboard 1').should('not.exist');
      getDataGridTotalRowCount().should('eq', 1);
    });

    it('4.2 deletes multiple items from list view', () => {
      cy.task('db:populateDashboard', 3);
      cy.visit('/en/dashboard');
      cy.selectDataGridRows([0, 1]);
      cy.get('div').find('button[aria-label="Delete Selected"]').first().click();
      cy.get('div[role="dialog"]').find('button').contains('Delete').first().click();
      cy.contains('Dashboard 1').should('not.exist');
      getDataGridTotalRowCount().should('eq', 1);
    });

    it('4.3 deletes an item from edit page', () => {
      cy.task('db:populateDashboard', 1);
      cy.visit('/en/dashboard');
      cy.get('.MuiDataGrid-virtualScroller').scrollTo('bottom', { ensureScrollable: false });
      cy.contains('Dashboard 1').click();
      cy.get('a[aria-label="Edit"]').click();
      cy.url().should('include', '/dashboard/edit');
      cy.clickButton('Delete Dashboard');
      cy.get('div[role="dialog"]').find('button').contains('Delete').first().click();
      cy.url().should('not.include', '/edit');
      cy.url().should('include', '/dashboard');
      cy.url().should('not.include', '/dashboard/');
      cy.contains('Dashboard 1').should('not.exist');
    });
  });

  describe('Fail create', () => {
    it('5.1 fails when required parent field is missing', () => {
      cy.visit('/en/dashboard/new');
      // Wait for form to fully render before interacting (async autocomplete options can
      // cause a re-render that detaches checkbox elements mid-assertion).
      cy.get('button[aria-label="Save"]').should('be.visible');
      cy.clickButton('Save');
      cy.url().should('include', '/dashboard/new');
    });

    it('5.2 fails when required child scalar field is missing', () => {
      cy.visit('/en/dashboard/new');
      cy.fillField('Name', 'Test Dashboard');
      cy.clickButton('Add Widgets');
      fillDataGridRow(0, { entity_name: 'Test Entity Name', group_by_field: 'Test Group By Field' });
      cy.clickButton('Save');
      cy.url().should('include', '/dashboard/new');
    });

  });

  describe('Fail edit', () => {
    it('6.1 fails when required parent field is cleared', () => {
      cy.task('db:populateDashboard', 1);
      cy.visit('/en/dashboard');
      cy.get('.MuiDataGrid-virtualScroller').scrollTo('bottom', { ensureScrollable: false });
      cy.contains('Dashboard 1').click();
      cy.get('a[aria-label="Edit"]').click();
      cy.clearField('Name');
      cy.clickButton('Save');
      cy.url().should('include', '/dashboard/edit');
    });

    it('6.2 fails when required child field is cleared', () => {
      cy.task<any[]>('db:populateDashboard', 1).then((records) => {
        cy.task('db:populateDashboardDashboardWidget', { parentId: records[0].id, length: 1 });
        cy.visit('/en/dashboard');
        cy.get('.MuiDataGrid-virtualScroller').scrollTo('bottom', { ensureScrollable: false });
        cy.contains('Dashboard 1').click();
        cy.get('a[aria-label="Edit"]').click();
        // Clear required child field
        cy.get('form').should('be.visible');
        cy.get('div[role="row"][data-rowindex="0"]').should('be.visible');
        cy.get('div[role="row"][data-rowindex="0"]').find('div[data-field="name"]').dblclick();
        cy.get('div[role="row"][data-rowindex="0"]').find('div[data-field="name"] input').should('be.visible').type('{selectall}{backspace}');
        cy.get('p').first().click(); // Click outside to commit the edit, as some cells may have async validation that prevents Enter key from working.
        cy.clickButton('Save');
        cy.url().should('include', '/dashboard/edit');
      });
    });
  });
});
