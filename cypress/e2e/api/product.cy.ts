// AUTO-GENERATED - DO NOT EDIT
import { TEST_API_KEY } from '../../support/test-credentials';

const API_BASE = '/api/product';

describe('API: Product', () => {
  beforeEach(() => {
    cy.task('db:reset');
    cy.task('db:seed');
  });

  describe('GET /api/product', () => {
    it('1.1 returns empty list when no items', () => {
      cy.request({ url: API_BASE, headers: { 'X-API-Key': TEST_API_KEY } })
        .then((res) => {
          expect(res.status).to.eq(200);
          expect(res.body).to.deep.eq([]);
        });
    });

    it('1.2 returns list with items', () => {
      cy.task('db:populateProduct', 1);
      cy.request({ url: API_BASE, headers: { 'X-API-Key': TEST_API_KEY } })
        .then((res) => {
          expect(res.status).to.eq(200);
          expect(res.body).to.have.length(1);
        });
    });
  });

  describe('GET /api/product/:id', () => {
    it('2.1 returns item detail by id', () => {
      cy.task<any[]>('db:populateProduct', 1).then((records) => {
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

  describe('POST /api/product', () => {
    it('3.1 creates with required fields, verified by GET', () => {
      cy.request({
        method: 'POST',
        url: API_BASE,
        headers: { 'X-API-Key': TEST_API_KEY },
        body: {
          code: 'Test Code',
          name: 'Test Product',
          price: 100,
        },
      }).then((res) => {
        expect(res.status).to.eq(201);
        cy.request({ url: `${API_BASE}/${res.body.id}`, headers: { 'X-API-Key': TEST_API_KEY } })
          .then((getRes) => {
            expect(getRes.status).to.eq(200);
            expect(getRes.body.name).to.eq('Test Product');
          });
      });
    });

    it('5.1 fails when required field name is missing', () => {
      cy.request({
        method: 'POST',
        url: API_BASE,
        headers: { 'X-API-Key': TEST_API_KEY },
        body: {
          code: 'Test Code',
          price: 100,
        },
        failOnStatusCode: false,
      }).then((res) => {
        expect(res.status).to.be.gte(400);
      });
    });
  });

  describe('PUT /api/product/:id', () => {
    it('4.1 updates, verified by GET', () => {
      cy.task<any[]>('db:populateProduct', 1).then((records) => {
        cy.request({
          method: 'PUT',
          url: `${API_BASE}/${records[0].id}`,
          headers: { 'X-API-Key': TEST_API_KEY },
          body: {
            code: records[0].code,
            name: 'Updated Product',
            price: records[0].price,
          },
        }).then((res) => {
          expect(res.status).to.eq(200);
          cy.request({ url: `${API_BASE}/${records[0].id}`, headers: { 'X-API-Key': TEST_API_KEY } })
            .then((getRes) => {
              expect(getRes.status).to.eq(200);
              expect(getRes.body.name).to.eq('Updated Product');
            });
        });
      });
    });
  });

  describe('DELETE /api/product/:id', () => {
    it('4.2 deletes item, verified by GET returning 404', () => {
      cy.task<any[]>('db:populateProduct', 1).then((records) => {
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
      cy.task<string>('db:createLimitedApiUser', 'product').then((limitedKey) => {
        cy.request({ url: API_BASE, headers: { 'X-API-Key': limitedKey }, failOnStatusCode: false })
          .then((res) => {
            expect(res.status).to.eq(403);
          });
      });
    });

    it('7.2 returns 403 for POST when permission denied', () => {
      cy.task<string>('db:createLimitedApiUser', 'product').then((limitedKey) => {
        cy.request({
          method: 'POST',
          url: API_BASE,
          headers: { 'X-API-Key': limitedKey },
          body: {
            code: 'Test Code',
            name: 'Test Product',
            price: 100,
          },
          failOnStatusCode: false,
        }).then((res) => {
          expect(res.status).to.eq(403);
        });
      });
    });
  });
});
