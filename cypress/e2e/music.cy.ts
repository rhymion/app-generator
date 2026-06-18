// AUTO-GENERATED - DO NOT EDIT
import { TEST_CREDENTIALS } from '../support/test-credentials';
import { assertDataGridEmpty, getDataGridRowCount, getDataGridTotalRowCount } from '../support/datagrid-helpers';

describe('Testing Music pages and their behavior', () => {
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
      cy.visit('/en/music');
      cy.visit('/en/music');
      assertDataGridEmpty();
    });

    it('1.2 shows list with one item', () => {
      cy.task('db:populateMusic', 1);
      cy.visit('/en/music');
      cy.get('.MuiDataGrid-virtualScroller').scrollTo('bottom', { ensureScrollable: false });
      cy.contains('Test Title 1').scrollIntoView().should('be.visible');
      getDataGridTotalRowCount().should('eq', 1);
    });

    it('1.3 shows list with multiple items', () => {
      cy.task('db:populateMusic', 3);
      cy.visit('/en/music');
      cy.get('.MuiDataGrid-virtualScroller').scrollTo('bottom', { ensureScrollable: false });
      cy.contains('Test Title 1').scrollIntoView().should('be.visible');
      // Use aria-rowcount for the total (getDataGridRowCount counts only virtualised DOM rows)
      getDataGridTotalRowCount().should('eq', 3);
    });
  });

  describe('Create', () => {
    it('2.1 creates with minimal data (required fields only)', () => {
      cy.visit('/en/music');
      cy.clickButton('Create New Music');
      cy.url().should('include', '/music/new');
      cy.fillField('Title', 'Test Title');
      cy.selectAutocomplete('Kind', 'OP');
      cy.clickButton('Save');
      cy.url().should('include', '/music');
      cy.url().should('not.include', '/music/');
      cy.get('.MuiDataGrid-virtualScroller').scrollTo('bottom', { ensureScrollable: false });
      cy.contains('Test Title').scrollIntoView().should('be.visible');
      // Verify on view page
      cy.contains('Test Title').click();
      cy.url().should('include', '/music/view');
      cy.checkField('Title', 'Test Title');
      cy.checkField('Kind', 'OP');
    });

    it('2.2 creates with full data (all fields and children)', () => {
      cy.task('db:populateScene', 2);
      cy.task('db:populateCreator', 2);
      cy.task('db:populateCreator', 2);
      cy.visit('/en/music');
      cy.clickButton('Create New Music');
      cy.url().should('include', '/music/new');
      cy.fillField('Title', 'Test Title');
      cy.selectAutocomplete('Kind', 'OP');
      // Add list item: Scenes
      cy.clickButton('Add Scenes');
      cy.get('div[role="dialog"]').find('input').type('Test Label 1');
      cy.get('.MuiAutocomplete-popper li').contains('Test Label 1').click();
      cy.get('div[role="dialog"]').find('button').contains('Add').click();
      // Add list item: Composers
      cy.clickButton('Add Composers');
      cy.get('div[role="dialog"]').find('input').type('Creator 1');
      cy.get('.MuiAutocomplete-popper li').contains('Creator 1').click();
      cy.get('div[role="dialog"]').find('button').contains('Add').click();
      // Add list item: Credits
      cy.clickButton('Add Credits');
      cy.get('div[role="dialog"]').find('input').type('Creator 1');
      cy.get('.MuiAutocomplete-popper li').contains('Creator 1').click();
      cy.get('div[role="dialog"]').find('button').contains('Add').click();
      cy.clickButton('Save');
      cy.url().should('include', '/music');
      cy.url().should('not.include', '/music/');
      cy.get('.MuiDataGrid-virtualScroller').scrollTo('bottom', { ensureScrollable: false });
      cy.contains('Test Title').scrollIntoView().should('be.visible');
      // Verify on view page
      cy.contains('Test Title').click();
      cy.url().should('include', '/music/view');
      cy.checkField('Title', 'Test Title');
      cy.checkField('Kind', 'OP');
    });
  });

  describe('Edit', () => {
    it('3.1 adds optional data and child items', () => {
      cy.task<any[]>('db:populateMusic', 1).then((records) => {
        cy.task('db:populateScene', 2);
        cy.task('db:populateCreator', 2);
        cy.task('db:populateCreator', 2);
        cy.visit('/en/music');
        cy.get('.MuiDataGrid-virtualScroller').scrollTo('bottom', { ensureScrollable: false });
        cy.contains('Test Title 1').click();
        cy.get('a[aria-label="Edit"]').click();
        cy.url().should('include', '/music/edit');
        cy.clickButton('Add Scenes');
        cy.get('div[role="dialog"]').find('input').type('Test Label 1');
        cy.get('.MuiAutocomplete-popper li').contains('Test Label 1').click();
        cy.get('div[role="dialog"]').find('button').contains('Add').click();
        cy.clickButton('Add Composers');
        cy.get('div[role="dialog"]').find('input').type('Creator 1');
        cy.get('.MuiAutocomplete-popper li').contains('Creator 1').click();
        cy.get('div[role="dialog"]').find('button').contains('Add').click();
        cy.clickButton('Add Credits');
        cy.get('div[role="dialog"]').find('input').type('Creator 1');
        cy.get('.MuiAutocomplete-popper li').contains('Creator 1').click();
        cy.get('div[role="dialog"]').find('button').contains('Add').click();
        cy.clickButton('Save');
        cy.url().should('include', '/music');
        cy.url().should('not.include', '/music/');
        cy.get('.MuiDataGrid-virtualScroller').scrollTo('bottom', { ensureScrollable: false });
        cy.contains('Test Title 1').scrollIntoView().should('be.visible');
        // Verify on view page
        cy.contains('Test Title 1').click();
        cy.url().should('include', '/music/view');
        cy.checkField('Title', 'Test Title 1');
      });
    });

    it('3.2 removes optional data and child items', () => {
      cy.task<any[]>('db:populateMusic', 1).then((records) => {
        cy.visit('/en/music');
        cy.get('.MuiDataGrid-virtualScroller').scrollTo('bottom', { ensureScrollable: false });
        cy.contains('Test Title 1').click();
        cy.get('a[aria-label="Edit"]').click();
        cy.url().should('include', '/music/edit');
        cy.clickButton('Save');
        cy.url().should('include', '/music');
        cy.url().should('not.include', '/music/');
        cy.get('.MuiDataGrid-virtualScroller').scrollTo('bottom', { ensureScrollable: false });
        cy.contains('Test Title 1').scrollIntoView().should('be.visible');
      });
    });

    it('3.3 edits with mixed changes', () => {
      cy.task<any[]>('db:populateMusic', 1).then((records) => {
        cy.visit('/en/music');
        cy.get('.MuiDataGrid-virtualScroller').scrollTo('bottom', { ensureScrollable: false });
        cy.contains('.MuiDataGrid-row', 'Test Title 1').find('a').first().click();
        cy.get('a[aria-label="Edit"]').click();
        cy.clearAndFillField('Title', 'Updated Title');
        cy.clickButton('Save');
        cy.url().should('include', '/music');
        cy.url().should('not.include', '/music/');
        cy.contains('Updated Title').scrollIntoView().should('be.visible');
        // Verify on view page
        cy.contains('Updated Title').click();
        cy.url().should('include', '/music/view');
        cy.checkField('Title', 'Updated Title');
      });
    });
  });

  describe('Delete', () => {
    it('4.1 deletes a single item from list view', () => {
      cy.task('db:populateMusic', 2);
      cy.visit('/en/music');
      cy.selectDataGridRows([0]);
      cy.get('div').find('button[aria-label="Delete Selected"]').first().click();
      cy.get('div[role="dialog"]').find('button').contains('Delete').first().click();
      cy.contains('Test Title 1').should('not.exist');
      getDataGridTotalRowCount().should('eq', 1);
    });

    it('4.2 deletes multiple items from list view', () => {
      cy.task('db:populateMusic', 3);
      cy.visit('/en/music');
      cy.selectDataGridRows([0, 1]);
      cy.get('div').find('button[aria-label="Delete Selected"]').first().click();
      cy.get('div[role="dialog"]').find('button').contains('Delete').first().click();
      cy.contains('Test Title 1').should('not.exist');
      getDataGridTotalRowCount().should('eq', 1);
    });

    it('4.3 deletes an item from edit page', () => {
      cy.task('db:populateMusic', 1);
      cy.visit('/en/music');
      cy.get('.MuiDataGrid-virtualScroller').scrollTo('bottom', { ensureScrollable: false });
      cy.contains('Test Title 1').click();
      cy.get('a[aria-label="Edit"]').click();
      cy.url().should('include', '/music/edit');
      cy.clickButton('Delete Music');
      cy.get('div[role="dialog"]').find('button').contains('Delete').first().click();
      cy.url().should('not.include', '/edit');
      cy.url().should('include', '/music');
      cy.url().should('not.include', '/music/');
      cy.contains('Test Title 1').should('not.exist');
    });
  });

  describe('Fail create', () => {
    it('5.1 fails when required parent field is missing', () => {
      cy.visit('/en/music/new');
      // Wait for form to fully render before interacting (async autocomplete options can
      // cause a re-render that detaches checkbox elements mid-assertion).
      cy.get('button[aria-label="Save"]').should('be.visible');
      cy.selectAutocomplete('Kind', 'OP');
      cy.clickButton('Save');
      cy.url().should('include', '/music/new');
    });

  });

  describe('Fail edit', () => {
    it('6.1 fails when required parent field is cleared', () => {
      cy.task('db:populateMusic', 1);
      cy.visit('/en/music');
      cy.get('.MuiDataGrid-virtualScroller').scrollTo('bottom', { ensureScrollable: false });
      cy.contains('Test Title 1').click();
      cy.get('a[aria-label="Edit"]').click();
      cy.clearField('Title');
      cy.clickButton('Save');
      cy.url().should('include', '/music/edit');
    });

  });
});
