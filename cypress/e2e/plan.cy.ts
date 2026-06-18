// AUTO-GENERATED - DO NOT EDIT
import { TEST_CREDENTIALS } from '../support/test-credentials';
import { assertDataGridEmpty, getDataGridRowCount, getDataGridTotalRowCount } from '../support/datagrid-helpers';

describe('Testing Plan pages and their behavior', () => {
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
      cy.visit('/en/plan');
      cy.visit('/en/plan');
      assertDataGridEmpty();
    });

    it('1.2 shows list with one item', () => {
      cy.task('db:populatePlan', 1);
      cy.visit('/en/plan');
      cy.get('.MuiDataGrid-virtualScroller').scrollTo('bottom', { ensureScrollable: false });
      cy.contains('Free').scrollIntoView().should('be.visible');
      getDataGridTotalRowCount().should('eq', 1);
    });

    it('1.3 shows list with multiple items', () => {
      cy.task('db:populatePlan', 3);
      cy.visit('/en/plan');
      cy.get('.MuiDataGrid-virtualScroller').scrollTo('bottom', { ensureScrollable: false });
      cy.contains('Free').scrollIntoView().should('be.visible');
      // Use aria-rowcount for the total (getDataGridRowCount counts only virtualised DOM rows)
      getDataGridTotalRowCount().should('eq', 3);
    });
  });

  describe('Create', () => {
    it('2.1 creates with minimal data (required fields only)', () => {
      cy.visit('/en/plan');
      cy.clickButton('Create New Plan');
      cy.url().should('include', '/plan/new');
      cy.selectAutocomplete('Tier', 'Free');
      cy.fillField('Reaction Kinds Allowed', '100');
      cy.fillField('Sub Account Limit', '100');
      cy.setCheckbox('Can View Paid Posts', true);
      cy.clickButton('Save');
      cy.url().should('include', '/plan');
      cy.url().should('not.include', '/plan/');
      cy.get('.MuiDataGrid-virtualScroller').scrollTo('bottom', { ensureScrollable: false });
      cy.contains('Free').scrollIntoView().should('be.visible');
      // Verify on view page
      cy.get('.MuiDataGrid-virtualScroller').scrollTo('bottom', { ensureScrollable: false });
      cy.contains('.MuiDataGrid-row', 'Free').find('a').first().click();
      cy.url().should('include', '/plan/view');
      cy.checkField('Tier', 'Free');
      cy.checkField('Reaction Kinds Allowed', '100');
      cy.checkField('Sub Account Limit', '100');
    });

    it('2.2 creates with full data (all fields and children)', () => {
      cy.task('db:populateUser', 2);
      cy.visit('/en/plan');
      cy.clickButton('Create New Plan');
      cy.url().should('include', '/plan/new');
      cy.selectAutocomplete('Tier', 'Free');
      cy.fillField('Reaction Kinds Allowed', '100');
      cy.fillField('Sub Account Limit', '100');
      cy.setCheckbox('Can View Paid Posts', true);
      // Add list item: Users
      cy.clickButton('Add Users');
      cy.get('div[role="dialog"]').find('input').type('User 1');
      cy.get('.MuiAutocomplete-popper li').contains('User 1').click();
      cy.get('div[role="dialog"]').find('button').contains('Add').click();
      cy.clickButton('Save');
      cy.url().should('include', '/plan');
      cy.url().should('not.include', '/plan/');
      cy.get('.MuiDataGrid-virtualScroller').scrollTo('bottom', { ensureScrollable: false });
      cy.contains('Free').scrollIntoView().should('be.visible');
      // Verify on view page
      cy.get('.MuiDataGrid-virtualScroller').scrollTo('bottom', { ensureScrollable: false });
      cy.get('.MuiDataGrid-row').last().find('a').first().click();
      cy.url().should('include', '/plan/view');
      cy.checkField('Tier', 'Free');
      cy.checkField('Reaction Kinds Allowed', '100');
      cy.checkField('Sub Account Limit', '100');
    });
  });

  describe('Edit', () => {
    it('3.1 adds optional data and child items', () => {
      cy.task<any[]>('db:populatePlan', 1).then((records) => {
        cy.task('db:populateUser', 2);
        cy.visit('/en/plan');
        cy.get('.MuiDataGrid-virtualScroller').scrollTo('bottom', { ensureScrollable: false });
        cy.contains('.MuiDataGrid-row', 'Free').find('a').first().click();
        cy.get('a[aria-label="Edit"]').click();
        cy.url().should('include', '/plan/edit');
        cy.clickButton('Add Users');
        cy.get('div[role="dialog"]').find('input').type('User 1');
        cy.get('.MuiAutocomplete-popper li').contains('User 1').click();
        cy.get('div[role="dialog"]').find('button').contains('Add').click();
        cy.clickButton('Save');
        cy.url().should('include', '/plan');
        cy.url().should('not.include', '/plan/');
        cy.get('.MuiDataGrid-virtualScroller').scrollTo('bottom', { ensureScrollable: false });
        cy.contains('Free').scrollIntoView().should('be.visible');
        // Verify on view page
        cy.contains('.MuiDataGrid-row', 'Free').find('a').first().click();
        cy.url().should('include', '/plan/view');
        cy.checkField('Tier', 'Free');
      });
    });

    it('3.2 removes optional data and child items', () => {
      cy.task<any[]>('db:populatePlan', 1).then((records) => {
        cy.visit('/en/plan');
        cy.get('.MuiDataGrid-virtualScroller').scrollTo('bottom', { ensureScrollable: false });
        cy.contains('.MuiDataGrid-row', 'Free').find('a').first().click();
        cy.get('a[aria-label="Edit"]').click();
        cy.url().should('include', '/plan/edit');
        cy.clickButton('Save');
        cy.url().should('include', '/plan');
        cy.url().should('not.include', '/plan/');
        cy.get('.MuiDataGrid-virtualScroller').scrollTo('bottom', { ensureScrollable: false });
        cy.contains('Free').scrollIntoView().should('be.visible');
      });
    });

    it('3.3 edits with mixed changes', () => {
      cy.task<any[]>('db:populatePlan', 1).then((records) => {
        // Use record ID to navigate directly — list_id_1 may not be unique (e.g. entity_select
        // overlap with seed data from grantAllEntityPermissions), causing the wrong row to be
        // clicked and leading to a unique-constraint conflict on save.
        cy.visit(`/en/plan/edit/${records[0].id}`);
        cy.clearAutocomplete('Tier');
        cy.selectAutocomplete('Tier', 'Premium');
        cy.clickButton('Save');
        cy.url().should('include', '/plan');
        cy.url().should('not.include', '/plan/');
        // Verify on view page
        // Non-unique list_id: navigate by record ID to avoid virtual-scroll
        // range issues (the renamed value may be beyond the initial viewport).
        cy.visit(`/en/plan/view/${records[0].id}`);
        cy.url().should('include', '/plan/view');
        cy.checkField('Tier', 'Premium');
      });
    });
  });

  describe('Delete', () => {
    it('4.1 deletes a single item from list view', () => {
      cy.task('db:populatePlan', 2);
      cy.visit('/en/plan');
      cy.selectDataGridRows([0]);
      cy.get('div').find('button[aria-label="Delete Selected"]').first().click();
      cy.get('div[role="dialog"]').find('button').contains('Delete').first().click();
      getDataGridTotalRowCount().should('eq', 1);
    });

    it('4.2 deletes multiple items from list view', () => {
      cy.task('db:populatePlan', 3);
      cy.visit('/en/plan');
      cy.selectDataGridRows([0, 1]);
      cy.get('div').find('button[aria-label="Delete Selected"]').first().click();
      cy.get('div[role="dialog"]').find('button').contains('Delete').first().click();
      getDataGridTotalRowCount().should('eq', 1);
    });

    it('4.3 deletes an item from edit page', () => {
      cy.task('db:populatePlan', 1);
      cy.visit('/en/plan');
      cy.get('.MuiDataGrid-virtualScroller').scrollTo('bottom', { ensureScrollable: false });
      cy.contains('.MuiDataGrid-row', 'Free').find('a').first().click();
      cy.get('a[aria-label="Edit"]').click();
      cy.url().should('include', '/plan/edit');
      cy.clickButton('Delete Plan');
      cy.get('div[role="dialog"]').find('button').contains('Delete').first().click();
      cy.url().should('not.include', '/edit');
      cy.url().should('include', '/plan');
      cy.url().should('not.include', '/plan/');
    });
  });

  describe('Fail create', () => {
    it('5.1 fails when required parent field is missing', () => {
      cy.visit('/en/plan/new');
      // Wait for form to fully render before interacting (async autocomplete options can
      // cause a re-render that detaches checkbox elements mid-assertion).
      cy.get('button[aria-label="Save"]').should('be.visible');
      cy.fillField('Reaction Kinds Allowed', '100');
      cy.fillField('Sub Account Limit', '100');
      cy.setCheckbox('Can View Paid Posts', true);
      cy.clickButton('Save');
      cy.url().should('include', '/plan/new');
    });

  });

  describe('Fail edit', () => {
    it('6.1 fails when required parent field is cleared', () => {
      cy.task('db:populatePlan', 1);
      cy.visit('/en/plan');
      cy.get('.MuiDataGrid-virtualScroller').scrollTo('bottom', { ensureScrollable: false });
      cy.contains('.MuiDataGrid-row', 'Free').find('a').first().click();
      cy.get('a[aria-label="Edit"]').click();
      cy.clearAutocomplete('Tier');
      cy.clickButton('Save');
      cy.url().should('include', '/plan/edit');
    });

  });
});
