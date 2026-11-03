// DO NOT EDIT -- handwritten settings-save E2E test, not auto-generated.
//
// Saving the account settings form verifies the current password when the
// password changes, with the same check the REST routes use
// (confirmCredentialChange). A save that does not change the password needs none.

const NAME = 'Settings Save Test User';
const OLD_PASSWORD = 'password123';
const NEW_PASSWORD = 'a-new-password-456';

type Seed = { email: string; password: string; userId: string };

function login(email: string, password: string) {
  cy.visit('/en/login');
  cy.get('input[name="email"]').type(email);
  cy.get('input[name="password"]').type(password);
  cy.get('button[type="submit"]').click();
}

function openEdit() {
  cy.visit('/en/setting');
  cy.contains(NAME).click();
  cy.get('a[aria-label="Edit"]').click();
  cy.url().should('include', '/setting/edit/');
}

function typeCurrentPassword(value: string) {
  cy.get('input[name="current_password"]').clear();
  if (value) cy.get('input[name="current_password"]').type(value);
}

function openPasswordSection() {
  cy.contains('Change Password').click();
}

// The change-password block holds only these two fields; the current password is the
// form's own "current_password" field, asked once.
function typeNewPassword(value: string, confirmation: string = value) {
  cy.get('input[type="password"]:visible').not('[name="current_password"]').eq(0).clear().type(value);
  cy.get('input[type="password"]:visible').not('[name="current_password"]').eq(1).clear().type(confirmation);
}

function save() {
  cy.get('button[aria-label="Save"]').click();
}

describe('Settings credential change needs the current password', () => {
  let seed: Seed;

  beforeEach(() => {
    Cypress.session.clearAllSavedSessions();
    cy.clearCookies();
    cy.clearLocalStorage();
    cy.task('db:reset');
    cy.task<Seed>('db:seedSettingsSaveUser').then((s) => {
      seed = s;
      login(s.email, s.password);
      cy.contains(NAME).should('be.visible');
    });
  });

  it('saves without the current password when the password does not change', () => {
    openEdit();
    save();
    cy.url({ timeout: 8000 }).should('not.include', '/setting/edit/');
  });

  it('asks for the current password once and has no verify step', () => {
    openEdit();
    openPasswordSection();
    cy.get('input[name="current_password"]').should('have.length', 1);
    cy.get('input[type="password"]:visible').should('have.length', 3);
    cy.contains('Current Password').should('not.exist');
    cy.contains('Verify Password').should('not.exist');
    cy.contains('button', 'Verify').should('not.exist');
  });

  it('rejects a password change with a wrong current password and keeps the old password', () => {
    openEdit();
    openPasswordSection();
    typeNewPassword(NEW_PASSWORD);
    typeCurrentPassword('not-the-password');
    save();
    cy.contains('The current password is incorrect.').should('be.visible');
    cy.url().should('include', '/setting/edit/');
    Cypress.session.clearAllSavedSessions();
    cy.clearCookies();
    login(seed.email, OLD_PASSWORD);
    cy.contains(NAME).should('be.visible');
  });

  it('rejects a typed new password when no current password is given', () => {
    openEdit();
    openPasswordSection();
    typeNewPassword(NEW_PASSWORD);
    save();
    cy.url().should('include', '/setting/edit/');
    Cypress.session.clearAllSavedSessions();
    cy.clearCookies();
    login(seed.email, OLD_PASSWORD);
    cy.contains(NAME).should('be.visible');
  });

  it('applies a typed new password with the correct current password, without any intermediate step', () => {
    openEdit();
    openPasswordSection();
    typeNewPassword(NEW_PASSWORD);
    typeCurrentPassword(OLD_PASSWORD);
    save();
    cy.url({ timeout: 8000 }).should('not.include', '/setting/edit/');
    Cypress.session.clearAllSavedSessions();
    cy.clearCookies();
    login(seed.email, NEW_PASSWORD);
    cy.contains(NAME).should('be.visible');
  });

  it('shows why a mismatched confirmation is not applied instead of claiming success', () => {
    openEdit();
    openPasswordSection();
    typeNewPassword(NEW_PASSWORD, 'something-else-789');
    cy.get('.password-mismatch').should('be.visible').and('contain', 'do not match');
    cy.contains('Password verified').should('not.exist');
    typeCurrentPassword(OLD_PASSWORD);
    save();
    cy.url({ timeout: 8000 }).should('not.include', '/setting/edit/');
    Cypress.session.clearAllSavedSessions();
    cy.clearCookies();
    login(seed.email, OLD_PASSWORD);
    cy.contains(NAME).should('be.visible');
  });

  it('limits repeated wrong current passwords', () => {
    openEdit();
    openPasswordSection();
    typeNewPassword(NEW_PASSWORD);
    for (let i = 0; i < 10; i += 1) {
      typeCurrentPassword(`wrong-${i}`);
      save();
      cy.contains('The current password is incorrect.').should('be.visible');
    }
    typeCurrentPassword(OLD_PASSWORD);
    save();
    cy.contains('Too many attempts').should('be.visible');
    cy.url().should('include', '/setting/edit/');
  });
});
