// AUTO-GENERATED - DO NOT EDIT
import { TEST_CREDENTIALS } from '../support/test-credentials';
import { assertDataGridEmpty, getDataGridRowCount } from '../support/datagrid-helpers';

describe('Testing Booking pages and their behavior', () => {
  beforeEach(() => {
    cy.task('db:reset');
    cy.task('db:seed');
    Cypress.session.clearAllSavedSessions();
    cy.clearCookies();
    cy.clearLocalStorage();
    cy.visit('/en/');
    cy.window().then((win) => { win.sessionStorage.clear(); });
    cy.login(TEST_CREDENTIALS.email, TEST_CREDENTIALS.password);
  });

  describe('Display list', () => {
    it('1.1 shows empty state with no items', () => {
      cy.visit('/en/booking');
      assertDataGridEmpty();
    });

    it('1.2 shows list with one item', () => {
      cy.task('db:populateBooking', 1);
      cy.visit('/en/booking');
      cy.contains('Booking 1').should('be.visible');
      getDataGridRowCount().should('eq', 1);
    });

    it('1.3 shows list with multiple items', () => {
      cy.task('db:populateBooking', 3);
      cy.visit('/en/booking');
      cy.contains('Booking 1').should('be.visible');
      getDataGridRowCount().should('eq', 3);
    });
  });

  describe('Create', () => {
    it('2.1 creates with minimal data (required fields only)', () => {
      cy.task<any>('db:populateBookingDependencies').then((deps) => {
        cy.visit('/en/booking');
        cy.clickButton('Create New Booking');
        cy.fillField('Name', 'Test Booking');
        cy.selectAutocomplete('Resource', deps.resource.name);
        cy.fillDateTime('Start Time', '01/15/2025 09:00 AM');
        cy.fillDateTime('End Time', '01/15/2025 05:00 PM');
        cy.clickButton('Save');
        cy.url().should('include', '/booking');
        cy.contains('Test Booking').should('be.visible');
        // Verify on view page
        cy.contains('Test Booking').click();
        cy.url().should('include', '/booking/view');
        cy.checkField('Name', 'Test Booking');
        cy.checkField('Resource', 'Test Resource');
        cy.checkField('Start Time', '01/15/2025 09:00 AM');
        cy.checkField('End Time', '01/15/2025 05:00 PM');
      });
    });

    it('2.2 creates with full data (all fields and children)', () => {
      cy.task<any>('db:populateBookingDependencies').then((deps) => {
        cy.visit('/en/booking');
        cy.clickButton('Create New Booking');
        cy.fillField('Name', 'Test Booking');
        cy.selectAutocomplete('Resource', deps.resource.name);
        cy.fillDateTime('Start Time', '01/15/2025 09:00 AM');
        cy.fillDateTime('End Time', '01/15/2025 05:00 PM');
        cy.clickButton('Save');
        cy.url().should('include', '/booking');
        cy.contains('Test Booking').should('be.visible');
        // Verify on view page
        cy.contains('Test Booking').click();
        cy.url().should('include', '/booking/view');
        cy.checkField('Name', 'Test Booking');
        cy.checkField('Resource', 'Test Resource');
        cy.checkField('Start Time', '01/15/2025 09:00 AM');
        cy.checkField('End Time', '01/15/2025 05:00 PM');
      });
    });
  });

  describe('Edit', () => {
    it('3.3 edits with mixed changes', () => {
      cy.task<any[]>('db:populateBooking', 1).then((records) => {
        cy.visit('/en/booking');
        cy.contains('Booking 1').click();
        cy.contains('Edit').click();
        cy.clearAndFillField('Name', 'Updated Booking');
        cy.clickButton('Save');
        cy.url().should('include', '/booking');
        cy.contains('Updated Booking').should('be.visible');
        // Verify on view page
        cy.contains('Updated Booking').click();
        cy.url().should('include', '/booking/view');
        cy.checkField('Name', 'Updated Booking');
      });
    });
  });

  describe('Delete', () => {
    it('4.1 deletes a single item from list view', () => {
      cy.task('db:populateBooking', 2);
      cy.visit('/en/booking');
      cy.selectDataGridRows([0]);
      cy.clickButton('Delete Selected');
      cy.get('div[role="dialog"]').find('button').contains('Delete').click();
      getDataGridRowCount().should('eq', 1);
    });

    it('4.2 deletes multiple items from list view', () => {
      cy.task('db:populateBooking', 3);
      cy.visit('/en/booking');
      cy.selectDataGridRows([0, 1]);
      cy.clickButton('Delete Selected');
      cy.get('div[role="dialog"]').find('button').contains('Delete').click();
      getDataGridRowCount().should('eq', 1);
    });

    it('4.3 deletes an item from edit page', () => {
      cy.task('db:populateBooking', 1);
      cy.visit('/en/booking');
      cy.contains('Booking 1').click();
      cy.contains('Edit').click();
      cy.url().should('include', '/booking/edit');
      cy.clickButton('Delete Booking');
      cy.get('div[role="dialog"]').find('button').contains('Delete').click();
      cy.url().should('include', '/booking');
      cy.contains('Booking 1').should('not.exist');
    });
  });

  describe('Fail create', () => {
    it('5.1 fails when required parent field is missing', () => {
      cy.task<any>('db:populateBookingDependencies').then((deps) => {
        cy.visit('/en/booking/new');
        cy.selectAutocomplete('Resource', deps.resource.name);
        cy.fillDateTime('Start Time', '01/15/2025 09:00 AM');
        cy.fillDateTime('End Time', '01/15/2025 05:00 PM');
        cy.clickButton('Save');
        cy.url().should('include', '/booking/new');
      });
    });

  });

  describe('Fail edit', () => {
    it('6.1 fails when required parent field is cleared', () => {
      cy.task('db:populateBooking', 1);
      cy.visit('/en/booking');
      cy.contains('Booking 1').click();
      cy.contains('Edit').click();
      cy.clearField('Name');
      cy.clickButton('Save');
      cy.url().should('include', '/booking/edit');
    });

  });
});
