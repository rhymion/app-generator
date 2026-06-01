// DO NOT EDIT — handwritten MFA E2E test, not auto-generated.
// Execution is karo's responsibility (test rule #3). This file only writes tests.

import { TEST_CREDENTIALS } from '../../support/test-credentials';

type MfaUserSeed = { email: string; password: string; secret: string; recoveryCode: string };

const MFA_SETTINGS_URL = '/en/setting/mfa';
const LOGIN_URL = '/en/login';

/**
 * Full two-step login for an account with MFA enabled.
 * Generates a fresh TOTP code from the seed secret via cy.task('generateTotp').
 */
function doMfaLogin(email: string, password: string, totpSecret: string) {
  cy.visit(LOGIN_URL);
  cy.get('input[name="email"]').type(email);
  cy.get('input[name="password"]').type(password);
  cy.get('button[type="submit"]').click();
  cy.get('[data-testid="mfa_code"]').should('be.visible');
  cy.task('generateTotp', totpSecret).then((code) => {
    cy.get('[data-testid="mfa_code"]').type(code as string);
    cy.get('button[type="submit"]').click();
  });
}

describe('MFA (TOTP + Recovery Code)', () => {

  beforeEach(() => {
    Cypress.session.clearAllSavedSessions();
    cy.clearCookies();
    cy.clearLocalStorage();
  });

  // === (1) MFA enrollment success ===
  it('enrolls MFA successfully with valid TOTP code', () => {
    cy.task('db:reset');
    cy.task('db:seed');
    cy.login(TEST_CREDENTIALS.email, TEST_CREDENTIALS.password);
    cy.visit(MFA_SETTINGS_URL);

    cy.contains('Enable MFA').click();
    cy.contains('Manual entry secret:').should('be.visible');

    // Capture the plaintext secret shown in the UI, generate a live TOTP from it.
    cy.contains('Manual entry secret:').next().invoke('text').then((secret) => {
      cy.task('generateTotp', secret.trim()).then((code) => {
        cy.get('input[autocomplete="one-time-code"]').type(code as string);
        cy.contains('Verify and enable').click();
      });
    });

    // Recovery codes are shown once — acknowledge them.
    cy.contains("I've saved my recovery codes").should('be.visible').click();
    cy.contains('Two-factor authentication is enabled on this account.').should('be.visible');
  });

  // === (2) Enrollment failure — wrong TOTP code ===
  it('fails MFA enrollment with invalid TOTP code', () => {
    cy.task('db:reset');
    cy.task('db:seed');
    cy.login(TEST_CREDENTIALS.email, TEST_CREDENTIALS.password);
    cy.visit(MFA_SETTINGS_URL);

    cy.contains('Enable MFA').click();
    cy.get('input[autocomplete="one-time-code"]').type('000000');
    cy.contains('Verify and enable').click();

    cy.contains('Invalid code. Please try again.').should('be.visible');
    cy.contains('Verify and enable').should('be.visible');
  });

  // === (3) MFA disable success ===
  it('disables MFA successfully with a valid TOTP code', () => {
    cy.task('db:reset');
    cy.task<MfaUserSeed>('db:seedMfaUser').then(({ email, password, secret }) => {
      doMfaLogin(email, password, secret);
      cy.contains('MFA Test User').should('be.visible');

      cy.visit(MFA_SETTINGS_URL);
      cy.contains('Two-factor authentication is enabled on this account.').should('be.visible');

      cy.task('generateTotp', secret).then((code) => {
        cy.get('input[autocomplete="one-time-code"]').type(code as string);
        cy.contains('Disable MFA').click();
      });

      cy.contains('Enable MFA').should('be.visible');
      cy.contains('Two-factor authentication is enabled on this account.').should('not.exist');
    });
  });

  // === (4) MFA disable failure — wrong code ===
  it('fails MFA disable with invalid code', () => {
    cy.task('db:reset');
    cy.task<MfaUserSeed>('db:seedMfaUser').then(({ email, password, secret }) => {
      doMfaLogin(email, password, secret);
      cy.visit(MFA_SETTINGS_URL);

      cy.get('input[autocomplete="one-time-code"]').type('000000');
      cy.contains('Disable MFA').click();

      cy.contains('Invalid code. Please try again.').should('be.visible');
      cy.contains('Disable MFA').should('be.visible');
    });
  });

  // === (5) MFA login success — valid TOTP ===
  it('logs in successfully with valid TOTP after MFA enrollment', () => {
    cy.task('db:reset');
    cy.task<MfaUserSeed>('db:seedMfaUser').then(({ email, password, secret }) => {
      cy.visit(LOGIN_URL);
      cy.get('input[name="email"]').type(email);
      cy.get('input[name="password"]').type(password);
      cy.get('button[type="submit"]').click();

      // MFA prompt appears after credentials are accepted.
      cy.get('[data-testid="mfa_code"]').should('be.visible');
      cy.task('generateTotp', secret).then((code) => {
        cy.get('[data-testid="mfa_code"]').type(code as string);
        cy.get('button[type="submit"]').click();
      });

      cy.contains('MFA Test User').should('be.visible');
    });
  });

  // === (6) MFA login failure — wrong TOTP ===
  it('fails login with invalid TOTP code', () => {
    cy.task('db:reset');
    cy.task<MfaUserSeed>('db:seedMfaUser').then(({ email, password }) => {
      cy.visit(LOGIN_URL);
      cy.get('input[name="email"]').type(email);
      cy.get('input[name="password"]').type(password);
      cy.get('button[type="submit"]').click();

      cy.get('[data-testid="mfa_code"]').should('be.visible');
      cy.get('[data-testid="mfa_code"]').type('000000');
      cy.get('button[type="submit"]').click();

      cy.contains('That code did not match').should('be.visible');
      cy.get('[data-testid="mfa_code"]').should('be.visible');
    });
  });

  // === (7) Recovery code login success ===
  // cmd_090 finding: mfa_code field accepts TOTP → recovery code fallback (verifyMfaCode in lib/mfa/verify.ts).
  it('logs in successfully with a valid recovery code', () => {
    cy.task('db:reset');
    cy.task<MfaUserSeed>('db:seedMfaUser').then(({ email, password, recoveryCode }) => {
      cy.visit(LOGIN_URL);
      cy.get('input[name="email"]').type(email);
      cy.get('input[name="password"]').type(password);
      cy.get('button[type="submit"]').click();

      cy.get('[data-testid="mfa_code"]').should('be.visible');
      cy.get('[data-testid="mfa_code"]').type(recoveryCode);
      cy.get('button[type="submit"]').click();

      cy.contains('MFA Test User').should('be.visible');
    });
  });

  // === (8) Recovery code login failure — invalid code ===
  it('fails login with an invalid recovery code', () => {
    cy.task('db:reset');
    cy.task<MfaUserSeed>('db:seedMfaUser').then(({ email, password }) => {
      cy.visit(LOGIN_URL);
      cy.get('input[name="email"]').type(email);
      cy.get('input[name="password"]').type(password);
      cy.get('button[type="submit"]').click();

      cy.get('[data-testid="mfa_code"]').should('be.visible');
      cy.get('[data-testid="mfa_code"]').type('XXXXX-XXXXX');
      cy.get('button[type="submit"]').click();

      cy.contains('That code did not match').should('be.visible');
      cy.get('[data-testid="mfa_code"]').should('be.visible');
    });
  });

  // === (9) Enrollment not completed — cancel drops MFA pending state ===
  it('does not enable MFA if enrollment is cancelled', () => {
    cy.task('db:reset');
    cy.task('db:seed');
    cy.login(TEST_CREDENTIALS.email, TEST_CREDENTIALS.password);
    cy.visit(MFA_SETTINGS_URL);

    cy.contains('Enable MFA').click();
    cy.contains('Manual entry secret:').should('be.visible');

    cy.contains('Cancel').click();

    cy.contains('Enable MFA').should('be.visible');
    cy.contains('Two-factor authentication is enabled on this account.').should('not.exist');
  });

  // === (10) MFA status display — disabled vs enabled ===
  it('displays current MFA status correctly', () => {
    // Disabled state: regular user with no MFA.
    cy.task('db:reset');
    cy.task('db:seed');
    cy.login(TEST_CREDENTIALS.email, TEST_CREDENTIALS.password);
    cy.visit(MFA_SETTINGS_URL);
    cy.contains('Enable MFA').should('be.visible');
    cy.contains('Disable MFA').should('not.exist');

    // Enabled state: seed MFA user in the same DB (no reset needed), switch session.
    Cypress.session.clearAllSavedSessions();
    cy.clearCookies();
    cy.task<MfaUserSeed>('db:seedMfaUser').then(({ email, password, secret }) => {
      doMfaLogin(email, password, secret);
      cy.visit(MFA_SETTINGS_URL);
      cy.contains('Two-factor authentication is enabled on this account.').should('be.visible');
      cy.contains('Disable MFA').should('be.visible');
    });
  });

});
