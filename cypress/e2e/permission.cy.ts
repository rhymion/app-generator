// AUTO-GENERATED - DO NOT EDIT
import { TEST_CREDENTIALS } from '../support/test-credentials';
import { getDataGridRowCount, getDataGridTotalRowCount } from '../support/datagrid-helpers';

describe('Testing Permission pages and their behavior', () => {
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
    it('1.1 shows 15 seed-only item(s) before any user data', () => {
      cy.visit('/en/permission');
      cy.visit('/en/permission');
      // db:seed + db:grantAllPermissions pre-populate 15 permission record(s)
      // Use aria-rowcount to count all rows (getDataGridRowCount only counts virtualised visible rows)
      getDataGridTotalRowCount().should('eq', 15);
    });

    it('1.2 shows list with one item', () => {
      cy.task('db:populatePermission', 1);
      cy.visit('/en/permission');
      cy.get('.MuiDataGrid-virtualScroller').scrollTo('bottom', { ensureScrollable: false });
      cy.contains('user').scrollIntoView().should('be.visible');
      getDataGridTotalRowCount().should('eq', 16);
    });

    it('1.3 shows list with multiple items', () => {
      cy.task('db:populatePermission', 3);
      cy.visit('/en/permission');
      cy.get('.MuiDataGrid-virtualScroller').scrollTo('bottom', { ensureScrollable: false });
      cy.contains('user').scrollIntoView().should('be.visible');
      // Use aria-rowcount for the total (getDataGridRowCount counts only virtualised DOM rows)
      getDataGridTotalRowCount().should('eq', 18);
    });
  });

  describe('Create', () => {
    it('2.1 creates with minimal data (required fields only)', () => {
      cy.task<any>('db:populatePermissionDependencies').then((deps) => {
        cy.visit('/en/permission');
        cy.clickButton('Create New Permission');
        cy.url().should('include', '/permission/new');
        cy.selectAutocomplete('Name', 'User');
        cy.setCheckbox('Create', true);
        cy.setCheckbox('Read', true);
        cy.setCheckbox('Update', true);
        cy.setCheckbox('Delete', true);
        cy.clickButton('Save');
        cy.url().should('include', '/permission');
        cy.url().should('not.include', '/permission/');
        cy.get('.MuiDataGrid-virtualScroller').scrollTo('bottom', { ensureScrollable: false });
        cy.contains('user').scrollIntoView().should('be.visible');
        // Verify on view page
        cy.get('.MuiDataGrid-virtualScroller').scrollTo('bottom', { ensureScrollable: false });
        cy.contains('.MuiDataGrid-row', 'user').find('a').first().click();
        cy.url().should('include', '/permission/view');
        cy.checkField('Name', 'User');
      });
    });

    it('2.2 creates with full data (all fields and children)', () => {
      cy.task<any>('db:populatePermissionDependencies').then((deps) => {
        cy.visit('/en/permission');
        cy.clickButton('Create New Permission');
        cy.url().should('include', '/permission/new');
        cy.selectAutocomplete('Name', 'User');
        cy.setCheckbox('Create', true);
        cy.setCheckbox('Read', true);
        cy.setCheckbox('Update', true);
        cy.setCheckbox('Delete', true);
        cy.selectAutocomplete('Role', deps.role.name);
        cy.clickButton('Save');
        cy.url().should('include', '/permission');
        cy.url().should('not.include', '/permission/');
        cy.get('.MuiDataGrid-virtualScroller').scrollTo('bottom', { ensureScrollable: false });
        cy.contains('user').scrollIntoView().should('be.visible');
        // Verify on view page
        cy.get('.MuiDataGrid-virtualScroller').scrollTo('bottom', { ensureScrollable: false });
        cy.get('.MuiDataGrid-row').last().find('a').first().click();
        cy.url().should('include', '/permission/view');
        cy.checkField('Name', 'User');
        cy.checkField('Role', 'Test Role');
      });
    });
  });

  describe('Edit', () => {
    it('3.1 adds optional data and child items', () => {
      cy.task<any>('db:populatePermissionDependencies').then((deps) => {
        cy.task('db:populatePermission', 1);
        cy.visit('/en/permission');
        cy.get('.MuiDataGrid-virtualScroller').scrollTo('bottom', { ensureScrollable: false });
        cy.contains('.MuiDataGrid-row', 'user').find('a').first().click();
        cy.get('a[aria-label="Edit"]').click();
        cy.url().should('include', '/permission/edit');
        cy.selectAutocomplete('Role', deps.role.name);
        cy.clickButton('Save');
        cy.url().should('include', '/permission');
        cy.url().should('not.include', '/permission/');
        cy.get('.MuiDataGrid-virtualScroller').scrollTo('bottom', { ensureScrollable: false });
        cy.contains('user').scrollIntoView().should('be.visible');
        // Verify on view page
        cy.contains('.MuiDataGrid-row', 'user').find('a').first().click();
        cy.url().should('include', '/permission/view');
        cy.checkField('Name', 'User');
      });
    });

    it('3.2 removes optional data and child items', () => {
      cy.task<any[]>('db:populatePermissionFull', 1).then((records) => {
        cy.visit('/en/permission');
        cy.get('.MuiDataGrid-virtualScroller').scrollTo('bottom', { ensureScrollable: false });
        cy.contains('.MuiDataGrid-row', 'user').find('a').first().click();
        cy.get('a[aria-label="Edit"]').click();
        cy.url().should('include', '/permission/edit');
        cy.clickButton('Save');
        cy.url().should('include', '/permission');
        cy.url().should('not.include', '/permission/');
        cy.get('.MuiDataGrid-virtualScroller').scrollTo('bottom', { ensureScrollable: false });
        cy.contains('user').scrollIntoView().should('be.visible');
      });
    });

    it('3.3 edits with mixed changes', () => {
      cy.task<any[]>('db:populatePermission', 1).then((records) => {
        // Use record ID to navigate directly — list_id_1 may not be unique (e.g. entity_select
        // overlap with seed data from grantAllEntityPermissions), causing the wrong row to be
        // clicked and leading to a unique-constraint conflict on save.
        cy.visit(`/en/permission/edit/${records[0].id}`);
        cy.selectAutocomplete('Name', 'Setting');
        cy.clickButton('Save');
        cy.url().should('include', '/permission');
        cy.url().should('not.include', '/permission/');
        // Verify on view page
        // Non-unique list_id: navigate by record ID to avoid virtual-scroll
        // range issues (the renamed value may be beyond the initial viewport).
        cy.visit(`/en/permission/view/${records[0].id}`);
        cy.url().should('include', '/permission/view');
        cy.checkField('Name', 'Setting');
      });
    });
  });

  describe('Delete', () => {
    it('4.1 deletes a single item from list view', () => {
      // Use task return value to target a known-populated record by name,
      // avoiding seed rows (e.g. the logged-in admin) that cannot be self-deleted.
      cy.task<any[]>('db:populatePermission', 2).then((records) => {
        cy.visit('/en/permission');
        cy.get('.MuiDataGrid-virtualScroller').scrollTo('bottom', { ensureScrollable: false });
        const name = records[0].name as string;
        cy.contains('[role="row"]', name).find('input[type="checkbox"]').check();
        cy.get('div').find('button[aria-label="Delete Selected"]').first().click();
        cy.get('div[role="dialog"]').find('button').contains('Delete').first().click();
        getDataGridTotalRowCount().should('eq', 16);
      });
    });

    it('4.2 deletes multiple items from list view', () => {
      // Use task return value to target known-populated records by name,
      // avoiding seed rows (e.g. the logged-in admin) that cannot be self-deleted.
      cy.task<any[]>('db:populatePermission', 3).then((records) => {
        cy.visit('/en/permission');
        const firstName = records[0].name as string;
        const secondName = records[1].name as string;
        if (firstName !== secondName) {
          cy.contains('[role="row"]', firstName).find('input[type="checkbox"]').check();
          cy.contains('[role="row"]', secondName).find('input[type="checkbox"]').check();
        } else {
          cy.selectDataGridRows([0, 1]);
        }
        cy.get('div').find('button[aria-label="Delete Selected"]').first().click();
        cy.get('div[role="dialog"]').find('button').contains('Delete').first().click();
        getDataGridTotalRowCount().should('eq', 16);
      });
    });

    it('4.3 deletes an item from edit page', () => {
      cy.task('db:populatePermission', 1);
      cy.visit('/en/permission');
      cy.get('.MuiDataGrid-virtualScroller').scrollTo('bottom', { ensureScrollable: false });
      cy.contains('.MuiDataGrid-row', 'user').find('a').first().click();
      cy.get('a[aria-label="Edit"]').click();
      cy.url().should('include', '/permission/edit');
      cy.clickButton('Delete Permission');
      cy.get('div[role="dialog"]').find('button').contains('Delete').first().click();
      cy.url().should('not.include', '/edit');
      cy.url().should('include', '/permission');
      cy.url().should('not.include', '/permission/');
    });
  });

  describe('Fail create', () => {
    it('5.1 fails when required parent field is missing', () => {
      cy.task<any>('db:populatePermissionDependencies').then((deps) => {
        cy.visit('/en/permission/new');
        // Wait for form to fully render before interacting (async autocomplete options can
        // cause a re-render that detaches checkbox elements mid-assertion).
        cy.get('button[aria-label="Save"]').should('be.visible');
        cy.setCheckbox('Create', true);
        cy.setCheckbox('Read', true);
        cy.setCheckbox('Update', true);
        cy.setCheckbox('Delete', true);
        cy.clickButton('Save');
        cy.url().should('include', '/permission/new');
      });
    });

  });

  describe('Fail edit', () => {
    it('6.1 fails when required parent field is cleared', () => {
      cy.task('db:populatePermission', 1);
      cy.visit('/en/permission');
      cy.get('.MuiDataGrid-virtualScroller').scrollTo('bottom', { ensureScrollable: false });
      cy.contains('.MuiDataGrid-row', 'user').find('a').first().click();
      cy.get('a[aria-label="Edit"]').click();
      cy.clearAutocomplete('Name');
      cy.clickButton('Save');
      cy.url().should('include', '/permission/edit');
    });

  });
});
