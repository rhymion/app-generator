// Hand-written -- not part of the generated entity test set.
// The account settings page issues an API key through a Server Action and shows it once. The new key works, the
// previous key stops working at once, the stored value is the key's hash, and a later visit to the page shows no
// key. Verified by: settings_api_key_issue.cy.ts.
type SettingsSaveUserSeed = { apiKey: string; email: string; password: string; userId: string };
type ApiKeyStorage = { hash: string | null; issuedAt: string | null; hasPlaintextColumn: boolean };

const NAME = 'Settings Save Test User';

function openOwnSettingsView() {
  cy.visit('/en/setting');
  cy.contains(NAME).click();
  cy.url().should('match', /\/setting\/[^/]+$/);
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
});
