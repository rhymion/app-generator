import { TEST_CREDENTIALS } from '../support/test-credentials';

// "Save and continue editing" (issue #832), driven through the default schema's
// `organization` entity: it has create and update, a required name, an optional
// description and a list child (Users), so the button is generated for it.
//
// Covered here: create then continue lands on /edit/[id] with the saved values; continue
// on an existing record stays on it and persists the change without duplicating the
// list child; the plain Save still goes back to the list; a user without update
// permission gets no continue button on /new. The generated organization spec covers
// the plain Save flows. Entities with no update path, x-payment entities and
// approval-lockable entities get no button; that is shown at generation level in
// code_generator/tests/test_save_and_continue_editing.py.
const CONTINUE = 'Save and continue editing';
describe('Save and continue editing (issue #832)', () => {
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

  it('creates a record and continues on /edit/[id] with the saved values', () => {
    cy.task('db:populateUser', 2);
    cy.visit('/en/organization/new');
    cy.fillField('Name', 'Continue Organization');
    cy.clickButton('Add Users');
    cy.get('div[role="dialog"]').find('input').type('User 1');
    cy.get('.MuiAutocomplete-popper li').contains('User 1').click();
    cy.get('div[role="dialog"]').find('button').contains('Add').click();
    cy.clickButton(CONTINUE);
    cy.url().should('match', /\/organization\/edit\/[a-z0-9]+$/);
    cy.checkField('Name', 'Continue Organization');
    cy.contains('User 1').should('be.visible');
    // The list child was saved once and survives a reload.
    cy.reload();
    cy.checkField('Name', 'Continue Organization');
    cy.contains('User 1').should('be.visible');
  });

  it('continues on an existing record: stays on the edit screen and persists the change', () => {
    cy.task<any[]>('db:populateOrganization', 1).then((records) => {
      cy.visit(`/en/organization/edit/${records[0].id}`);
      cy.fillField('Description', 'First description');
      cy.clickButton(CONTINUE);
      // The save reloads the same screen under a new `saved` value.
      cy.url().should('match', new RegExp(`/organization/edit/${records[0].id}\\?saved=\\d+$`));
      cy.checkField('Description', 'First description');
      cy.url().then((firstUrl) => {
        // A second continue-save on the same screen is not refused as stale.
        cy.fillField('Description', 'Second description');
        cy.clickButton(CONTINUE);
        cy.url().should('match', /\?saved=\d+$/).and('not.eq', firstUrl);
      });
      cy.checkField('Description', 'Second description');
      cy.reload();
      cy.checkField('Description', 'Second description');
      // The plain Save on the same screen still ends in the list.
      cy.clickButton('Save');
      cy.url().should('match', /\/organization$/);
    });
  });

  it('keeps the plain Save going back to the list after a create', () => {
    cy.visit('/en/organization/new');
    cy.fillField('Name', 'Plain Save Organization');
    cy.clickButton('Save');
    cy.url().should('match', /\/organization$/);
    cy.contains('Plain Save Organization').should('be.visible');
  });

  it('keeps the form and its values when the save is refused', () => {
    cy.visit('/en/organization/new');
    cy.fillField('Description', 'Kept description');
    cy.clickButton(CONTINUE);
    cy.url().should('include', '/organization/new');
    cy.checkField('Description', 'Kept description');
  });

  it('shows no continue button on /new to a user without update permission', () => {
    cy.task<string>('db:createSessionUserWithPermission', {
      entityName: 'organization',
      flags: { create: true, read: true, update: false, delete: false },
      label: 'continue_no_update',
    }).then((email) => {
      cy.login(email, TEST_CREDENTIALS.password);
      cy.visit('/en/organization/new');
      cy.get('button[aria-label="Save"]').should('be.visible');
      cy.get(`button[aria-label="${CONTINUE}"]`).should('not.exist');
    });
  });

  it('shows the continue button on /new to a user with create and update permission', () => {
    cy.task<string>('db:createSessionUserWithPermission', {
      entityName: 'organization',
      flags: { create: true, read: true, update: true, delete: false },
      label: 'continue_with_update',
    }).then((email) => {
      cy.login(email, TEST_CREDENTIALS.password);
      cy.visit('/en/organization/new');
      cy.get(`button[aria-label="${CONTINUE}"]`).should('be.visible');
    });
  });
});
