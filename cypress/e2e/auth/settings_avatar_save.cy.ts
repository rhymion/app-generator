// DO NOT EDIT — handwritten settings-save E2E test, not auto-generated.
//
// app-generator#576 regression coverage: the Settings edit form
// (components/setting/FormUpsert.tsx) let a user upload/remove/replace
// their avatar but could not Save the change -- every Save threw
// "This record has been updated since you opened it. Please reload to
// compare with the latest changes.", the CONFLICT error normally reserved
// for a genuine concurrent edit.
//
// Root cause #1: lib/normalize.ts's assertNotStale() compares the form's
// "as opened" snapshot (srcSnapshotRaw) against the DB's current row via
// JSON.stringify across every compared column -- including write-only
// fields (password, api_key). A write-only field is never returned to the
// client on any read path (is_write_only_prop), so the client's snapshot
// always has that key missing/null, while the DB's real value is non-null
// for any credentials-registered account -- guaranteed mismatch, CONFLICT
// on literally every Save, independent of what was actually changed.
// Fixed in code_generator/build_context.py by excluding write-only fields
// from the compared-fields set (snapshot_field_mappings).
//
// Root cause #2 (more severe, found while verifying the #1 fix): with
// root cause #1 fixed, a Save reaches the DB write -- exposing that the
// write side (code_generator/build_context.py `_normalized_value_expr`)
// coerced an empty string to NULL for every nullable plain-text field,
// including password/api_key. Since the Password/ApiKey form components
// never receive the real persisted value (write-only) and stay '' unless
// the user explicitly supplies a new value, EVERY Save that doesn't touch
// password/api_key was silently wiping them to NULL. Fixed by treating a
// write-only field's '' as "leave unchanged" (Prisma `undefined`, which
// omits the data key) rather than "clear to NULL" -- unlike an ordinary
// nullable field (e.g. image_id), where '' legitimately means "the user
// explicitly cleared this" and must still persist as NULL (the "remove
// avatar" flow below depends on that NOT changing).
//
// Both accounts (credentials PASSWORD-bearing, and SSO password=null) hit
// root cause #1 identically -- unlike #563, this is not SSO-specific.
// Root cause #2's *consequence* (password wiped) only bites a credentials
// account, since an SSO account's password is already null either way; it
// is exercised here via the credentials fixture, which seeds a real
// (non-null) password AND api_key specifically so a silent wipe would be
// observable.

// Deliberately NOT imported from cypress/support/settings-save-helpers.ts:
// that module has a top-level `@/app/generated/prisma/client` import, which
// only resolves in the Node-side cy.task() context (cypress.config.ts),
// not in the browser-side webpack bundle a spec file compiles into (same
// reason cypress/e2e/auth/mfa.cy.ts re-declares its own local
// MfaUserSeed/SsoMfaUserSeed types instead of importing them from
// mfa-helpers.ts). Keep these two literals in sync with
// SETTINGS_SAVE_TEST_CREDENTIALS / SSO_SETTINGS_SAVE_TEST in that file.
const SETTINGS_SAVE_TEST_NAME = 'Settings Save Test User';
const SETTINGS_SAVE_TEST_PASSWORD = 'password123';

type SettingsSaveUserSeed = { email: string; password: string; userId: string; startingImageId: string };
type SsoSettingsSaveUserSeed = { email: string; userId: string; startingImageId: string };

const CONFLICT_TEXT = 'has been updated since you opened it';

function mockGoogleSignIn(email: string) {
  cy.request('GET', '/api/auth/csrf').then(({ body }) => {
    cy.request({
      method: 'POST',
      url: '/api/auth/callback/google',
      form: true,
      body: { email, csrfToken: body.csrfToken, callbackUrl: Cypress.config('baseUrl') },
    });
  });
}

function openOwnSettingsEditPage(name: string) {
  cy.visit('/en/setting');
  cy.contains(name).click();
  cy.get('a[aria-label="Edit"]').click();
  cy.url().should('include', '/setting/edit/');
}

function saveAndAssertNoConflict() {
  cy.get('button[aria-label="Save"]').click();
  // A CONFLICT would surface as this exact text inline in the form; give
  // the round trip a moment, then assert it never appears.
  cy.contains(CONFLICT_TEXT, { timeout: 8000 }).should('not.exist');
  // A successful Save always redirects off the edit page.
  cy.url({ timeout: 8000 }).should('not.include', '/setting/edit/');
}

describe('Settings avatar save (app-generator#576)', () => {
  beforeEach(() => {
    Cypress.session.clearAllSavedSessions();
    cy.clearCookies();
    cy.clearLocalStorage();
    cy.task('db:reset');
  });

  describe('credentials account', () => {
    function seedAndLogin(): Cypress.Chainable<SettingsSaveUserSeed> {
      return cy.task<SettingsSaveUserSeed>('db:seedSettingsSaveUser').then((seed) => {
        cy.visit('/en/login');
        cy.get('input[name="email"]').type(seed.email);
        cy.get('input[name="password"]').type(seed.password);
        cy.get('button[type="submit"]').click();
        cy.contains(SETTINGS_SAVE_TEST_NAME).should('be.visible');
        return cy.wrap(seed);
      });
    }

    it('saves with zero field changes (the core #576 repro)', () => {
      seedAndLogin().then((seed) => {
        openOwnSettingsEditPage(SETTINGS_SAVE_TEST_NAME);
        saveAndAssertNoConflict();

        cy.task('db:getCredentialState', seed.email).then((state: any) => {
          expect(state.passwordIsNull, 'password must survive an untouched Save').to.eq(false);
          expect(state.apiKeyIsNull, 'api_key must survive an untouched Save').to.eq(false);
        });

        // The credential must still work for a fresh login (not merely
        // "non-null" -- catches a save that wiped it to some OTHER value).
        Cypress.session.clearAllSavedSessions();
        cy.clearCookies();
        cy.visit('/en/login');
        cy.get('input[name="email"]').type(seed.email);
        cy.get('input[name="password"]').type(SETTINGS_SAVE_TEST_PASSWORD);
        cy.get('button[type="submit"]').click();
        cy.contains(SETTINGS_SAVE_TEST_NAME).should('be.visible');
      });
    });

    it('adds an avatar from a clean (no-avatar) state', () => {
      seedAndLogin().then((seed) => {
        cy.task('db:getCredentialState', seed.email); // baseline, unused beyond side effect ordering
        openOwnSettingsEditPage(SETTINGS_SAVE_TEST_NAME);
        // Remove the seeded starting avatar first so this test exercises a
        // genuine add-from-empty, not a replace.
        cy.contains('Remove').click();
        cy.get('input[type="file"]').first().selectFile('cypress/fixtures/settings-avatar-test.png', { force: true });
        saveAndAssertNoConflict();

        cy.task('db:getCredentialState', seed.email).then((state: any) => {
          expect(state.passwordIsNull, 'password must survive an avatar-add Save').to.eq(false);
        });
      });
    });

    it('removes an existing avatar', () => {
      seedAndLogin().then((seed) => {
        openOwnSettingsEditPage(SETTINGS_SAVE_TEST_NAME);
        cy.contains('Remove').click();
        saveAndAssertNoConflict();

        cy.task('db:getCredentialState', seed.email).then((state: any) => {
          expect(state.passwordIsNull, 'password must survive an avatar-remove Save').to.eq(false);
        });
      });
    });

    it('replaces an existing avatar with a different one', () => {
      seedAndLogin().then((seed) => {
        openOwnSettingsEditPage(SETTINGS_SAVE_TEST_NAME);
        cy.get('input[type="file"]').first().selectFile('cypress/fixtures/settings-avatar-test2.png', { force: true });
        saveAndAssertNoConflict();

        cy.task('db:getCredentialState', seed.email).then((state: any) => {
          expect(state.passwordIsNull, 'password must survive an avatar-replace Save').to.eq(false);
        });
      });
    });
  });

  describe('SSO account (parity check -- #576, unlike #563, is not SSO-specific)', () => {
    function seedAndLogin(): Cypress.Chainable<SsoSettingsSaveUserSeed> {
      return cy.task<SsoSettingsSaveUserSeed>('db:seedSsoSettingsSaveUser').then((seed) => {
        mockGoogleSignIn(seed.email);
        cy.visit('/en');
        return cy.wrap(seed);
      });
    }

    it('saves with zero field changes', () => {
      seedAndLogin().then(() => {
        cy.contains('SSO Settings Save Test User').should('be.visible');
        openOwnSettingsEditPage('SSO Settings Save Test User');
        saveAndAssertNoConflict();
      });
    });
  });
});
