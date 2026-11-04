// Handwritten supplemental spec — NOT auto-generated, NOT overwritten by generate-code.
// Tests: the report-only Content Security Policy sent by proxy.ts (per-request nonce) and the
// violation report route. The enforced frame-ancestors header must stay unchanged.
import { TEST_CREDENTIALS } from '../support/test-credentials';

const REPORT_ONLY = 'content-security-policy-report-only';

function nonceOf(policy: string): string {
  const match = /script-src [^;]*'nonce-([A-Za-z0-9+/=]+)'/.exec(policy);
  expect(match, 'script-src carries a nonce').to.not.equal(null);
  return match![1];
}

describe('Content Security Policy (report-only)', () => {
  beforeEach(() => {
    cy.task('db:reset');
    cy.task('db:seed');
    Cypress.session.clearAllSavedSessions();
    cy.clearCookies();
  });

  it('sends a report-only policy with a fresh nonce on a public page and keeps frame-ancestors enforced', () => {
    cy.request('/en/login').then((first) => {
      const policy = String(first.headers[REPORT_ONLY]);
      const nonce = nonceOf(policy);
      expect(policy).to.contain(`style-src 'self' 'nonce-${nonce}'`);
      expect(policy).to.contain('report-uri /api/security/csp-report');
      // The enforced header is a separate header and is unchanged.
      expect(first.headers['content-security-policy']).to.equal("frame-ancestors 'none'");
      expect(first.headers['x-frame-options']).to.equal('DENY');
      // Next.js stamps its own scripts with the nonce from the policy.
      expect(first.body).to.contain(`nonce="${nonce}"`);

      cy.request('/en/login').then((second) => {
        expect(nonceOf(String(second.headers[REPORT_ONLY]))).to.not.equal(nonce);
      });
    });
  });

  it('sends the policy on a signed-in page', () => {
    cy.login(TEST_CREDENTIALS.email, TEST_CREDENTIALS.password);
    cy.request('/en/').then((res) => {
      expect(nonceOf(String(res.headers[REPORT_ONLY]))).to.have.length.greaterThan(10);
      expect(res.headers['cache-control']).to.equal('no-store');
      expect(res.headers['content-security-policy']).to.equal("frame-ancestors 'none'");
    });
  });

  it('keeps the page usable: report-only never blocks', () => {
    // Report-only never blocks: the page still renders and the form is usable.
    cy.visit('/en/login');
    cy.get('input[name="email"]').should('be.visible');
  });

  describe('POST /api/security/csp-report', () => {
    const url = '/api/security/csp-report';

    it('accepts a report-uri body without a session', () => {
      cy.request({
        method: 'POST',
        url,
        headers: { 'content-type': 'application/csp-report' },
        body: JSON.stringify({
          'csp-report': { 'document-uri': 'http://localhost/en/login?x=1', 'violated-directive': 'img-src', 'blocked-uri': 'inline' },
        }),
      })
        .its('status')
        .should('equal', 204);
    });

    it('accepts a Reporting API body', () => {
      cy.request({
        method: 'POST',
        url,
        headers: { 'content-type': 'application/reports+json' },
        body: JSON.stringify([
          { type: 'csp-violation', body: { documentURL: 'http://localhost/en/login', effectiveDirective: 'img-src', blockedURL: 'inline' } },
        ]),
      })
        .its('status')
        .should('equal', 204);
    });

    it('rejects a body that is not JSON', () => {
      cy.request({ method: 'POST', url, body: 'not json', headers: { 'content-type': 'text/plain' }, failOnStatusCode: false })
        .its('status')
        .should('equal', 400);
    });
  });
});
