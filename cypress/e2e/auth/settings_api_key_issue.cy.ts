// Hand-written -- not part of the generated entity test set.
// The account settings page issues an API key through a Server Action and shows it once. The new key works, the
// previous key stops working at once, the stored value is the key's hash, and a later visit to the page shows no
// key. The owner also picks, changes and clears the key's expiry there (default 90 days, or none), and an expired
// key is shown as expired and rejected. Verified by: settings_api_key_issue.cy.ts.
type SettingsSaveUserSeed = { apiKey: string; email: string; password: string; userId: string };
type ApiKeyStorage = { hash: string | null; issuedAt: string | null; expiresAt: string | null; hasPlaintextColumn: boolean };

const NAME = 'Settings Save Test User';

function openOwnSettingsView() {
  cy.visit('/en/setting');
  cy.contains(NAME).click();
  cy.url().should('match', /\/setting\/view\/[^/]+$/);
  cy.contains('button', 'API key').click();
}

describe('Settings: issue an API key', () => {
  beforeEach(() => {
    Cypress.session.clearAllSavedSessions();
    cy.clearCookies();
    cy.clearLocalStorage();
    cy.task('db:reset');
  });

  it('shows the new key once, replaces the old key and stores only the hash', () => {
    cy.task<SettingsSaveUserSeed>('db:seedSettingsSaveUser').then((seed) => {
      cy.visit('/en/login');
      cy.get('input[name="email"]').type(seed.email);
      cy.get('input[name="password"]').type(seed.password);
      cy.get('button[type="submit"]').click();
      cy.contains(NAME).should('be.visible');

      const url = `/api/setting/${seed.userId}`;
      cy.request({ url, headers: { 'X-API-Key': seed.apiKey } }).its('status').should('eq', 200);

      openOwnSettingsView();
      // Before issuing, the page shows that a key is set and no key value.
      cy.contains('An API key is set.').should('be.visible');
      cy.get('input[type="text"]').filter((_, el) => (el as HTMLInputElement).value.startsWith('mk_')).should('not.exist');

      cy.contains('button', 'Issue a new API key').click();
      cy.contains('It is shown only once').should('be.visible');

      cy.get('input[type="text"]')
        .filter((_, el) => (el as HTMLInputElement).value.startsWith('mk_'))
        .should('have.length', 1)
        .invoke('val')
        .then((shown) => {
          const newKey = String(shown);
          expect(newKey).to.match(/^mk_[0-9a-f]{64}$/);
          expect(newKey).to.not.eq(seed.apiKey);

          cy.request({ url, headers: { 'X-API-Key': newKey } }).its('status').should('eq', 200);
          cy.request({ url, headers: { 'X-API-Key': seed.apiKey }, failOnStatusCode: false })
            .its('status').should('eq', 401);

          cy.task<string>('apiKey:hash', newKey).then((newHash) => {
            cy.task<ApiKeyStorage>('db:getApiKeyStorage', seed.email).then((storage) => {
              expect(storage.hash).to.eq(newHash);
              expect(storage.issuedAt, 'the issue time is recorded').to.be.a('string');
            });
          });

          // Leaving and coming back: the page no longer shows any key.
          openOwnSettingsView();
          cy.contains('An API key is set.').should('be.visible');
          cy.get('input[type="text"]').filter((_, el) => (el as HTMLInputElement).value.startsWith('mk_')).should('not.exist');
          cy.get('body').should('not.contain.text', newKey);
        });
    });
  });

  const login = (seed: SettingsSaveUserSeed) => {
    cy.visit('/en/login');
    cy.get('input[name="email"]').type(seed.email);
    cy.get('input[name="password"]').type(seed.password);
    cy.get('button[type="submit"]').click();
    cy.contains(NAME).should('be.visible');
  };
  const storage = (email: string) => cy.task<ApiKeyStorage>('db:getApiKeyStorage', email);
  const DAY = 86_400_000;

  it('preselects the 90-day default, stores it for the new key, and leaves the existing key alone until reissued', () => {
    cy.task<SettingsSaveUserSeed>('db:seedSettingsSaveUser').then((seed) => {
      cy.task('db:setApiKeyExpiry', { email: seed.email, expiresAt: null });
      login(seed);
      openOwnSettingsView();
      // An existing key keeps its (absent) expiry.
      cy.contains('Never expires.').should('be.visible');

      cy.get('[data-testid="api-key-issue-expiry"]').invoke('val').then((value) => {
        const days = (new Date(String(value)).getTime() - Date.now()) / DAY;
        expect(days, 'preselected days').to.be.within(89, 91);
      });
      cy.contains('button', 'Issue a new API key').click();
      cy.contains('It is shown only once').should('be.visible');

      storage(seed.email).then((s) => {
        const days = (new Date(String(s.expiresAt)).getTime() - Date.now()) / DAY;
        expect(days, 'stored expiry in days').to.be.within(89, 91);
      });
      cy.contains(/Expires /).should('be.visible');
    });
  });

  it('lets the owner issue a key that never expires, pick a date, change it and clear it', () => {
    cy.task<SettingsSaveUserSeed>('db:seedSettingsSaveUser').then((seed) => {
      login(seed);
      openOwnSettingsView();

      // Issue with "Never expires" selected.
      cy.get('[data-testid="api-key-issue-expiry"]').should('be.visible');
      cy.contains('label', 'Never expires').first().click();
      cy.get('[data-testid="api-key-issue-expiry"]').should('not.exist');
      cy.contains('button', 'Issue a new API key').click();
      cy.contains('It is shown only once').should('be.visible');
      storage(seed.email).its('expiresAt').should('eq', null);
      cy.contains('Never expires.').should('be.visible');

      // Change the expiry of the current key to a chosen future date.
      cy.get('[data-testid="api-key-change-expiry"]').should('not.exist');
      cy.contains('label', 'Never expires').last().click();
      cy.get('[data-testid="api-key-change-expiry"]').clear().type('2031-02-03T04:05');
      cy.contains('button', 'Save expiry').click();
      cy.contains(/Expires /).should('be.visible');
      storage(seed.email).then((s) => {
        expect(new Date(String(s.expiresAt)).getTime()).to.eq(new Date('2031-02-03T04:05').getTime());
      });

      // Clear it again.
      cy.contains('label', 'Never expires').last().click();
      cy.contains('button', 'Save expiry').click();
      cy.contains('Never expires.').should('be.visible');
      storage(seed.email).its('expiresAt').should('eq', null);
    });
  });

  it('refuses a past expiry without changing the key', () => {
    cy.task<SettingsSaveUserSeed>('db:seedSettingsSaveUser').then((seed) => {
      login(seed);
      openOwnSettingsView();
      storage(seed.email).then((before) => {
        cy.get('[data-testid="api-key-issue-expiry"]').clear().type('2001-01-01T00:00');
        cy.contains('button', 'Issue a new API key').click();
        cy.contains('Choose an expiry in the future').should('be.visible');
        storage(seed.email).then((after) => expect(after.hash).to.eq(before.hash));
      });
    });
  });

  it('shows an elapsed expiry as expired and rejects the key', () => {
    cy.task<SettingsSaveUserSeed>('db:seedSettingsSaveUser').then((seed) => {
      cy.task('db:setApiKeyExpiry', { email: seed.email, expiresAt: new Date(Date.now() - 60_000).toISOString() });
      login(seed);
      cy.request({ url: `/api/setting/${seed.userId}`, headers: { 'X-API-Key': seed.apiKey }, failOnStatusCode: false })
        .its('status').should('eq', 401);
      openOwnSettingsView();
      cy.contains(/Expired /).should('be.visible');
    });
  });
});
