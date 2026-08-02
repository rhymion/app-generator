// DO NOT EDIT — handwritten MFA E2E test, not auto-generated.
// This file defines the test cases only; orchestration and test run execution are separate concerns.

import { TEST_CREDENTIALS } from '../../support/test-credentials';

type MfaUserSeed = { email: string; password: string; secret: string; recoveryCode: string };
type SsoMfaUserSeed = { email: string; secret: string; recoveryCode: string };

const MFA_SETTINGS_URL = '/en/setting/mfa';
const LOGIN_URL = '/en/login';
const MFA_CHALLENGE_URL = '/en/mfa-challenge';
// The proxy.ts gate itself doesn't care which protected route is requested,
// but the seeded SSO+MFA test user (below) intentionally has no role/
// permissions granted — testing entity-level authz is out of scope here, and
// granting a role would couple this fixture to the permission system. "/en"
// (home) requires only a session, not an entity permission, so tests that
// need to actually land past the challenge use it. Test E instead targets
// MFA_SETTINGS_URL to prove the gate applies to more than just "/en".
const PROTECTED_URL = '/en';

/**
 * Simulates a completed Google OAuth sign-in via the test-only mock
 * provider (auth.ts, gated on `MOCK_GOOGLE_OAUTH_TEST=true` — never
 * active outside `.env.test.local`). Issues the exact same HTTP contract
 * `next-auth/react`'s `signIn()` uses for a credentials-shaped provider
 * (GET csrf token, POST to `/api/auth/callback/<id>` with
 * `application/x-www-form-urlencoded` body) — see node_modules/next-auth/
 * react.js `signIn()`. No `cy.intercept()` involved: this is a real HTTP
 * round trip through the real server, exercising the real signIn()/jwt()/
 * session() callbacks in auth.ts, with zero outbound calls to Google and
 * zero real Google credentials.
 */
function mockGoogleSignIn(email: string) {
  cy.request('GET', '/api/auth/csrf').then(({ body }) => {
    cy.request({
      method: 'POST',
      url: '/api/auth/callback/google',
      form: true,
      body: {
        email,
        csrfToken: body.csrfToken,
        callbackUrl: Cypress.config('baseUrl'),
      },
    });
  });
}

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
  cy.contains('Sign Out').should('be.visible');
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
        cy.get('input[autocomplete="one-time-code"]:visible').first().type(code as string);
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
    cy.get('input[autocomplete="one-time-code"]:visible').first().type('000000');
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
        cy.get('input[autocomplete="one-time-code"]:visible').first().type(code as string);
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

      cy.get('input[autocomplete="one-time-code"]:visible').first().type('000000');
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

  // === S8 / cmd_527: Google OAuth + MFA bypass fix ===
  // Root cause: the MFA gate only existed in CredentialsProvider.authorize()
  // (tests 1-10 above). An SSO-provisioned user (password === null) with
  // mfa_enabled=true could sign in via Google and reach a fully
  // authenticated session with the second factor never checked — the
  // credentials<->OAuth collision guard in auth.ts's signIn() callback only
  // fires for password !== null. See docs/knowledge/authentication.md
  // "OAuth MFA gate" and mfa-oauth-bypass-design.md for the full writeup.

  // === (11) OAuth sign-in for an MFA-enabled SSO user is challenged, not waved through ===
  it('redirects to /mfa-challenge after Google sign-in for an MFA-enabled SSO user', () => {
    cy.task('db:reset');
    cy.task<SsoMfaUserSeed>('db:seedSsoMfaUser').then(({ email }) => {
      mockGoogleSignIn(email);
      cy.visit(PROTECTED_URL);
      cy.url().should('include', MFA_CHALLENGE_URL);
      // The bypass being fixed here is precisely this: without the fix, the
      // line above lands on PROTECTED_URL with a fully authenticated
      // session and this assertion never runs.
      cy.contains('Sign Out').should('be.visible'); // first factor DID succeed — not bounced to /login
    });
  });

  // === (12) MFA challenge — valid TOTP completes the session ===
  it('completes the OAuth session after a valid TOTP on the MFA challenge page', () => {
    cy.task('db:reset');
    cy.task<SsoMfaUserSeed>('db:seedSsoMfaUser').then(({ email, secret }) => {
      mockGoogleSignIn(email);
      cy.visit(PROTECTED_URL);
      cy.url().should('include', MFA_CHALLENGE_URL);

      cy.task('generateTotp', secret).then((code) => {
        cy.get('[data-testid="mfa_code"]').type(code as string);
        cy.get('button[type="submit"]').click();
      });

      cy.url().should('include', PROTECTED_URL);
      cy.url().should('not.include', MFA_CHALLENGE_URL);
      cy.contains('Sign Out').should('be.visible');
    });
  });

  // === (13) MFA challenge — valid recovery code completes the session ===
  // Exercises the same TOTP->recovery-code fallback verified for the
  // credentials path in test (7) — verifyMfaCode() is shared by both.
  it('completes the OAuth session after a valid recovery code on the MFA challenge page', () => {
    cy.task('db:reset');
    cy.task<SsoMfaUserSeed>('db:seedSsoMfaUser').then(({ email, recoveryCode }) => {
      mockGoogleSignIn(email);
      cy.visit(PROTECTED_URL);
      cy.url().should('include', MFA_CHALLENGE_URL);

      cy.get('[data-testid="mfa_code"]').type(recoveryCode);
      cy.get('button[type="submit"]').click();

      cy.url().should('include', PROTECTED_URL);
      cy.url().should('not.include', MFA_CHALLENGE_URL);
      cy.contains('Sign Out').should('be.visible');
    });
  });

  // === (14) MFA challenge — invalid code stays put ===
  it('stays on /mfa-challenge after an invalid code', () => {
    cy.task('db:reset');
    cy.task<SsoMfaUserSeed>('db:seedSsoMfaUser').then(({ email }) => {
      mockGoogleSignIn(email);
      cy.visit(PROTECTED_URL);
      cy.url().should('include', MFA_CHALLENGE_URL);

      cy.get('[data-testid="mfa_code"]').type('000000');
      cy.get('button[type="submit"]').click();

      cy.url().should('include', MFA_CHALLENGE_URL);
      cy.contains('That code did not match').should('be.visible');
      // Lockout prevention (design doc §6.5): a Sign Out link stays reachable
      // even while stuck on the challenge — the header doesn't gate on mfa_pending.
      cy.contains('Sign Out').should('be.visible');
    });
  });

  // === (15) Middleware enforces the gate on every protected route, with callbackUrl preserved ===
  it('redirects any protected route to /mfa-challenge with the original path preserved', () => {
    cy.task('db:reset');
    cy.task<SsoMfaUserSeed>('db:seedSsoMfaUser').then(({ email }) => {
      mockGoogleSignIn(email);
      // A different route than the other tests use (PROTECTED_URL = "/en")
      // to prove the proxy.ts gate applies generally, not to one hardcoded path.
      cy.visit(MFA_SETTINGS_URL);
      cy.url().should('include', MFA_CHALLENGE_URL);
      cy.url().should('include', `callbackUrl=${encodeURIComponent(MFA_SETTINGS_URL)}`);

      // /mfa-challenge itself must stay reachable (no redirect loop).
      cy.location('pathname').should('eq', MFA_CHALLENGE_URL);
    });
  });

});
