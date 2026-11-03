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

  it('rejects a password change with a wrong current password and keeps the old password', () => {
    openEdit();
    openPasswordSection();
    cy.get('input[type="password"]:visible').eq(0).type(OLD_PASSWORD);
    cy.get('input[type="password"]:visible').eq(1).type(NEW_PASSWORD);
    cy.get('input[type="password"]:visible').eq(2).type(NEW_PASSWORD);
    cy.contains('button', 'Verify Password').click();
    cy.contains('Password verified').should('be.visible');
    typeCurrentPassword('not-the-password');
    save();
    cy.contains('The current password is incorrect.').should('be.visible');
    cy.url().should('include', '/setting/edit/');
    Cypress.session.clearAllSavedSessions();
    cy.clearCookies();
    login(seed.email, OLD_PASSWORD);
    cy.contains(NAME).should('be.visible');
  });

  it('accepts a password change with the correct current password', () => {
    openEdit();
    openPasswordSection();
    cy.get('input[type="password"]:visible').eq(0).type(OLD_PASSWORD);
    cy.get('input[type="password"]:visible').eq(1).type(NEW_PASSWORD);
    cy.get('input[type="password"]:visible').eq(2).type(NEW_PASSWORD);
    cy.contains('button', 'Verify Password').click();
    cy.contains('Password verified').should('be.visible');
    typeCurrentPassword(OLD_PASSWORD);
    save();
    cy.url({ timeout: 8000 }).should('not.include', '/setting/edit/');
    Cypress.session.clearAllSavedSessions();
    cy.clearCookies();
    login(seed.email, NEW_PASSWORD);
    cy.contains(NAME).should('be.visible');
  });

  it('limits repeated wrong current passwords', () => {
    openEdit();
    openPasswordSection();
    cy.get('input[type="password"]:visible').eq(0).type(OLD_PASSWORD);
    cy.get('input[type="password"]:visible').eq(1).type(NEW_PASSWORD);
    cy.get('input[type="password"]:visible').eq(2).type(NEW_PASSWORD);
    cy.contains('button', 'Verify Password').click();
    cy.contains('Password verified').should('be.visible');
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
