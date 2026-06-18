// AUTO-GENERATED - DO NOT EDIT
import { TEST_CREDENTIALS } from '../support/test-credentials';
import { assertDataGridEmpty, getDataGridRowCount, getDataGridTotalRowCount } from '../support/datagrid-helpers';

describe('Testing Scene pages and their behavior', () => {
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
      cy.visit('/en/scene');
      cy.visit('/en/scene');
      assertDataGridEmpty();
    });

    it('1.2 shows list with one item', () => {
      cy.task('db:populateScene', 1);
      cy.visit('/en/scene');
      cy.get('.MuiDataGrid-virtualScroller').scrollTo('bottom', { ensureScrollable: false });
      cy.contains('Test Label 1').scrollIntoView().should('be.visible');
      getDataGridTotalRowCount().should('eq', 1);
    });

    it('1.3 shows list with multiple items', () => {
      cy.task('db:populateScene', 3);
      cy.visit('/en/scene');
      cy.get('.MuiDataGrid-virtualScroller').scrollTo('bottom', { ensureScrollable: false });
      cy.contains('Test Label 1').scrollIntoView().should('be.visible');
      // Use aria-rowcount for the total (getDataGridRowCount counts only virtualised DOM rows)
      getDataGridTotalRowCount().should('eq', 3);
    });
  });

  describe('Create', () => {
    it('2.1 creates with minimal data (required fields only)', () => {
      cy.task<any>('db:populateSceneDependencies').then((deps) => {
        cy.visit('/en/scene');
        cy.clickButton('Create New Scene');
        cy.url().should('include', '/scene/new');
        cy.fillField('Label', 'Test Label');
        cy.selectAutocomplete('Work', deps.work.name);
        cy.fillField('Episode', 'Test Episode');
        cy.fillField('Timestamp', 'Test Timestamp');
        cy.clickButton('Save');
        cy.url().should('include', '/scene');
        cy.url().should('not.include', '/scene/');
        cy.get('.MuiDataGrid-virtualScroller').scrollTo('bottom', { ensureScrollable: false });
        cy.contains('Test Label').scrollIntoView().should('be.visible');
        // Verify on view page
        cy.contains('Test Label').click();
        cy.url().should('include', '/scene/view');
        cy.checkField('Label', 'Test Label');
        cy.checkField('Work', 'Test Title');
        cy.checkField('Episode', 'Test Episode');
        cy.checkField('Timestamp', 'Test Timestamp');
      });
    });

    it('2.2 creates with full data (all fields and children)', () => {
      cy.task<any>('db:populateSceneDependencies').then((deps) => {
        cy.task('db:populateCharacter', 2);
        cy.task('db:populateMusic', 2);
        cy.task('db:populateCreator', 2);
        cy.visit('/en/scene');
        cy.clickButton('Create New Scene');
        cy.url().should('include', '/scene/new');
        cy.fillField('Label', 'Test Label');
        cy.selectAutocomplete('Work', deps.work.name);
        cy.fillField('Episode', 'Test Episode');
        cy.fillField('Timestamp', 'Test Timestamp');
        // Add list item: Characters
        cy.clickButton('Add Characters');
        cy.get('div[role="dialog"]').find('input').type('Character 1');
        cy.get('.MuiAutocomplete-popper li').contains('Character 1').click();
        cy.get('div[role="dialog"]').find('button').contains('Add').click();
        // Add list item: Music
        cy.clickButton('Add Music');
        cy.get('div[role="dialog"]').find('input').type('Test Title 1');
        cy.get('.MuiAutocomplete-popper li').contains('Test Title 1').click();
        cy.get('div[role="dialog"]').find('button').contains('Add').click();
        // Add list item: Creators
        cy.clickButton('Add Creators');
        cy.get('div[role="dialog"]').find('input').type('Creator 1');
        cy.get('.MuiAutocomplete-popper li').contains('Creator 1').click();
        cy.get('div[role="dialog"]').find('button').contains('Add').click();
        cy.clickButton('Save');
        cy.url().should('include', '/scene');
        cy.url().should('not.include', '/scene/');
        cy.get('.MuiDataGrid-virtualScroller').scrollTo('bottom', { ensureScrollable: false });
        cy.contains('Test Label').scrollIntoView().should('be.visible');
        // Verify on view page
        cy.contains('Test Label').click();
        cy.url().should('include', '/scene/view');
        cy.checkField('Label', 'Test Label');
        cy.checkField('Work', 'Test Title');
        cy.checkField('Episode', 'Test Episode');
        cy.checkField('Timestamp', 'Test Timestamp');
      });
    });
  });

  describe('Edit', () => {
    it('3.1 adds optional data and child items', () => {
      cy.task<any>('db:populateSceneDependencies').then((deps) => {
        cy.task('db:populateScene', 1);
        cy.task('db:populateCharacter', 1);
        cy.task('db:populateMusic', 1);
        cy.task('db:populateCreator', 1);
        cy.visit('/en/scene');
        cy.get('.MuiDataGrid-virtualScroller').scrollTo('bottom', { ensureScrollable: false });
        cy.contains('Test Label 1').click();
        cy.get('a[aria-label="Edit"]').click();
        cy.url().should('include', '/scene/edit');
        cy.clickButton('Add Characters');
        cy.get('div[role="dialog"]').find('input').type('Character 1');
        cy.get('.MuiAutocomplete-popper li').contains('Character 1').click();
        cy.get('div[role="dialog"]').find('button').contains('Add').click();
        cy.clickButton('Add Music');
        cy.get('div[role="dialog"]').find('input').type('Test Title 1');
        cy.get('.MuiAutocomplete-popper li').contains('Test Title 1').click();
        cy.get('div[role="dialog"]').find('button').contains('Add').click();
        cy.clickButton('Add Creators');
        cy.get('div[role="dialog"]').find('input').type('Creator 1');
        cy.get('.MuiAutocomplete-popper li').contains('Creator 1').click();
        cy.get('div[role="dialog"]').find('button').contains('Add').click();
        cy.clickButton('Save');
        cy.url().should('include', '/scene');
        cy.url().should('not.include', '/scene/');
        cy.get('.MuiDataGrid-virtualScroller').scrollTo('bottom', { ensureScrollable: false });
        cy.contains('Test Label 1').scrollIntoView().should('be.visible');
        // Verify on view page
        cy.contains('Test Label 1').click();
        cy.url().should('include', '/scene/view');
        cy.checkField('Label', 'Test Label 1');
      });
    });

    it('3.2 removes optional data and child items', () => {
      cy.task<any[]>('db:populateScene', 1).then((records) => {
        cy.visit('/en/scene');
        cy.get('.MuiDataGrid-virtualScroller').scrollTo('bottom', { ensureScrollable: false });
        cy.contains('Test Label 1').click();
        cy.get('a[aria-label="Edit"]').click();
        cy.url().should('include', '/scene/edit');
        cy.clickButton('Save');
        cy.url().should('include', '/scene');
        cy.url().should('not.include', '/scene/');
        cy.get('.MuiDataGrid-virtualScroller').scrollTo('bottom', { ensureScrollable: false });
        cy.contains('Test Label 1').scrollIntoView().should('be.visible');
      });
    });

    it('3.3 edits with mixed changes', () => {
      cy.task<any[]>('db:populateScene', 1).then((records) => {
        cy.visit('/en/scene');
        cy.get('.MuiDataGrid-virtualScroller').scrollTo('bottom', { ensureScrollable: false });
        cy.contains('.MuiDataGrid-row', 'Test Label 1').find('a').first().click();
        cy.get('a[aria-label="Edit"]').click();
        cy.clearAndFillField('Label', 'Updated Label');
        cy.clickButton('Save');
        cy.url().should('include', '/scene');
        cy.url().should('not.include', '/scene/');
        cy.contains('Updated Label').scrollIntoView().should('be.visible');
        // Verify on view page
        cy.contains('Updated Label').click();
        cy.url().should('include', '/scene/view');
        cy.checkField('Label', 'Updated Label');
      });
    });
  });

  describe('Delete', () => {
    it('4.1 deletes a single item from list view', () => {
      cy.task('db:populateScene', 2);
      cy.visit('/en/scene');
      cy.selectDataGridRows([0]);
      cy.get('div').find('button[aria-label="Delete Selected"]').first().click();
      cy.get('div[role="dialog"]').find('button').contains('Delete').first().click();
      cy.contains('Test Label 1').should('not.exist');
      getDataGridTotalRowCount().should('eq', 1);
    });

    it('4.2 deletes multiple items from list view', () => {
      cy.task('db:populateScene', 3);
      cy.visit('/en/scene');
      cy.selectDataGridRows([0, 1]);
      cy.get('div').find('button[aria-label="Delete Selected"]').first().click();
      cy.get('div[role="dialog"]').find('button').contains('Delete').first().click();
      cy.contains('Test Label 1').should('not.exist');
      getDataGridTotalRowCount().should('eq', 1);
    });

    it('4.3 deletes an item from edit page', () => {
      cy.task('db:populateScene', 1);
      cy.visit('/en/scene');
      cy.get('.MuiDataGrid-virtualScroller').scrollTo('bottom', { ensureScrollable: false });
      cy.contains('Test Label 1').click();
      cy.get('a[aria-label="Edit"]').click();
      cy.url().should('include', '/scene/edit');
      cy.clickButton('Delete Scene');
      cy.get('div[role="dialog"]').find('button').contains('Delete').first().click();
      cy.url().should('not.include', '/edit');
      cy.url().should('include', '/scene');
      cy.url().should('not.include', '/scene/');
      cy.contains('Test Label 1').should('not.exist');
    });
  });

  describe('Fail create', () => {
    it('5.1 fails when required parent field is missing', () => {
      cy.task<any>('db:populateSceneDependencies').then((deps) => {
        cy.visit('/en/scene/new');
        // Wait for form to fully render before interacting (async autocomplete options can
        // cause a re-render that detaches checkbox elements mid-assertion).
        cy.get('button[aria-label="Save"]').should('be.visible');
        cy.selectAutocomplete('Work', deps.work.name);
        cy.fillField('Episode', 'Test Episode');
        cy.fillField('Timestamp', 'Test Timestamp');
        cy.clickButton('Save');
        cy.url().should('include', '/scene/new');
      });
    });

  });

  describe('Fail edit', () => {
    it('6.1 fails when required parent field is cleared', () => {
      cy.task('db:populateScene', 1);
      cy.visit('/en/scene');
      cy.get('.MuiDataGrid-virtualScroller').scrollTo('bottom', { ensureScrollable: false });
      cy.contains('Test Label 1').click();
      cy.get('a[aria-label="Edit"]').click();
      cy.clearField('Label');
      cy.clickButton('Save');
      cy.url().should('include', '/scene/edit');
    });

  });
});
