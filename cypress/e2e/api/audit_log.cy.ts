// AUTO-GENERATED - DO NOT EDIT
import { TEST_API_KEY } from '../../support/test-credentials';

const API_BASE = '/api/audit_log';

describe('API: Audit Log', () => {
  beforeEach(() => {
    cy.task('db:reset');
    cy.task('db:seed');
    cy.task('db:grantAllPermissions');
  });

  describe('GET /api/audit_log', () => {
    it('1.1 returns empty page when no items', () => {
      cy.request({ url: API_BASE, headers: { 'X-API-Key': TEST_API_KEY } })
        .then((res) => {
          expect(res.status).to.eq(200);
          expect(res.body.rows).to.deep.eq([]);
          expect(res.body.total).to.eq(0);
          expect(res.body.page).to.eq(0);
          expect(res.body.pageSize).to.be.a('number');
        });
    });

    it('1.2 returns page with items', () => {
      cy.task('db:populateAuditLog', 1);
      cy.request({ url: API_BASE, headers: { 'X-API-Key': TEST_API_KEY } })
        .then((res) => {
          expect(res.status).to.eq(200);
          expect(res.body.rows).to.have.length(1);
          expect(res.body.total).to.eq(1);
        });
    });
  });

  describe('GET /api/audit_log/:id', () => {
    it('2.1 returns item detail by id', () => {
      cy.task<any[]>('db:populateAuditLog', 1).then((records) => {
        cy.request({ url: `${API_BASE}/${records[0].id}`, headers: { 'X-API-Key': TEST_API_KEY } })
          .then((res) => {
            expect(res.status).to.eq(200);
            expect(res.body.id).to.eq(records[0].id);
          });
      });
    });

    it('2.2 returns 404 for non-existent id', () => {
      cy.request({ url: `${API_BASE}/non-existent-id`, headers: { 'X-API-Key': TEST_API_KEY }, failOnStatusCode: false })
        .then((res) => {
          expect(res.status).to.eq(404);
        });
    });
  });

  // -------------------------------------------------------------------------
  // Bulk operations
  // -------------------------------------------------------------------------

  describe('Authentication errors', () => {
    it('6.1 returns 4xx without API key', () => {
      cy.request({ url: API_BASE, failOnStatusCode: false })
        .then((res) => {
          expect(res.status).to.be.gte(400);
        });
    });

    it('6.2 returns 4xx with invalid API key', () => {
      cy.request({ url: API_BASE, headers: { 'X-API-Key': 'invalid_key' }, failOnStatusCode: false })
        .then((res) => {
          expect(res.status).to.be.gte(400);
        });
    });
  });

  describe('Permission errors', () => {
    it('7.1 returns 4xx for GET list when permission denied', () => {
      cy.task<string>('db:createLimitedApiUser', 'audit_log').then((limitedKey) => {
        cy.request({ url: API_BASE, headers: { 'X-API-Key': limitedKey }, failOnStatusCode: false })
          .then((res) => {
            expect(res.status).to.be.gte(400);
          });
      });
    });
  });
});
