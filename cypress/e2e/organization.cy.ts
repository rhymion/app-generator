// AUTO-GENERATED - DO NOT EDIT
import { TEST_CREDENTIALS } from '../support/test-credentials';
import { assertDataGridEmpty, getDataGridRowCount, getDataGridTotalRowCount } from '../support/datagrid-helpers';

describe('Testing Organization pages and their behavior', () => {
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
      cy.visit('/en/organization');
      cy.visit('/en/organization');
      assertDataGridEmpty();
    });

    it('1.2 shows list with one item', () => {
      cy.task('db:populateOrganization', 1);
      cy.visit('/en/organization');
      cy.get('.MuiDataGrid-virtualScroller').scrollTo('bottom', { ensureScrollable: false });
      cy.contains('Organization 1').scrollIntoView().should('be.visible');
      getDataGridTotalRowCount().should('eq', 1);
    });

    it('1.3 shows list with multiple items', () => {
      cy.task('db:populateOrganization', 3);
      cy.visit('/en/organization');
      cy.get('.MuiDataGrid-virtualScroller').scrollTo('bottom', { ensureScrollable: false });
      cy.contains('Organization 1').scrollIntoView().should('be.visible');
      // Use aria-rowcount for the total (getDataGridRowCount counts only virtualised DOM rows)
      getDataGridTotalRowCount().should('eq', 3);
    });
  });

  describe('Create', () => {
    it('2.1 creates with minimal data (required fields only)', () => {
      cy.visit('/en/organization');
      cy.clickButton('Create New Organization');
      cy.url().should('include', '/organization/new');
      cy.fillField('Name', 'Test Organization');
      cy.clickButton('Save');
      cy.url().should('include', '/organization');
      cy.url().should('not.include', '/organization/');
      cy.get('.MuiDataGrid-virtualScroller').scrollTo('bottom', { ensureScrollable: false });
      cy.contains('Test Organization').scrollIntoView().should('be.visible');
      // Verify on view page
      cy.contains('Test Organization').click();
      cy.url().should('include', '/organization/view');
      cy.checkField('Name', 'Test Organization');
    });

    it('2.2 creates with full data (all fields and children)', () => {
      cy.task('db:populateUser', 2);
      cy.visit('/en/organization');
      cy.clickButton('Create New Organization');
      cy.url().should('include', '/organization/new');
      cy.fillField('Name', 'Test Organization');
      cy.fillField('Description', 'Test Description');
      // Add list item: Users
      cy.clickButton('Add Users');
      cy.get('div[role="dialog"]').find('input').type('User 1');
      cy.get('.MuiAutocomplete-popper li').contains('User 1').click();
      cy.get('div[role="dialog"]').find('button').contains('Add').click();
      cy.clickButton('Save');
      cy.url().should('include', '/organization');
      cy.url().should('not.include', '/organization/');
      cy.get('.MuiDataGrid-virtualScroller').scrollTo('bottom', { ensureScrollable: false });
      cy.contains('Test Organization').scrollIntoView().should('be.visible');
      // Verify on view page
      cy.contains('Test Organization').click();
      cy.url().should('include', '/organization/view');
      cy.checkField('Name', 'Test Organization');
      cy.checkField('Description', 'Test Description');
    });
  });

  describe('Edit', () => {
    it('3.1 adds optional data and child items', () => {
      cy.task<any[]>('db:populateOrganization', 1).then((records) => {
        cy.task('db:populateUser', 2);
        cy.visit('/en/organization');
        cy.get('.MuiDataGrid-virtualScroller').scrollTo('bottom', { ensureScrollable: false });
        cy.contains('Organization 1').click();
        cy.get('a[aria-label="Edit"]').click();
        cy.url().should('include', '/organization/edit');
        cy.fillField('Description', 'Test Description');
        cy.clickButton('Add Users');
        cy.get('div[role="dialog"]').find('input').type('User 1');
        cy.get('.MuiAutocomplete-popper li').contains('User 1').click();
        cy.get('div[role="dialog"]').find('button').contains('Add').click();
        cy.clickButton('Save');
        cy.url().should('include', '/organization');
        cy.url().should('not.include', '/organization/');
        cy.get('.MuiDataGrid-virtualScroller').scrollTo('bottom', { ensureScrollable: false });
        cy.contains('Organization 1').scrollIntoView().should('be.visible');
        // Verify on view page
        cy.contains('Organization 1').click();
        cy.url().should('include', '/organization/view');
        cy.checkField('Name', 'Organization 1');
      });
    });

    it('3.2 removes optional data and child items', () => {
      cy.task<any[]>('db:populateOrganizationFull', 1).then((records) => {
        cy.visit('/en/organization');
        cy.get('.MuiDataGrid-virtualScroller').scrollTo('bottom', { ensureScrollable: false });
        cy.contains('Organization 1').click();
        cy.get('a[aria-label="Edit"]').click();
        cy.url().should('include', '/organization/edit');
        cy.clearField('Description');
        cy.clickButton('Save');
        cy.url().should('include', '/organization');
        cy.url().should('not.include', '/organization/');
        cy.get('.MuiDataGrid-virtualScroller').scrollTo('bottom', { ensureScrollable: false });
        cy.contains('Organization 1').scrollIntoView().should('be.visible');
      });
    });

    it('3.3 edits with mixed changes', () => {
      cy.task<any[]>('db:populateOrganization', 1).then((records) => {
        cy.visit('/en/organization');
        cy.get('.MuiDataGrid-virtualScroller').scrollTo('bottom', { ensureScrollable: false });
        cy.contains('.MuiDataGrid-row', 'Organization 1').find('a').first().click();
        cy.get('a[aria-label="Edit"]').click();
        cy.clearAndFillField('Name', 'Updated Organization');
        cy.fillField('Description', 'Updated Description');
        cy.clickButton('Save');
        cy.url().should('include', '/organization');
        cy.url().should('not.include', '/organization/');
        cy.contains('Updated Organization').scrollIntoView().should('be.visible');
        // Verify on view page
        cy.contains('Updated Organization').click();
        cy.url().should('include', '/organization/view');
        cy.checkField('Name', 'Updated Organization');
      });
    });
  });

  describe('Delete', () => {
    it('4.1 deletes a single item from list view', () => {
      cy.task('db:populateOrganization', 2);
      cy.visit('/en/organization');
      cy.selectDataGridRows([0]);
      cy.get('div').find('button[aria-label="Delete Selected"]').first().click();
      cy.get('div[role="dialog"]').find('button').contains('Delete').first().click();
      cy.contains('Organization 1').should('not.exist');
      getDataGridTotalRowCount().should('eq', 1);
    });

    it('4.2 deletes multiple items from list view', () => {
      cy.task('db:populateOrganization', 3);
      cy.visit('/en/organization');
      cy.selectDataGridRows([0, 1]);
      cy.get('div').find('button[aria-label="Delete Selected"]').first().click();
      cy.get('div[role="dialog"]').find('button').contains('Delete').first().click();
      cy.contains('Organization 1').should('not.exist');
      getDataGridTotalRowCount().should('eq', 1);
    });

    it('4.3 deletes an item from edit page', () => {
      cy.task('db:populateOrganization', 1);
      cy.visit('/en/organization');
      cy.get('.MuiDataGrid-virtualScroller').scrollTo('bottom', { ensureScrollable: false });
      cy.contains('Organization 1').click();
      cy.get('a[aria-label="Edit"]').click();
      cy.url().should('include', '/organization/edit');
      cy.clickButton('Delete Organization');
      cy.get('div[role="dialog"]').find('button').contains('Delete').first().click();
      cy.url().should('not.include', '/edit');
      cy.url().should('include', '/organization');
      cy.url().should('not.include', '/organization/');
      cy.contains('Organization 1').should('not.exist');
    });
  });

  describe('Fail create', () => {
    it('5.1 fails when required parent field is missing', () => {
      cy.visit('/en/organization/new');
      // Wait for form to fully render before interacting (async autocomplete options can
      // cause a re-render that detaches checkbox elements mid-assertion).
      cy.get('button[aria-label="Save"]').should('be.visible');
      cy.clickButton('Save');
      cy.url().should('include', '/organization/new');
    });

  });

  describe('Fail edit', () => {
    it('6.1 fails when required parent field is cleared', () => {
      cy.task('db:populateOrganization', 1);
      cy.visit('/en/organization');
      cy.get('.MuiDataGrid-virtualScroller').scrollTo('bottom', { ensureScrollable: false });
      cy.contains('Organization 1').click();
      cy.get('a[aria-label="Edit"]').click();
      cy.clearField('Name');
      cy.clickButton('Save');
      cy.url().should('include', '/organization/edit');
    });

  });
});
