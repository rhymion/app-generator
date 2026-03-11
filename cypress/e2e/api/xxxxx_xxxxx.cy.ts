// AUTO-GENERATED - DO NOT EDIT
import { TEST_API_KEY } from '../../support/test-credentials';

const API_BASE = '/api/xxxxx_xxxxx';

describe('API: Xxxxx Xxxxx', () => {
  beforeEach(() => {
    cy.task('db:reset');
    cy.task('db:seed');
  });

  describe('GET /api/xxxxx_xxxxx', () => {
    it('1.1 returns empty list when no items', () => {
      cy.request({ url: API_BASE, headers: { 'X-API-Key': TEST_API_KEY } })
        .then((res) => {
          expect(res.status).to.eq(200);
          expect(res.body).to.deep.eq([]);
        });
    });

    it('1.2 returns list with items', () => {
      cy.task('db:populateXxxxxXxxxx', 1);
      cy.request({ url: API_BASE, headers: { 'X-API-Key': TEST_API_KEY } })
        .then((res) => {
          expect(res.status).to.eq(200);
          expect(res.body).to.have.length(1);
        });
    });
  });

  describe('GET /api/xxxxx_xxxxx/:id', () => {
    it('2.1 returns item detail by id', () => {
      cy.task<any[]>('db:populateXxxxxXxxxx', 1).then((records) => {
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

  describe('POST /api/xxxxx_xxxxx', () => {
    it('3.1 creates with required fields, verified by GET', () => {
      cy.request({
        method: 'POST',
        url: API_BASE,
        headers: { 'X-API-Key': TEST_API_KEY },
        body: {
          name: 'Test Xxxxx Xxxxx',
          yyyyy_yyyyys: [],
        },
      }).then((res) => {
        expect(res.status).to.eq(201);
        cy.request({ url: `${API_BASE}/${res.body.id}`, headers: { 'X-API-Key': TEST_API_KEY } })
          .then((getRes) => {
            expect(getRes.status).to.eq(200);
            expect(getRes.body.id).to.exist;
          });
      });
    });

    it('5.1 fails when a required field is missing', () => {
      cy.request({
        method: 'POST',
        url: API_BASE,
        headers: { 'X-API-Key': TEST_API_KEY },
        body: {
          yyyyy_yyyyys: [],
        },
        failOnStatusCode: false,
      }).then((res) => {
        expect(res.status).to.be.gte(400);
      });
    });
  });

  describe('PUT /api/xxxxx_xxxxx/:id', () => {
    it('4.1 updates, verified by GET', () => {
      cy.task<any[]>('db:populateXxxxxXxxxx', 1).then((records) => {
        cy.request({
          method: 'PUT',
          url: `${API_BASE}/${records[0].id}`,
          headers: { 'X-API-Key': TEST_API_KEY },
          body: {
            name: records[0].name,
            description: records[0].description,
            team: records[0].team,
            yyyyy_yyyyys: [],
          },
        }).then((res) => {
          expect(res.status).to.eq(200);
          cy.request({ url: `${API_BASE}/${records[0].id}`, headers: { 'X-API-Key': TEST_API_KEY } })
            .then((getRes) => {
              expect(getRes.status).to.eq(200);
              expect(getRes.body.id).to.eq(records[0].id);
            });
        });
      });
    });
  });

  describe('DELETE /api/xxxxx_xxxxx/:id', () => {
    it('4.2 deletes item, verified by GET returning 404', () => {
      cy.task<any[]>('db:populateXxxxxXxxxx', 1).then((records) => {
        cy.request({
          method: 'DELETE',
          url: `${API_BASE}/${records[0].id}`,
          headers: { 'X-API-Key': TEST_API_KEY },
        }).then((res) => {
          expect(res.status).to.eq(204);
          cy.request({ url: `${API_BASE}/${records[0].id}`, headers: { 'X-API-Key': TEST_API_KEY }, failOnStatusCode: false })
            .then((getRes) => {
              expect(getRes.status).to.eq(404);
            });
        });
      });
    });
  });

  describe('Authentication errors', () => {
    it('6.1 returns 401 without API key', () => {
      cy.request({ url: API_BASE, failOnStatusCode: false })
        .then((res) => {
          expect(res.status).to.eq(401);
        });
    });

    it('6.2 returns 401 with invalid API key', () => {
      cy.request({ url: API_BASE, headers: { 'X-API-Key': 'invalid_key' }, failOnStatusCode: false })
        .then((res) => {
          expect(res.status).to.eq(401);
        });
    });
  });

  describe('Permission errors', () => {
    it('7.1 returns 403 for GET list when permission denied', () => {
      cy.task<string>('db:createLimitedApiUser', 'xxxxx_xxxxx').then((limitedKey) => {
        cy.request({ url: API_BASE, headers: { 'X-API-Key': limitedKey }, failOnStatusCode: false })
          .then((res) => {
            expect(res.status).to.eq(403);
          });
      });
    });

    it('7.2 returns 403 for POST when permission denied', () => {
      cy.task<string>('db:createLimitedApiUser', 'xxxxx_xxxxx').then((limitedKey) => {
        cy.request({
          method: 'POST',
          url: API_BASE,
          headers: { 'X-API-Key': limitedKey },
          body: {
            name: 'Test Xxxxx Xxxxx',
            yyyyy_yyyyys: [],
          },
          failOnStatusCode: false,
        }).then((res) => {
          expect(res.status).to.eq(403);
        });
      });
    });
  });
});
