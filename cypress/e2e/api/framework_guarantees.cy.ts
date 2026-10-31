// Hand-written -- not part of the generated entity test set.
// Security properties the app relies on from Next.js and Auth.js instead of implementing itself.
// Each test fails if a framework upgrade or a configuration change removes the property; the
// coverage table (docs/knowledge/security-asvs-coverage.md) names this file for those rows.
import { TEST_API_KEY, TEST_CREDENTIALS } from '../../support/test-credentials';

const EVIL_ORIGIN = 'https://evil.example';

describe('API: framework-delegated security guarantees', () => {
  it('sends no CORS headers on REST responses, even for a cross-origin request', () => {
    cy.request({
      url: '/api/user',
      headers: { 'X-API-Key': TEST_API_KEY, Origin: EVIL_ORIGIN },
      failOnStatusCode: false,
    }).then((res) => {
      expect(res.headers).to.not.have.property('access-control-allow-origin');
      expect(res.headers).to.not.have.property('access-control-allow-credentials');
    });
  });

  it('answers a cross-origin preflight without allowing the origin', () => {
    cy.request({
      method: 'OPTIONS',
      url: '/api/user',
      headers: { Origin: EVIL_ORIGIN, 'Access-Control-Request-Method': 'POST' },
      failOnStatusCode: false,
    }).then((res) => {
      expect(res.headers).to.not.have.property('access-control-allow-origin');
    });
  });

  it('rejects a Server Action invocation whose Origin differs from the Host', () => {
    // The Origin check runs before the action id is looked up. A production build hides the error
    // text, so the two refusals are told apart by status instead.
    const headers = { 'Next-Action': '0'.repeat(42), 'Content-Type': 'text/plain;charset=UTF-8' };
    cy.request({
      method: 'POST',
      url: '/login',
      headers: { ...headers, Origin: EVIL_ORIGIN },
      body: '[]',
      failOnStatusCode: false,
    }).then((crossOrigin) => {
      cy.request({
        method: 'POST',
        url: '/login',
        headers: { ...headers, Origin: Cypress.config('baseUrl') as string },
        body: '[]',
        failOnStatusCode: false,
      }).then((sameOrigin) => {
        const seen = `cross-origin ${crossOrigin.status} ${String(crossOrigin.body).slice(0, 120)} / same-origin ${sameOrigin.status} ${String(sameOrigin.body).slice(0, 120)}`;
        // A same-origin request gets past the Origin check and is refused on the unknown action id
        // (409, "Server Action unavailable"); a forged Origin is refused before that lookup, with a 500.
        expect(sameOrigin.status, seen).to.eq(409);
        expect(crossOrigin.status, seen).to.eq(500);
      });
    });
  });

  it('issues the Auth.js CSRF cookie as HttpOnly and SameSite=Lax', () => {
    cy.request({ url: '/api/auth/csrf' }).then((res) => {
      const cookies = ([] as string[]).concat(res.headers['set-cookie'] as string | string[]);
      const csrf = cookies.find((c) => /csrf-token=/.test(c));
      expect(csrf, 'csrf cookie').to.be.a('string');
      expect(csrf).to.match(/HttpOnly/i);
      expect(csrf).to.match(/SameSite=Lax/i);
    });
  });

  it('issues the session cookie as HttpOnly and SameSite=Lax', () => {
    cy.task('db:reset');
    cy.task('db:seed');
    cy.request('GET', '/api/auth/csrf').then(({ body }) => {
      cy.request({
        method: 'POST',
        url: '/api/auth/callback/credentials',
        form: true,
        followRedirect: false,
        failOnStatusCode: false,
        body: {
          email: TEST_CREDENTIALS.email,
          password: TEST_CREDENTIALS.password,
          csrfToken: body.csrfToken,
          callbackUrl: Cypress.config('baseUrl'),
        },
      }).then((res) => {
        const cookies = ([] as string[]).concat(res.headers['set-cookie'] as string | string[]);
        const session = cookies.find((c) => /session-token=/.test(c));
        expect(session, 'session cookie').to.be.a('string');
        expect(session).to.match(/HttpOnly/i);
        expect(session).to.match(/SameSite=Lax/i);
      });
    });
  });

  // Issue #1275 (ASVS V3.5.1, V3.5.2): a cookie-authenticated write refuses a request a browser sent
  // from another site. Next.js protects Server Actions; the REST routes check it themselves.
  describe('cookie-authenticated REST writes', () => {
    function signIn() {
      cy.task('db:reset');
      cy.task('db:seed');
      cy.request('GET', '/api/auth/csrf').then(({ body }) => {
        cy.request({
          method: 'POST',
          url: '/api/auth/callback/credentials',
          form: true,
          followRedirect: false,
          body: {
            email: TEST_CREDENTIALS.email,
            password: TEST_CREDENTIALS.password,
            csrfToken: body.csrfToken,
            callbackUrl: Cypress.config('baseUrl'),
          },
        });
      });
    }

    function markRead(headers: Record<string, string>) {
      return cy.request({ method: 'POST', url: '/api/notifications/mark-read', headers, failOnStatusCode: false });
    }

    beforeEach(() => signIn());

    it('refuses a cross-site and a same-site request, and one whose Origin is foreign', () => {
      markRead({ 'Sec-Fetch-Site': 'cross-site', Origin: EVIL_ORIGIN }).its('status').should('eq', 403);
      markRead({ 'Sec-Fetch-Site': 'same-site' }).its('status').should('eq', 403);
      markRead({ Origin: EVIL_ORIGIN, 'Content-Type': 'text/plain' }).its('status').should('eq', 403);
    });

    it('accepts a same-origin request and one that names no origin', () => {
      markRead({ 'Sec-Fetch-Site': 'same-origin' }).its('status').should('eq', 200);
      markRead({ Origin: Cypress.config('baseUrl') as string }).its('status').should('eq', 200);
      markRead({}).its('status').should('eq', 200);
    });

    it('refuses a cross-site import, which resolves the caller from the cookie too', () => {
      cy.request({
        method: 'POST',
        url: '/api/role/import',
        headers: { 'Sec-Fetch-Site': 'cross-site', 'Content-Type': 'text/plain' },
        body: '[]',
        failOnStatusCode: false,
      })
        .its('status')
        .should('eq', 403);
    });
  });

  // Issue #1300 (ASVS V14.3.1, V14.3.2).
  describe('cache and client-data headers', () => {
    it('marks API responses no-store', () => {
      cy.request({ url: '/api/user', headers: { 'X-API-Key': TEST_API_KEY }, failOnStatusCode: false }).then((res) => {
        expect(res.headers['cache-control']).to.eq('no-store');
      });
    });

    it('marks a signed-in page no-store', () => {
      cy.task('db:reset');
      cy.task('db:seed');
      cy.request('GET', '/api/auth/csrf').then(({ body }) => {
        cy.request({
          method: 'POST',
          url: '/api/auth/callback/credentials',
          form: true,
          followRedirect: false,
          body: {
            email: TEST_CREDENTIALS.email,
            password: TEST_CREDENTIALS.password,
            csrfToken: body.csrfToken,
            callbackUrl: Cypress.config('baseUrl'),
          },
        });
      });
      cy.request({ url: '/en/user', failOnStatusCode: false }).then((res) => {
        expect(res.status).to.eq(200);
        expect(res.headers['cache-control']).to.match(/no-store/);
      });
    });

    it('asks the browser to clear its cache, cookies and storage on sign-out', () => {
      cy.request('GET', '/api/auth/csrf').then(({ body }) => {
        cy.request({
          method: 'POST',
          url: '/api/auth/signout',
          form: true,
          followRedirect: false,
          failOnStatusCode: false,
          body: { csrfToken: body.csrfToken, callbackUrl: Cypress.config('baseUrl') },
        }).then((res) => {
          expect(res.headers['clear-site-data']).to.eq('"cache", "cookies", "storage"');
        });
      });
    });
  });
});
