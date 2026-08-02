// Handwritten supplemental spec — NOT auto-generated, NOT overwritten by
// generate-code. Tests: proxy.ts unauthenticated-request handling (cmd_525).
//
// Covers the four properties cmd_525 required be demonstrated empirically:
//   1. Page routes redirect unauthenticated requests to /login.
//   2. API routes are unaffected — still return JSON, never redirected.
//   3. Excluded routes (/login, /register, /legal/*, static assets) never
//      redirect, so there is no infinite loop.
//   4. The user is returned to their original destination after signing in,
//      and an off-site `redirect` value is rejected (open-redirect defense).
import { TEST_CREDENTIALS } from '../support/test-credentials';

describe('Unauthenticated request handling (proxy.ts middleware redirect)', () => {
  beforeEach(() => {
    cy.task('db:reset');
    cy.task('db:seed');
    Cypress.session.clearAllSavedSessions();
    cy.clearCookies();
    cy.clearLocalStorage();
  });

  describe('Page routes — redirected to /login', () => {
    it('redirects an unauthenticated request for a protected page, carrying the original path', () => {
      cy.visit('/en/organization');
      cy.url().should('include', '/en/login');
      cy.url().should('include', 'redirect=%2Fen%2Forganization');
      cy.get('input[name="email"]').should('be.visible');
    });

    it('preserves the query string of the original page in the redirect param', () => {
      cy.visit('/en/organization?tab=2');
      cy.url().should('include', '/en/login');
      cy.url().should('include', encodeURIComponent('/en/organization?tab=2'));
    });
  });

  describe('API routes — unaffected, still return JSON', () => {
    it('returns a JSON 401 for an unauthenticated API request, never a redirect', () => {
      cy.request({ url: '/api/organization', failOnStatusCode: false }).then((response) => {
        expect(response.status).to.eq(401);
        expect(response.headers['content-type']).to.include('application/json');
        expect(response.body).to.have.property('error');
        expect(response.redirects ?? []).to.have.length(0);
      });
    });
  });

  describe('Excluded routes — no redirect, no loop', () => {
    it('/login itself renders directly', () => {
      cy.visit('/en/login');
      cy.url().should('include', '/en/login');
      cy.get('input[name="email"]').should('be.visible');
    });

    it('/register renders directly', () => {
      cy.visit('/en/register');
      cy.url().should('eq', Cypress.config().baseUrl + '/en/register');
    });

    it('/legal/terms renders directly', () => {
      cy.visit('/en/legal/terms');
      cy.url().should('eq', Cypress.config().baseUrl + '/en/legal/terms');
    });

    it('a static asset is served directly', () => {
      cy.request('/favicon.ico').its('status').should('eq', 200);
    });
  });

  describe('Post-login redirect-back', () => {
    it('returns the user to the page they originally requested', () => {
      cy.visit('/en/organization');
      cy.url().should('include', '/en/login');

      cy.get('input[name="email"]').type(TEST_CREDENTIALS.email);
      cy.get('input[name="password"]').type(TEST_CREDENTIALS.password);
      cy.get('button[type="submit"]').click();

      cy.url().should('eq', Cypress.config().baseUrl + '/en/organization');
    });

    it('falls back to the app root when there is nowhere to return to', () => {
      cy.visit('/en/login');

      cy.get('input[name="email"]').type(TEST_CREDENTIALS.email);
      cy.get('input[name="password"]').type(TEST_CREDENTIALS.password);
      cy.get('button[type="submit"]').click();

      cy.url().should('eq', Cypress.config().baseUrl + '/en');
    });
  });

  describe('Open-redirect protection', () => {
    it('rejects an off-site redirect target and falls back to the app root', () => {
      cy.visit('/en/login?redirect=' + encodeURIComponent('https://evil.example.com'));

      cy.get('input[name="email"]').type(TEST_CREDENTIALS.email);
      cy.get('input[name="password"]').type(TEST_CREDENTIALS.password);
      cy.get('button[type="submit"]').click();

      // Must land on this app's own root — never navigate to the off-site URL.
      cy.url().should('eq', Cypress.config().baseUrl + '/en');
    });

    it('rejects a protocol-relative redirect target and falls back to the app root', () => {
      cy.visit('/en/login?redirect=' + encodeURIComponent('//evil.example.com'));

      cy.get('input[name="email"]').type(TEST_CREDENTIALS.email);
      cy.get('input[name="password"]').type(TEST_CREDENTIALS.password);
      cy.get('button[type="submit"]').click();

      cy.url().should('eq', Cypress.config().baseUrl + '/en');
    });
  });
});
