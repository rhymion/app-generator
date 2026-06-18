// AUTO-GENERATED - DO NOT EDIT
import { TEST_CREDENTIALS } from '../support/test-credentials';
import { assertDataGridEmpty, getDataGridRowCount, getDataGridTotalRowCount } from '../support/datagrid-helpers';

describe('Testing Creator pages and their behavior', () => {
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
      cy.visit('/en/creator');
      cy.visit('/en/creator');
      assertDataGridEmpty();
    });

    it('1.2 shows list with one item', () => {
      cy.task('db:populateCreator', 1);
      cy.visit('/en/creator');
      cy.get('.MuiDataGrid-virtualScroller').scrollTo('bottom', { ensureScrollable: false });
      cy.contains('Creator 1').scrollIntoView().should('be.visible');
      getDataGridTotalRowCount().should('eq', 1);
    });

    it('1.3 shows list with multiple items', () => {
      cy.task('db:populateCreator', 3);
      cy.visit('/en/creator');
      cy.get('.MuiDataGrid-virtualScroller').scrollTo('bottom', { ensureScrollable: false });
      cy.contains('Creator 1').scrollIntoView().should('be.visible');
      // Use aria-rowcount for the total (getDataGridRowCount counts only virtualised DOM rows)
      getDataGridTotalRowCount().should('eq', 3);
    });
  });

  describe('Create', () => {
    it('2.1 creates with minimal data (required fields only)', () => {
      cy.visit('/en/creator');
      cy.clickButton('Create New Creator');
      cy.url().should('include', '/creator/new');
      cy.fillField('Name', 'Test Creator');
      cy.selectAutocomplete('Role', 'Voice');
      cy.selectAutocomplete('Affiliation', 'Agency');
      cy.clickButton('Save');
      cy.url().should('include', '/creator');
      cy.url().should('not.include', '/creator/');
      cy.get('.MuiDataGrid-virtualScroller').scrollTo('bottom', { ensureScrollable: false });
      cy.contains('Test Creator').scrollIntoView().should('be.visible');
      // Verify on view page
      cy.contains('Test Creator').click();
      cy.url().should('include', '/creator/view');
      cy.checkField('Name', 'Test Creator');
      cy.checkField('Role', 'Voice');
      cy.checkField('Affiliation', 'Agency');
    });

    it('2.2 creates with full data (all fields and children)', () => {
      cy.task('db:populateCharacter', 2);
      cy.task('db:populateMusic', 2);
      cy.task('db:populateMusic', 2);
      cy.task('db:populateScene', 2);
      cy.visit('/en/creator');
      cy.clickButton('Create New Creator');
      cy.url().should('include', '/creator/new');
      cy.fillField('Name', 'Test Creator');
      cy.selectAutocomplete('Role', 'Voice');
      cy.selectAutocomplete('Affiliation', 'Agency');
      // Add list item: Voiced Characters
      cy.clickButton('Add Voiced Characters');
      cy.get('div[role="dialog"]').find('input').type('Character 1');
      cy.get('.MuiAutocomplete-popper li').contains('Character 1').click();
      cy.get('div[role="dialog"]').find('button').contains('Add').click();
      // Add list item: Composed Musics
      cy.clickButton('Add Composed Musics');
      cy.get('div[role="dialog"]').find('input').type('Test Title 1');
      cy.get('.MuiAutocomplete-popper li').contains('Test Title 1').click();
      cy.get('div[role="dialog"]').find('button').contains('Add').click();
      // Add list item: Credited Musics
      cy.clickButton('Add Credited Musics');
      cy.get('div[role="dialog"]').find('input').type('Test Title 1');
      cy.get('.MuiAutocomplete-popper li').contains('Test Title 1').click();
      cy.get('div[role="dialog"]').find('button').contains('Add').click();
      // Add list item: Credited Scenes
      cy.clickButton('Add Credited Scenes');
      cy.get('div[role="dialog"]').find('input').type('Test Label 1');
      cy.get('.MuiAutocomplete-popper li').contains('Test Label 1').click();
      cy.get('div[role="dialog"]').find('button').contains('Add').click();
      cy.clickButton('Save');
      cy.url().should('include', '/creator');
      cy.url().should('not.include', '/creator/');
      cy.get('.MuiDataGrid-virtualScroller').scrollTo('bottom', { ensureScrollable: false });
      cy.contains('Test Creator').scrollIntoView().should('be.visible');
      // Verify on view page
      cy.contains('Test Creator').click();
      cy.url().should('include', '/creator/view');
      cy.checkField('Name', 'Test Creator');
      cy.checkField('Role', 'Voice');
      cy.checkField('Affiliation', 'Agency');
    });
  });

  describe('Edit', () => {
    it('3.1 adds optional data and child items', () => {
      cy.task<any[]>('db:populateCreator', 1).then((records) => {
        cy.task('db:populateCharacter', 2);
        cy.task('db:populateMusic', 2);
        cy.task('db:populateMusic', 2);
        cy.task('db:populateScene', 2);
        cy.visit('/en/creator');
        cy.get('.MuiDataGrid-virtualScroller').scrollTo('bottom', { ensureScrollable: false });
        cy.contains('Creator 1').click();
        cy.get('a[aria-label="Edit"]').click();
        cy.url().should('include', '/creator/edit');
        cy.clickButton('Add Voiced Characters');
        cy.get('div[role="dialog"]').find('input').type('Character 1');
        cy.get('.MuiAutocomplete-popper li').contains('Character 1').click();
        cy.get('div[role="dialog"]').find('button').contains('Add').click();
        cy.clickButton('Add Composed Musics');
        cy.get('div[role="dialog"]').find('input').type('Test Title 1');
        cy.get('.MuiAutocomplete-popper li').contains('Test Title 1').click();
        cy.get('div[role="dialog"]').find('button').contains('Add').click();
        cy.clickButton('Add Credited Musics');
        cy.get('div[role="dialog"]').find('input').type('Test Title 1');
        cy.get('.MuiAutocomplete-popper li').contains('Test Title 1').click();
        cy.get('div[role="dialog"]').find('button').contains('Add').click();
        cy.clickButton('Add Credited Scenes');
        cy.get('div[role="dialog"]').find('input').type('Test Label 1');
        cy.get('.MuiAutocomplete-popper li').contains('Test Label 1').click();
        cy.get('div[role="dialog"]').find('button').contains('Add').click();
        cy.clickButton('Save');
        cy.url().should('include', '/creator');
        cy.url().should('not.include', '/creator/');
        cy.get('.MuiDataGrid-virtualScroller').scrollTo('bottom', { ensureScrollable: false });
        cy.contains('Creator 1').scrollIntoView().should('be.visible');
        // Verify on view page
        cy.contains('Creator 1').click();
        cy.url().should('include', '/creator/view');
        cy.checkField('Name', 'Creator 1');
      });
    });

    it('3.2 removes optional data and child items', () => {
      cy.task<any[]>('db:populateCreator', 1).then((records) => {
        cy.visit('/en/creator');
        cy.get('.MuiDataGrid-virtualScroller').scrollTo('bottom', { ensureScrollable: false });
        cy.contains('Creator 1').click();
        cy.get('a[aria-label="Edit"]').click();
        cy.url().should('include', '/creator/edit');
        cy.clickButton('Save');
        cy.url().should('include', '/creator');
        cy.url().should('not.include', '/creator/');
        cy.get('.MuiDataGrid-virtualScroller').scrollTo('bottom', { ensureScrollable: false });
        cy.contains('Creator 1').scrollIntoView().should('be.visible');
      });
    });

    it('3.3 edits with mixed changes', () => {
      cy.task<any[]>('db:populateCreator', 1).then((records) => {
        cy.visit('/en/creator');
        cy.get('.MuiDataGrid-virtualScroller').scrollTo('bottom', { ensureScrollable: false });
        cy.contains('.MuiDataGrid-row', 'Creator 1').find('a').first().click();
        cy.get('a[aria-label="Edit"]').click();
        cy.clearAndFillField('Name', 'Updated Creator');
        cy.clickButton('Save');
        cy.url().should('include', '/creator');
        cy.url().should('not.include', '/creator/');
        cy.contains('Updated Creator').scrollIntoView().should('be.visible');
        // Verify on view page
        cy.contains('Updated Creator').click();
        cy.url().should('include', '/creator/view');
        cy.checkField('Name', 'Updated Creator');
      });
    });
  });

  describe('Delete', () => {
    it('4.1 deletes a single item from list view', () => {
      cy.task('db:populateCreator', 2);
      cy.visit('/en/creator');
      cy.selectDataGridRows([0]);
      cy.get('div').find('button[aria-label="Delete Selected"]').first().click();
      cy.get('div[role="dialog"]').find('button').contains('Delete').first().click();
      cy.contains('Creator 1').should('not.exist');
      getDataGridTotalRowCount().should('eq', 1);
    });

    it('4.2 deletes multiple items from list view', () => {
      cy.task('db:populateCreator', 3);
      cy.visit('/en/creator');
      cy.selectDataGridRows([0, 1]);
      cy.get('div').find('button[aria-label="Delete Selected"]').first().click();
      cy.get('div[role="dialog"]').find('button').contains('Delete').first().click();
      cy.contains('Creator 1').should('not.exist');
      getDataGridTotalRowCount().should('eq', 1);
    });

    it('4.3 deletes an item from edit page', () => {
      cy.task('db:populateCreator', 1);
      cy.visit('/en/creator');
      cy.get('.MuiDataGrid-virtualScroller').scrollTo('bottom', { ensureScrollable: false });
      cy.contains('Creator 1').click();
      cy.get('a[aria-label="Edit"]').click();
      cy.url().should('include', '/creator/edit');
      cy.clickButton('Delete Creator');
      cy.get('div[role="dialog"]').find('button').contains('Delete').first().click();
      cy.url().should('not.include', '/edit');
      cy.url().should('include', '/creator');
      cy.url().should('not.include', '/creator/');
      cy.contains('Creator 1').should('not.exist');
    });
  });

  describe('Fail create', () => {
    it('5.1 fails when required parent field is missing', () => {
      cy.visit('/en/creator/new');
      // Wait for form to fully render before interacting (async autocomplete options can
      // cause a re-render that detaches checkbox elements mid-assertion).
      cy.get('button[aria-label="Save"]').should('be.visible');
      cy.selectAutocomplete('Role', 'Voice');
      cy.selectAutocomplete('Affiliation', 'Agency');
      cy.clickButton('Save');
      cy.url().should('include', '/creator/new');
    });

  });

  describe('Fail edit', () => {
    it('6.1 fails when required parent field is cleared', () => {
      cy.task('db:populateCreator', 1);
      cy.visit('/en/creator');
      cy.get('.MuiDataGrid-virtualScroller').scrollTo('bottom', { ensureScrollable: false });
      cy.contains('Creator 1').click();
      cy.get('a[aria-label="Edit"]').click();
      cy.clearField('Name');
      cy.clickButton('Save');
      cy.url().should('include', '/creator/edit');
    });

  });
});
