// AUTO-GENERATED - DO NOT EDIT
import { TEST_CREDENTIALS } from '../support/test-credentials';
import { assertDataGridEmpty, getDataGridRowCount, getDataGridTotalRowCount } from '../support/datagrid-helpers';

describe('Testing Character pages and their behavior', () => {
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
      cy.visit('/en/character');
      cy.visit('/en/character');
      assertDataGridEmpty();
    });

    it('1.2 shows list with one item', () => {
      cy.task('db:populateCharacter', 1);
      cy.visit('/en/character');
      cy.get('.MuiDataGrid-virtualScroller').scrollTo('bottom', { ensureScrollable: false });
      cy.contains('Character 1').scrollIntoView().should('be.visible');
      getDataGridTotalRowCount().should('eq', 1);
    });

    it('1.3 shows list with multiple items', () => {
      cy.task('db:populateCharacter', 3);
      cy.visit('/en/character');
      cy.get('.MuiDataGrid-virtualScroller').scrollTo('bottom', { ensureScrollable: false });
      cy.contains('Character 1').scrollIntoView().should('be.visible');
      // Use aria-rowcount for the total (getDataGridRowCount counts only virtualised DOM rows)
      getDataGridTotalRowCount().should('eq', 3);
    });
  });

  describe('Create', () => {
    it('2.1 creates with minimal data (required fields only)', () => {
      cy.task<any>('db:populateCharacterDependencies').then((deps) => {
        cy.visit('/en/character');
        cy.clickButton('Create New Character');
        cy.url().should('include', '/character/new');
        cy.fillField('Name', 'Test Character');
        cy.selectAutocomplete('Work', deps.work.name);
        cy.setCheckbox('Official Image', true);
        cy.clickButton('Save');
        cy.url().should('include', '/character');
        cy.url().should('not.include', '/character/');
        cy.get('.MuiDataGrid-virtualScroller').scrollTo('bottom', { ensureScrollable: false });
        cy.contains('Test Character').scrollIntoView().should('be.visible');
        // Verify on view page
        cy.contains('Test Character').click();
        cy.url().should('include', '/character/view');
        cy.checkField('Name', 'Test Character');
        cy.checkField('Work', 'Test Title');
      });
    });

    it('2.2 creates with full data (all fields and children)', () => {
      cy.task<any>('db:populateCharacterDependencies').then((deps) => {
        cy.task('db:populateScene', 2);
        cy.task('db:populateCreator', 2);
        cy.visit('/en/character');
        cy.clickButton('Create New Character');
        cy.url().should('include', '/character/new');
        cy.fillField('Name', 'Test Character');
        cy.selectAutocomplete('Work', deps.work.name);
        cy.setCheckbox('Official Image', true);
        // Add list item: Scenes
        cy.clickButton('Add Scenes');
        cy.get('div[role="dialog"]').find('input').type('Test Label 1');
        cy.get('.MuiAutocomplete-popper li').contains('Test Label 1').click();
        cy.get('div[role="dialog"]').find('button').contains('Add').click();
        // Add list item: Creators
        cy.clickButton('Add Creators');
        cy.get('div[role="dialog"]').find('input').type('Creator 1');
        cy.get('.MuiAutocomplete-popper li').contains('Creator 1').click();
        cy.get('div[role="dialog"]').find('button').contains('Add').click();
        cy.clickButton('Save');
        cy.url().should('include', '/character');
        cy.url().should('not.include', '/character/');
        cy.get('.MuiDataGrid-virtualScroller').scrollTo('bottom', { ensureScrollable: false });
        cy.contains('Test Character').scrollIntoView().should('be.visible');
        // Verify on view page
        cy.contains('Test Character').click();
        cy.url().should('include', '/character/view');
        cy.checkField('Name', 'Test Character');
        cy.checkField('Work', 'Test Title');
      });
    });
  });

  describe('Edit', () => {
    it('3.1 adds optional data and child items', () => {
      cy.task<any>('db:populateCharacterDependencies').then((deps) => {
        cy.task('db:populateCharacter', 1);
        cy.task('db:populateScene', 1);
        cy.task('db:populateCreator', 1);
        cy.visit('/en/character');
        cy.get('.MuiDataGrid-virtualScroller').scrollTo('bottom', { ensureScrollable: false });
        cy.contains('Character 1').click();
        cy.get('a[aria-label="Edit"]').click();
        cy.url().should('include', '/character/edit');
        cy.clickButton('Add Scenes');
        cy.get('div[role="dialog"]').find('input').type('Test Label 1');
        cy.get('.MuiAutocomplete-popper li').contains('Test Label 1').click();
        cy.get('div[role="dialog"]').find('button').contains('Add').click();
        cy.clickButton('Add Creators');
        cy.get('div[role="dialog"]').find('input').type('Creator 1');
        cy.get('.MuiAutocomplete-popper li').contains('Creator 1').click();
        cy.get('div[role="dialog"]').find('button').contains('Add').click();
        cy.clickButton('Save');
        cy.url().should('include', '/character');
        cy.url().should('not.include', '/character/');
        cy.get('.MuiDataGrid-virtualScroller').scrollTo('bottom', { ensureScrollable: false });
        cy.contains('Character 1').scrollIntoView().should('be.visible');
        // Verify on view page
        cy.contains('Character 1').click();
        cy.url().should('include', '/character/view');
        cy.checkField('Name', 'Character 1');
      });
    });

    it('3.2 removes optional data and child items', () => {
      cy.task<any[]>('db:populateCharacter', 1).then((records) => {
        cy.visit('/en/character');
        cy.get('.MuiDataGrid-virtualScroller').scrollTo('bottom', { ensureScrollable: false });
        cy.contains('Character 1').click();
        cy.get('a[aria-label="Edit"]').click();
        cy.url().should('include', '/character/edit');
        cy.clickButton('Save');
        cy.url().should('include', '/character');
        cy.url().should('not.include', '/character/');
        cy.get('.MuiDataGrid-virtualScroller').scrollTo('bottom', { ensureScrollable: false });
        cy.contains('Character 1').scrollIntoView().should('be.visible');
      });
    });

    it('3.3 edits with mixed changes', () => {
      cy.task<any[]>('db:populateCharacter', 1).then((records) => {
        cy.visit('/en/character');
        cy.get('.MuiDataGrid-virtualScroller').scrollTo('bottom', { ensureScrollable: false });
        cy.contains('.MuiDataGrid-row', 'Character 1').find('a').first().click();
        cy.get('a[aria-label="Edit"]').click();
        cy.clearAndFillField('Name', 'Updated Character');
        cy.clickButton('Save');
        cy.url().should('include', '/character');
        cy.url().should('not.include', '/character/');
        cy.contains('Updated Character').scrollIntoView().should('be.visible');
        // Verify on view page
        cy.contains('Updated Character').click();
        cy.url().should('include', '/character/view');
        cy.checkField('Name', 'Updated Character');
      });
    });
  });

  describe('Delete', () => {
    it('4.1 deletes a single item from list view', () => {
      cy.task('db:populateCharacter', 2);
      cy.visit('/en/character');
      cy.selectDataGridRows([0]);
      cy.get('div').find('button[aria-label="Delete Selected"]').first().click();
      cy.get('div[role="dialog"]').find('button').contains('Delete').first().click();
      cy.contains('Character 1').should('not.exist');
      getDataGridTotalRowCount().should('eq', 1);
    });

    it('4.2 deletes multiple items from list view', () => {
      cy.task('db:populateCharacter', 3);
      cy.visit('/en/character');
      cy.selectDataGridRows([0, 1]);
      cy.get('div').find('button[aria-label="Delete Selected"]').first().click();
      cy.get('div[role="dialog"]').find('button').contains('Delete').first().click();
      cy.contains('Character 1').should('not.exist');
      getDataGridTotalRowCount().should('eq', 1);
    });

    it('4.3 deletes an item from edit page', () => {
      cy.task('db:populateCharacter', 1);
      cy.visit('/en/character');
      cy.get('.MuiDataGrid-virtualScroller').scrollTo('bottom', { ensureScrollable: false });
      cy.contains('Character 1').click();
      cy.get('a[aria-label="Edit"]').click();
      cy.url().should('include', '/character/edit');
      cy.clickButton('Delete Character');
      cy.get('div[role="dialog"]').find('button').contains('Delete').first().click();
      cy.url().should('not.include', '/edit');
      cy.url().should('include', '/character');
      cy.url().should('not.include', '/character/');
      cy.contains('Character 1').should('not.exist');
    });
  });

  describe('Fail create', () => {
    it('5.1 fails when required parent field is missing', () => {
      cy.task<any>('db:populateCharacterDependencies').then((deps) => {
        cy.visit('/en/character/new');
        // Wait for form to fully render before interacting (async autocomplete options can
        // cause a re-render that detaches checkbox elements mid-assertion).
        cy.get('button[aria-label="Save"]').should('be.visible');
        cy.selectAutocomplete('Work', deps.work.name);
        cy.setCheckbox('Official Image', true);
        cy.clickButton('Save');
        cy.url().should('include', '/character/new');
      });
    });

  });

  describe('Fail edit', () => {
    it('6.1 fails when required parent field is cleared', () => {
      cy.task('db:populateCharacter', 1);
      cy.visit('/en/character');
      cy.get('.MuiDataGrid-virtualScroller').scrollTo('bottom', { ensureScrollable: false });
      cy.contains('Character 1').click();
      cy.get('a[aria-label="Edit"]').click();
      cy.clearField('Name');
      cy.clickButton('Save');
      cy.url().should('include', '/character/edit');
    });

  });
});
