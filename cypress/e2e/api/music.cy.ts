// AUTO-GENERATED - DO NOT EDIT
import { TEST_API_KEY } from '../../support/test-credentials';

const API_BASE = '/api/music';

describe('API: Music', () => {
  beforeEach(() => {
    cy.task('db:reset');
    cy.task('db:seed');
    cy.task('db:grantAllPermissions');
  });

  describe('GET /api/music', () => {
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
      cy.task('db:populateMusic', 1);
      cy.request({ url: API_BASE, headers: { 'X-API-Key': TEST_API_KEY } })
        .then((res) => {
          expect(res.status).to.eq(200);
          expect(res.body.rows).to.have.length(1);
          expect(res.body.total).to.eq(1);
        });
    });
  });

  describe('GET /api/music/:id', () => {
    it('2.1 returns item detail by id', () => {
      cy.task<any[]>('db:populateMusic', 1).then((records) => {
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

  describe('POST /api/music', () => {
    it('3.1 creates with required fields, verified by GET', () => {
      cy.request({
        method: 'POST',
        url: API_BASE,
        headers: { 'X-API-Key': TEST_API_KEY },
        body: {
          title: 'Test Title',
          kind: 0,
          scenes: [],
          composers: [],
          credits: [],
        },
      }).then((res) => {
        expect(res.status).to.eq(201);
        cy.request({ url: `${API_BASE}/${res.body.id}`, headers: { 'X-API-Key': TEST_API_KEY } })
          .then((getRes) => {
            expect(getRes.status).to.eq(200);
            expect(getRes.body.title).to.eq('Test Title');
          });
      });
    });

    it('5.1 fails when a required field is missing', () => {
      cy.request({
        method: 'POST',
        url: API_BASE,
        headers: { 'X-API-Key': TEST_API_KEY },
        body: {
          kind: 0,
          scenes: [],
          composers: [],
          credits: [],
        },
        failOnStatusCode: false,
      }).then((res) => {
        expect(res.status).to.be.gte(400);
      });
    });
  });

  describe('PUT /api/music/:id', () => {
    it('4.1 updates, verified by GET', () => {
      cy.task<any[]>('db:populateMusic', 1).then((records) => {
        cy.request({
          method: 'PUT',
          url: `${API_BASE}/${records[0].id}`,
          headers: { 'X-API-Key': TEST_API_KEY },
          body: {
            title: 'Updated Title',
            kind: records[0].kind,
            scenes: [],
            composers: [],
            credits: [],
          },
        }).then((res) => {
          expect(res.status).to.eq(200);
          cy.request({ url: `${API_BASE}/${records[0].id}`, headers: { 'X-API-Key': TEST_API_KEY } })
            .then((getRes) => {
              expect(getRes.status).to.eq(200);
              expect(getRes.body.title).to.eq('Updated Title');
            });
        });
      });
    });
  });

  describe('DELETE /api/music/:id', () => {
    it('4.2 deletes item, verified by GET returning 4xx', () => {
      cy.task<any[]>('db:populateMusic', 1).then((records) => {
        cy.request({
          method: 'DELETE',
          url: `${API_BASE}/${records[0].id}`,
          headers: { 'X-API-Key': TEST_API_KEY },
        }).then((res) => {
          expect(res.status).to.eq(204);
          cy.request({ url: `${API_BASE}/${records[0].id}`, headers: { 'X-API-Key': TEST_API_KEY }, failOnStatusCode: false })
            .then((getRes) => {
              expect(getRes.status).to.be.gte(400);
            });
        });
      });
    });
  });

  // -------------------------------------------------------------------------
  // Bulk operations
  // -------------------------------------------------------------------------

  describe('POST /api/music/bulk', () => {
    it('8.1 bulk creates — all succeed, summary reflects counts', () => {
      cy.request({
        method: 'POST',
        url: `${API_BASE}/bulk`,
        headers: { 'X-API-Key': TEST_API_KEY },
        body: [
          {
            title: 'Test Title',
            kind: 0,
            scenes: [],
            composers: [],
            credits: [],
          },
        ],
      }).then((res) => {
        expect(res.status).to.eq(207);
        expect(res.body.summary.total).to.eq(1);
        expect(res.body.summary.succeeded).to.eq(1);
        expect(res.body.summary.failed).to.eq(0);
        expect(res.body.results[0].success).to.be.true;
        expect(res.body.results[0].data.id).to.exist;
      });
    });

    it('8.2 bulk creates — partial failure when a required field is missing', () => {
      cy.request({
        method: 'POST',
        url: `${API_BASE}/bulk`,
        headers: { 'X-API-Key': TEST_API_KEY },
        body: [
          {
            title: 'Test Title',
            kind: 0,
            scenes: [],
            composers: [],
            credits: [],
          },
          {
            kind: 0,
            scenes: [],
            composers: [],
            credits: [],
          },
        ],
      }).then((res) => {
        expect(res.status).to.eq(207);
        expect(res.body.summary.total).to.eq(2);
        expect(res.body.summary.succeeded).to.eq(1);
        expect(res.body.summary.failed).to.eq(1);
        expect(res.body.results[0].success).to.be.true;
        expect(res.body.results[1].success).to.be.false;
        expect(res.body.results[1].error).to.be.a('string');
      });
    });
  });

  describe('PUT /api/music/bulk', () => {
    it('9.1 bulk updates — all succeed, summary reflects counts', () => {
      cy.task<any[]>('db:populateMusic', 1).then((records) => {
        cy.request({
          method: 'PUT',
          url: `${API_BASE}/bulk`,
          headers: { 'X-API-Key': TEST_API_KEY },
          body: [
            {
              id: records[0].id,
              title: 'Updated Title',
              kind: records[0].kind,
              scenes: [],
              composers: [],
              credits: [],
            },
          ],
        }).then((res) => {
          expect(res.status).to.eq(207);
          expect(res.body.summary.total).to.eq(1);
          expect(res.body.summary.succeeded).to.eq(1);
          expect(res.body.summary.failed).to.eq(0);
          expect(res.body.results[0].success).to.be.true;
        });
      });
    });

    it('9.2 bulk updates — partial failure for non-existent id', () => {
      cy.task<any[]>('db:populateMusic', 1).then((records) => {
        cy.request({
          method: 'PUT',
          url: `${API_BASE}/bulk`,
          headers: { 'X-API-Key': TEST_API_KEY },
          body: [
            {
              id: records[0].id,
              title: 'Updated Title',
              kind: records[0].kind,
              scenes: [],
              composers: [],
              credits: [],
            },
            { id: 'non-existent-id' },
          ],
        }).then((res) => {
          expect(res.status).to.eq(207);
          expect(res.body.summary.total).to.eq(2);
          expect(res.body.summary.succeeded).to.eq(1);
          expect(res.body.summary.failed).to.eq(1);
          expect(res.body.results[1].success).to.be.false;
        });
      });
    });
  });

  describe('DELETE /api/music/bulk', () => {
    it('10.1 bulk deletes — all succeed, items are gone', () => {
      cy.task<any[]>('db:populateMusic', 1).then((records) => {
        cy.request({
          method: 'DELETE',
          url: `${API_BASE}/bulk`,
          headers: { 'X-API-Key': TEST_API_KEY },
          body: [{ id: records[0].id }],
        }).then((res) => {
          expect(res.status).to.eq(207);
          expect(res.body.summary.succeeded).to.eq(1);
          expect(res.body.summary.failed).to.eq(0);
          cy.request({
            url: `${API_BASE}/${records[0].id}`,
            headers: { 'X-API-Key': TEST_API_KEY },
            failOnStatusCode: false,
          }).then((getRes) => {
            expect(getRes.status).to.be.gte(400);
          });
        });
      });
    });

    it('10.2 bulk deletes — partial failure for non-existent id', () => {
      cy.task<any[]>('db:populateMusic', 1).then((records) => {
        cy.request({
          method: 'DELETE',
          url: `${API_BASE}/bulk`,
          headers: { 'X-API-Key': TEST_API_KEY },
          body: [{ id: records[0].id }, { id: 'non-existent-id' }],
        }).then((res) => {
          expect(res.status).to.eq(207);
          expect(res.body.summary.total).to.eq(2);
          expect(res.body.summary.succeeded).to.eq(1);
          expect(res.body.summary.failed).to.eq(1);
          expect(res.body.results[0].success).to.be.true;
          expect(res.body.results[1].success).to.be.false;
        });
      });
    });
  });

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
      cy.task<string>('db:createLimitedApiUser', 'music').then((limitedKey) => {
        cy.request({ url: API_BASE, headers: { 'X-API-Key': limitedKey }, failOnStatusCode: false })
          .then((res) => {
            expect(res.status).to.be.gte(400);
          });
      });
    });

    it('7.2 returns 4xx for POST when permission denied', () => {
      cy.task<string>('db:createLimitedApiUser', 'music').then((limitedKey) => {
        cy.request({
          method: 'POST',
          url: API_BASE,
          headers: { 'X-API-Key': limitedKey },
          body: {
            title: 'Test Title',
            kind: 0,
            scenes: [],
            composers: [],
            credits: [],
          },
          failOnStatusCode: false,
        }).then((res) => {
          expect(res.status).to.be.gte(400);
        });
      });
    });
  });
});
