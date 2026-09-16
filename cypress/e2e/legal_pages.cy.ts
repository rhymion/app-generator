// Handwritten supplemental spec — NOT auto-generated, NOT overwritten by generate-code.
// Tests: /[locale]/legal/terms, /[locale]/legal/privacy (public, unauthenticated
// pages), and the links to them from the register page.

describe('Legal document pages', () => {
  beforeEach(() => {
    cy.task('db:reset');
    cy.task('db:seed');
    Cypress.session.clearAllSavedSessions();
    cy.clearCookies();
    cy.clearLocalStorage();
  });

  it('opens the Terms of Service in English without signing in', () => {
    cy.visit('/en/legal/terms');
    cy.contains('h4', 'Terms of Service').should('be.visible');
    cy.contains('Accounts').should('be.visible');
  });

  it('opens the Terms of Service in Japanese without signing in', () => {
    cy.visit('/ja/legal/terms');
    cy.contains('h4', '利用規約').should('be.visible');
  });

  it('opens the Privacy Policy in English without signing in', () => {
    cy.visit('/en/legal/privacy');
    cy.contains('h4', 'Privacy Policy').should('be.visible');
    cy.contains('Data we collect').should('be.visible');
  });

  it('opens the Privacy Policy in Japanese without signing in', () => {
    cy.visit('/ja/legal/privacy');
    cy.contains('h4', 'プライバシーポリシー').should('be.visible');
  });

  it('links from the register page resolve to the real Terms/Privacy pages', () => {
    cy.visit('/en/register');
    cy.contains('a', 'Terms of Service').should('have.attr', 'href', '/en/legal/terms');
    cy.contains('a', 'Privacy Policy').should('have.attr', 'href', '/en/legal/privacy');

    cy.contains('a', 'Terms of Service').click();
    cy.url().should('include', '/en/legal/terms');
    cy.contains('h4', 'Terms of Service').should('be.visible');
  });
});
