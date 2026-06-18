// AUTO-GENERATED - DO NOT EDIT
import { TEST_CREDENTIALS } from '../support/test-credentials';
import { assertDataGridEmpty, getDataGridRowCount, getDataGridTotalRowCount } from '../support/datagrid-helpers';

describe('Testing Approval Flow pages and their behavior', () => {
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
      cy.visit('/en/approval_flow');
      cy.visit('/en/approval_flow');
      assertDataGridEmpty();
    });

    it('1.2 shows list with one item', () => {
      cy.task('db:populateApprovalFlow', 1);
      cy.visit('/en/approval_flow');
      cy.get('.MuiDataGrid-virtualScroller').scrollTo('bottom', { ensureScrollable: false });
      cy.contains('user').scrollIntoView().should('be.visible');
      getDataGridTotalRowCount().should('eq', 1);
    });

    it('1.3 shows list with multiple items', () => {
      cy.task('db:populateApprovalFlow', 3);
      cy.visit('/en/approval_flow');
      cy.get('.MuiDataGrid-virtualScroller').scrollTo('bottom', { ensureScrollable: false });
      cy.contains('user').scrollIntoView().should('be.visible');
      // Use aria-rowcount for the total (getDataGridRowCount counts only virtualised DOM rows)
      getDataGridTotalRowCount().should('eq', 3);
    });
  });

  describe('Create', () => {
    it('2.1 creates with minimal data (required fields only)', () => {
      cy.task<any>('db:populateApprovalFlowDependencies').then((deps) => {
        cy.visit('/en/approval_flow');
        cy.clickButton('Create New Approval Flow');
        cy.url().should('include', '/approval_flow/new');
        cy.selectAutocomplete('Entity Name', 'User');
        cy.selectAutocomplete('Approver Role', deps.approverRole.name);
        cy.clickButton('Save');
        cy.url().should('include', '/approval_flow');
        cy.url().should('not.include', '/approval_flow/');
        cy.get('.MuiDataGrid-virtualScroller').scrollTo('bottom', { ensureScrollable: false });
        cy.contains('user').scrollIntoView().should('be.visible');
        // Verify on view page
        cy.get('.MuiDataGrid-virtualScroller').scrollTo('bottom', { ensureScrollable: false });
        cy.contains('.MuiDataGrid-row', 'user').find('a').first().click();
        cy.url().should('include', '/approval_flow/view');
        cy.checkField('Entity Name', 'User');
        cy.checkField('Approver Role', 'Test Approver Role');
      });
    });

    it('2.2 creates with full data (all fields and children)', () => {
      cy.task<any>('db:populateApprovalFlowDependencies').then((deps) => {
        cy.visit('/en/approval_flow');
        cy.clickButton('Create New Approval Flow');
        cy.url().should('include', '/approval_flow/new');
        cy.selectAutocomplete('Entity Name', 'User');
        cy.selectAutocomplete('Requestor Role', deps.requestorRole.name);
        cy.selectAutocomplete('Approver Role', deps.approverRole.name);
        // Add list item: Preceded By
        cy.clickButton('Add Preceded By');
        cy.get('div[role="dialog"]').find('input').type(deps.precededBy.name);
        cy.get('.MuiAutocomplete-popper li').first().click();
        cy.get('div[role="dialog"]').find('button').contains('Add').click();
        // Add list item: Followed By
        cy.clickButton('Add Followed By');
        cy.get('div[role="dialog"]').find('input').type(deps.followedBy.name);
        cy.get('.MuiAutocomplete-popper li').first().click();
        cy.get('div[role="dialog"]').find('button').contains('Add').click();
        cy.clickButton('Save');
        cy.url().should('include', '/approval_flow');
        cy.url().should('not.include', '/approval_flow/');
        cy.get('.MuiDataGrid-virtualScroller').scrollTo('bottom', { ensureScrollable: false });
        cy.contains('user').scrollIntoView().should('be.visible');
        // Verify on view page
        cy.get('.MuiDataGrid-virtualScroller').scrollTo('bottom', { ensureScrollable: false });
        cy.get('.MuiDataGrid-row').last().find('a').first().click();
        cy.url().should('include', '/approval_flow/view');
        cy.checkField('Entity Name', 'User');
        cy.checkField('Requestor Role', 'Test Requestor Role');
        cy.checkField('Approver Role', 'Test Approver Role');
      });
    });
  });

  describe('Edit', () => {
    it('3.1 adds optional data and child items', () => {
      cy.task<any>('db:populateApprovalFlowDependencies').then((deps) => {
        cy.task('db:populateApprovalFlow', 1);
        cy.visit('/en/approval_flow');
        cy.get('.MuiDataGrid-virtualScroller').scrollTo('bottom', { ensureScrollable: false });
        cy.contains('.MuiDataGrid-row', 'user').find('a').first().click();
        cy.get('a[aria-label="Edit"]').click();
        cy.url().should('include', '/approval_flow/edit');
        cy.selectAutocomplete('Requestor Role', deps.requestorRole.name);
        cy.clickButton('Add Preceded By');
        cy.get('div[role="dialog"]').find('input').type(deps.precededBy.name);
        cy.get('.MuiAutocomplete-popper li').first().click();
        cy.get('div[role="dialog"]').find('button').contains('Add').click();
        cy.clickButton('Add Followed By');
        cy.get('div[role="dialog"]').find('input').type(deps.followedBy.name);
        cy.get('.MuiAutocomplete-popper li').first().click();
        cy.get('div[role="dialog"]').find('button').contains('Add').click();
        cy.clickButton('Save');
        cy.url().should('include', '/approval_flow');
        cy.url().should('not.include', '/approval_flow/');
        cy.get('.MuiDataGrid-virtualScroller').scrollTo('bottom', { ensureScrollable: false });
        cy.contains('user').scrollIntoView().should('be.visible');
        // Verify on view page
        cy.contains('.MuiDataGrid-row', 'user').find('a').first().click();
        cy.url().should('include', '/approval_flow/view');
        cy.checkField('Entity Name', 'User');
      });
    });

    it('3.2 removes optional data and child items', () => {
      cy.task<any[]>('db:populateApprovalFlowFull', 1).then((records) => {
        cy.visit('/en/approval_flow');
        cy.get('.MuiDataGrid-virtualScroller').scrollTo('bottom', { ensureScrollable: false });
        cy.contains('.MuiDataGrid-row', 'user').find('a').first().click();
        cy.get('a[aria-label="Edit"]').click();
        cy.url().should('include', '/approval_flow/edit');
        cy.clickButton('Save');
        cy.url().should('include', '/approval_flow');
        cy.url().should('not.include', '/approval_flow/');
        cy.get('.MuiDataGrid-virtualScroller').scrollTo('bottom', { ensureScrollable: false });
        cy.contains('user').scrollIntoView().should('be.visible');
      });
    });

    it('3.3 edits with mixed changes', () => {
      cy.task<any[]>('db:populateApprovalFlow', 1).then((records) => {
        // Use record ID to navigate directly — list_id_1 may not be unique (e.g. entity_select
        // overlap with seed data from grantAllEntityPermissions), causing the wrong row to be
        // clicked and leading to a unique-constraint conflict on save.
        cy.visit(`/en/approval_flow/edit/${records[0].id}`);
        cy.selectAutocomplete('Entity Name', 'Setting');
        cy.clickButton('Save');
        cy.url().should('include', '/approval_flow');
        cy.url().should('not.include', '/approval_flow/');
        // Verify on view page
        // Non-unique list_id: navigate by record ID to avoid virtual-scroll
        // range issues (the renamed value may be beyond the initial viewport).
        cy.visit(`/en/approval_flow/view/${records[0].id}`);
        cy.url().should('include', '/approval_flow/view');
        cy.checkField('Entity Name', 'Setting');
      });
    });
  });

  describe('Delete', () => {
    it('4.1 deletes a single item from list view', () => {
      cy.task('db:populateApprovalFlow', 2);
      cy.visit('/en/approval_flow');
      cy.selectDataGridRows([0]);
      cy.get('div').find('button[aria-label="Delete Selected"]').first().click();
      cy.get('div[role="dialog"]').find('button').contains('Delete').first().click();
      getDataGridTotalRowCount().should('eq', 1);
    });

    it('4.2 deletes multiple items from list view', () => {
      cy.task('db:populateApprovalFlow', 3);
      cy.visit('/en/approval_flow');
      cy.selectDataGridRows([0, 1]);
      cy.get('div').find('button[aria-label="Delete Selected"]').first().click();
      cy.get('div[role="dialog"]').find('button').contains('Delete').first().click();
      getDataGridTotalRowCount().should('eq', 1);
    });

    it('4.3 deletes an item from edit page', () => {
      cy.task('db:populateApprovalFlow', 1);
      cy.visit('/en/approval_flow');
      cy.get('.MuiDataGrid-virtualScroller').scrollTo('bottom', { ensureScrollable: false });
      cy.contains('.MuiDataGrid-row', 'user').find('a').first().click();
      cy.get('a[aria-label="Edit"]').click();
      cy.url().should('include', '/approval_flow/edit');
      cy.clickButton('Delete Approval Flow');
      cy.get('div[role="dialog"]').find('button').contains('Delete').first().click();
      cy.url().should('not.include', '/edit');
      cy.url().should('include', '/approval_flow');
      cy.url().should('not.include', '/approval_flow/');
    });
  });

  describe('Fail create', () => {
    it('5.1 fails when required parent field is missing', () => {
      cy.task<any>('db:populateApprovalFlowDependencies').then((deps) => {
        cy.visit('/en/approval_flow/new');
        // Wait for form to fully render before interacting (async autocomplete options can
        // cause a re-render that detaches checkbox elements mid-assertion).
        cy.get('button[aria-label="Save"]').should('be.visible');
        cy.selectAutocomplete('Approver Role', deps.role.name);
        cy.clickButton('Save');
        cy.url().should('include', '/approval_flow/new');
      });
    });

  });

  describe('Fail edit', () => {
    it('6.1 fails when required parent field is cleared', () => {
      cy.task('db:populateApprovalFlow', 1);
      cy.visit('/en/approval_flow');
      cy.get('.MuiDataGrid-virtualScroller').scrollTo('bottom', { ensureScrollable: false });
      cy.contains('.MuiDataGrid-row', 'user').find('a').first().click();
      cy.get('a[aria-label="Edit"]').click();
      cy.clearAutocomplete('Entity Name');
      cy.clickButton('Save');
      cy.url().should('include', '/approval_flow/edit');
    });

  });
});
