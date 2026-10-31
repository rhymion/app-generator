// Hand-written -- not part of the generated entity test set.
// PUT /api/setting/:id and PUT /api/setting/bulk need the same proof the account settings page asks
// for: the current password to change the password or the email address (Issue #1285), a current TOTP
// or recovery code to turn MFA off (Issue #1188). An API key alone is not enough to change any of them.
type CredentialState = {
  passwordIsNull: boolean;
  apiKeyIsNull: boolean;
  passwordHash: string | null;
  mfaEnabled: boolean;
};
type MfaUserSeed = { email: string; password: string; secret: string; recoveryCode: string; apiKey: string };

// The trailing 24-char cuid2 of the key is the user's own id (and the id `setting` expects).
function userIdFromApiKey(apiKey: string): string {
  const match = apiKey.match(/([a-z0-9]{24})$/);
  if (!match) throw new Error(`Could not extract user id from API key: ${apiKey}`);
  return match[1];
}

describe('API: setting update confirms password and MFA changes', () => {
  let seed: MfaUserSeed;
  let originalHash: string;

  function put(body: Record<string, unknown>) {
    return cy.request({
      method: 'PUT',
      url: `/api/setting/${userIdFromApiKey(seed.apiKey)}`,
      headers: { 'X-API-Key': seed.apiKey },
      body: { name: 'Renamed Account', email: seed.email, ...body },
      failOnStatusCode: false,
    });
  }

  function state() {
    return cy.task<CredentialState>('db:getCredentialState', seed.email);
  }

  beforeEach(() => {
    cy.task('db:reset');
    cy.task('db:seed');
    cy.task<MfaUserSeed>('db:seedMfaUser').then((s) => {
      seed = s;
      return state().then((st) => {
        originalHash = st.passwordHash as string;
      });
    });
  });

  describe('password', () => {
    it('rejects a new password without the current password', () => {
      put({ password: 'attacker-chosen-pw' }).its('status').should('eq', 400);
      state().then((st) => expect(st.passwordHash).to.eq(originalHash));
    });

    it('rejects a new password with a wrong current password', () => {
      put({ password: 'attacker-chosen-pw', current_password: 'not-the-password' }).its('status').should('eq', 403);
      state().then((st) => expect(st.passwordHash).to.eq(originalHash));
    });

    it('changes the password, stored as a hash, once the current password is confirmed', () => {
      put({ password: 'a-brand-new-pw1', current_password: seed.password }).its('status').should('eq', 200);
      state().then((st) => {
        expect(st.passwordHash).to.not.eq(originalHash);
        expect(st.passwordHash).to.not.eq('a-brand-new-pw1');
        expect(st.passwordHash).to.match(/^\$2[aby]\$/);
      });
    });

    it('applies the same check to a bulk update item', () => {
      const item = (extra: Record<string, unknown>) => [
        { id: userIdFromApiKey(seed.apiKey), name: 'Renamed Account', email: seed.email, ...extra },
      ];
      const bulk = (extra: Record<string, unknown>) =>
        cy.request({
          method: 'PUT',
          url: '/api/setting/bulk',
          headers: { 'X-API-Key': seed.apiKey },
          body: item(extra),
          failOnStatusCode: false,
        });
      bulk({ password: 'attacker-chosen-pw' }).then((res) => {
        expect(res.body.results[0].success).to.eq(false);
      });
      state().then((st) => expect(st.passwordHash).to.eq(originalHash));
      bulk({ password: 'a-brand-new-pw1', current_password: seed.password }).then((res) => {
        expect(res.body.results[0].success).to.eq(true);
      });
      state().then((st) => expect(st.passwordHash).to.not.eq(originalHash));
    });
  });

  describe('email address', () => {
    const NEW_EMAIL = 'changed-address@example.com';

    function storedEmail() {
      return cy
        .request({ url: `/api/setting/${userIdFromApiKey(seed.apiKey)}`, headers: { 'X-API-Key': seed.apiKey } })
        .then((res) => (res.body.data ?? res.body).email as string);
    }

    it('rejects a new email address without the current password', () => {
      put({ email: NEW_EMAIL }).its('status').should('eq', 400);
      storedEmail().then((email) => expect(email).to.eq(seed.email));
    });

    it('rejects a new email address with a wrong current password', () => {
      put({ email: NEW_EMAIL, current_password: 'not-the-password' }).its('status').should('eq', 403);
      storedEmail().then((email) => expect(email).to.eq(seed.email));
    });

    it('changes the email address once the current password is confirmed, leaving the password alone', () => {
      put({ email: NEW_EMAIL, current_password: seed.password }).its('status').should('eq', 200);
      storedEmail().then((email) => expect(email).to.eq(NEW_EMAIL));
      cy.task<CredentialState>('db:getCredentialState', NEW_EMAIL).then((st) => expect(st.passwordHash).to.eq(originalHash));
    });

    it('applies the same check to a bulk update item', () => {
      const bulk = (extra: Record<string, unknown>) =>
        cy.request({
          method: 'PUT',
          url: '/api/setting/bulk',
          headers: { 'X-API-Key': seed.apiKey },
          body: [{ id: userIdFromApiKey(seed.apiKey), name: 'Renamed Account', email: NEW_EMAIL, ...extra }],
          failOnStatusCode: false,
        });
      bulk({}).then((res) => expect(res.body.results[0].success).to.eq(false));
      storedEmail().then((email) => expect(email).to.eq(seed.email));
      bulk({ current_password: seed.password }).then((res) => expect(res.body.results[0].success).to.eq(true));
      storedEmail().then((email) => expect(email).to.eq(NEW_EMAIL));
    });
  });

  describe('MFA', () => {
    it('rejects turning MFA off without a code', () => {
      put({ mfa_enabled: false }).its('status').should('eq', 400);
      state().then((st) => expect(st.mfaEnabled).to.eq(true));
    });

    it('rejects turning MFA off with an invalid code', () => {
      put({ mfa_enabled: false, mfa_code: '000000' }).its('status').should('eq', 403);
      state().then((st) => expect(st.mfaEnabled).to.eq(true));
    });

    it('leaves MFA on when the body omits mfa_enabled or repeats the stored value', () => {
      put({}).its('status').should('eq', 200);
      put({ mfa_enabled: true }).its('status').should('eq', 200);
      state().then((st) => expect(st.mfaEnabled).to.eq(true));
    });

    it('turns MFA off with a valid recovery code', () => {
      put({ mfa_enabled: false, mfa_code: seed.recoveryCode }).its('status').should('eq', 200);
      state().then((st) => expect(st.mfaEnabled).to.eq(false));
    });

    it('turns MFA off with a current TOTP code', () => {
      cy.task<string>('generateTotp', seed.secret).then((code) => {
        put({ mfa_enabled: false, mfa_code: code }).its('status').should('eq', 200);
      });
      state().then((st) => expect(st.mfaEnabled).to.eq(false));
    });

    it('does not turn MFA on through the REST route', () => {
      put({ mfa_enabled: false, mfa_code: seed.recoveryCode }).its('status').should('eq', 200);
      put({ mfa_enabled: true }).its('status').should('eq', 400);
      state().then((st) => expect(st.mfaEnabled).to.eq(false));
    });
  });
});
