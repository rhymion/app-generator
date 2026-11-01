// DO NOT EDIT — handwritten settings-save E2E test, not auto-generated.
//
// Issue #1285 (ASVS V7.5.1): changing the email address on the account
// settings screen needs the current password, the same proof the REST routes
// (PUT /api/setting/:id, covered by cypress/e2e/api/setting_credential_confirmation.cy.ts)
// and a password change ask for. The screen saves through the generated
// Server Action, which calls confirmCredentialChange() before any write.

// Keep these two literals in sync with SETTINGS_SAVE_TEST_CREDENTIALS in
// cypress/support/settings-save-helpers.ts (see settings_avatar_save.cy.ts for
// why they are not imported).
const SETTINGS_SAVE_TEST_NAME = 'Settings Save Test User';
const SETTINGS_SAVE_TEST_PASSWORD = 'password123';
const NEW_EMAIL = 'settings-email-change-new@example.com';

type SettingsSaveUserSeed = { email: string; password: string; userId: string; startingImageId: string };

function openOwnSettingsEditPage() {
  cy.visit('/en/setting');
  cy.contains(SETTINGS_SAVE_TEST_NAME).click();
  cy.get('a[aria-label="Edit"]').click();
  cy.url().should('include', '/setting/edit/');
}

function inputByLabel(label: string) {
  return cy.contains('label', label).invoke('attr', 'for').then((id) => cy.get(`#${CSS.escape(id as string)}`));
}

function setEmail(value: string) {
  inputByLabel('Email').clear().type(value);
}

function save() {
  cy.get('button[aria-label="Save"]').click();
}

describe('Settings email change needs the current password (app-generator#1285)', () => {
  let seed: SettingsSaveUserSeed;

  beforeEach(() => {
    Cypress.session.clearAllSavedSessions();
    cy.clearCookies();
    cy.clearLocalStorage();
    cy.task('db:reset');
    cy.task<SettingsSaveUserSeed>('db:seedSettingsSaveUser').then((s) => {
      seed = s;
      cy.visit('/en/login');
      cy.get('input[name="email"]').type(s.email);
      cy.get('input[name="password"]').type(s.password);
      cy.get('button[type="submit"]').click();
      cy.contains(SETTINGS_SAVE_TEST_NAME).should('be.visible');
    });
  });

  function emailIsStillTheOriginal() {
    // The login still works with the original address, so nothing was written.
    Cypress.session.clearAllSavedSessions();
    cy.clearCookies();
    cy.visit('/en/login');
    cy.get('input[name="email"]').type(seed.email);
    cy.get('input[name="password"]').type(SETTINGS_SAVE_TEST_PASSWORD);
    cy.get('button[type="submit"]').click();
    cy.contains(SETTINGS_SAVE_TEST_NAME).should('be.visible');
  }

  it('refuses a new email address without the current password', () => {
    openOwnSettingsEditPage();
    setEmail(NEW_EMAIL);
    save();
    cy.contains('Enter your current password to change the email address.').should('be.visible');
    cy.url().should('include', '/setting/edit/');
    emailIsStillTheOriginal();
  });

  it('refuses a new email address with a wrong current password', () => {
    openOwnSettingsEditPage();
    setEmail(NEW_EMAIL);
    inputByLabel('Current password').type('not-the-password');
    save();
    cy.contains('The current password is incorrect.').should('be.visible');
    cy.url().should('include', '/setting/edit/');
    emailIsStillTheOriginal();
  });

  it('saves a new email address with the right current password', () => {
    openOwnSettingsEditPage();
    setEmail(NEW_EMAIL);
    inputByLabel('Current password').type(SETTINGS_SAVE_TEST_PASSWORD);
    save();
    cy.url({ timeout: 8000 }).should('not.include', '/setting/edit/');

    Cypress.session.clearAllSavedSessions();
    cy.clearCookies();
    cy.visit('/en/login');
    cy.get('input[name="email"]').type(NEW_EMAIL);
    cy.get('input[name="password"]').type(SETTINGS_SAVE_TEST_PASSWORD);
    cy.get('button[type="submit"]').click();
    cy.contains(SETTINGS_SAVE_TEST_NAME).should('be.visible');
  });

  it('saves without the current password when the email is unchanged', () => {
    openOwnSettingsEditPage();
    save();
    cy.url({ timeout: 8000 }).should('not.include', '/setting/edit/');
  });
});
