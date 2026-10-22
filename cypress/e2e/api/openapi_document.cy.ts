// Handwritten supplemental spec — NOT auto-generated, NOT overwritten by generate-code.
// Tests: GET /api/openapi.json — the generated OpenAPI document, served at an
// authenticated route in every environment (Issue #769).
//
// This spec deliberately does NOT add a session-cookie (cy.login()) test —
// resolveActorId()/requireDualAuth() (lib/api-auth.ts) is shared by every
// dual-auth route, and cypress/e2e/api/approval_flow_crud.cy.ts's N14
// ("dual-auth-session-canary") is the one deliberate session-cookie proof for
// the whole route family; do not re-add session coverage here. The session
// branch, plus the full 200/200/401 three-way, is also verified by hand
// against a real `next build` + `next start` server as part of this
// feature's own rollout — see the task report for that run's output.
import { TEST_API_KEY } from '../../support/test-credentials';

const OPENAPI_URL = '/api/openapi.json';

describe('API: GET /api/openapi.json', () => {
  beforeEach(() => {
    cy.task('db:reset');
    cy.task('db:seed');
  });

  describe('Authentication', () => {
    it('returns 401 when no credentials are provided', () => {
      cy.request({ url: OPENAPI_URL, failOnStatusCode: false }).then((res) => {
        expect(res.status).to.eq(401);
      });
    });

    it('returns 401 when an invalid API key is provided', () => {
      cy.request({
        url: OPENAPI_URL,
        headers: { 'X-API-Key': 'invalid_key_that_does_not_exist' },
        failOnStatusCode: false,
      }).then((res) => {
        expect(res.status).to.eq(401);
      });
    });
  });

  describe('Document', () => {
    it('returns 200 with the generated OpenAPI document for a valid API key', () => {
      cy.request({
        url: OPENAPI_URL,
        headers: { 'X-API-Key': TEST_API_KEY },
      }).then((res) => {
        expect(res.status).to.eq(200);
        expect(res.body).to.have.property('openapi', '3.1.0');
        expect(res.body).to.have.property('paths').that.is.an('object');
        expect(res.body).to.have.property('info').that.has.property('description');
      });
    });

    it('info.description no longer says the document is unserved, and points at this route', () => {
      cy.request({
        url: OPENAPI_URL,
        headers: { 'X-API-Key': TEST_API_KEY },
      }).then((res) => {
        const description: string = res.body.info.description;
        expect(description).to.not.include('not served');
        expect(description).to.include('/api/openapi.json');
      });
    });

    it('any authenticated caller may read it — no per-permission check', () => {
      cy.task<string>('db:createLimitedApiUser', 'audit_log').then((limitedKey) => {
        cy.request({
          url: OPENAPI_URL,
          headers: { 'X-API-Key': limitedKey },
        }).then((res) => {
          expect(res.status).to.eq(200);
        });
      });
    });
  });
});
