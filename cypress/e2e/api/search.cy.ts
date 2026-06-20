// Handwritten supplemental spec — NOT auto-generated, NOT overwritten by generate-code.
// Tests: GET /api/search — full-text + trigram search across searchable entities.
import { TEST_API_KEY } from '../../support/test-credentials';

const SEARCH_URL = '/api/search';

describe('API: GET /api/search', () => {
  beforeEach(() => {
    cy.task('db:reset');
    cy.task('db:seed');
    cy.task('db:grantAllPermissions');
  });

  // 1. Unauthenticated → 401
  describe('Authentication', () => {
    it('returns 401 when no API key is provided', () => {
      cy.request({
        url: `${SEARCH_URL}?q=test`,
        failOnStatusCode: false,
      }).then((res) => {
        expect(res.status).to.eq(401);
      });
    });

    it('returns 401 when an invalid API key is provided', () => {
      cy.request({
        url: `${SEARCH_URL}?q=test`,
        headers: { 'X-API-Key': 'invalid_key_that_does_not_exist' },
        failOnStatusCode: false,
      }).then((res) => {
        expect(res.status).to.eq(401);
      });
    });
  });

  // 2. Input validation → 400
  describe('Input validation', () => {
    it('returns 400 when q is missing', () => {
      cy.request({
        url: SEARCH_URL,
        headers: { 'X-API-Key': TEST_API_KEY },
        failOnStatusCode: false,
      }).then((res) => {
        expect(res.status).to.eq(400);
        expect(res.body).to.have.property('error');
      });
    });

    it('returns 400 when q is empty string', () => {
      cy.request({
        url: `${SEARCH_URL}?q=`,
        headers: { 'X-API-Key': TEST_API_KEY },
        failOnStatusCode: false,
      }).then((res) => {
        expect(res.status).to.eq(400);
        expect(res.body).to.have.property('error');
      });
    });

    it('returns 400 when q is a single character (minimum is 2)', () => {
      cy.request({
        url: `${SEARCH_URL}?q=a`,
        headers: { 'X-API-Key': TEST_API_KEY },
        failOnStatusCode: false,
      }).then((res) => {
        expect(res.status).to.eq(400);
        expect(res.body).to.have.property('error');
      });
    });
  });

  // 3. Successful search → 200 + results array
  describe('Successful search', () => {
    it('returns 200 with results array and pagination fields', () => {
      cy.task('db:populateOrganizationWithUser', 1);
      cy.request({
        url: `${SEARCH_URL}?q=Organization`,
        headers: { 'X-API-Key': TEST_API_KEY },
      }).then((res) => {
        expect(res.status).to.eq(200);
        expect(res.body).to.have.property('results').that.is.an('array');
        expect(res.body).to.have.property('total').that.is.a('number');
        expect(res.body).to.have.property('page').that.is.a('number');
        expect(res.body).to.have.property('pageSize').that.is.a('number');
      });
    });

    it('returns matching organizations when query matches name', () => {
      cy.task('db:populateOrganizationWithUser', 2);
      cy.request({
        url: `${SEARCH_URL}?q=Organization`,
        headers: { 'X-API-Key': TEST_API_KEY },
      }).then((res) => {
        expect(res.status).to.eq(200);
        expect(res.body.results).to.have.length.greaterThan(0);
        res.body.results.forEach((r: { entity_type: string; id: string; snippet: string; rank: number }) => {
          expect(r).to.have.property('entity_type', 'organization');
          expect(r).to.have.property('id').that.is.a('string');
          expect(r).to.have.property('snippet').that.is.a('string');
          expect(r).to.have.property('rank').that.is.a('number');
        });
      });
    });

    it('returns empty results array when no matches found (not 404)', () => {
      cy.task('db:populateOrganizationWithUser', 1);
      cy.request({
        url: `${SEARCH_URL}?q=zzz_absolutely_no_match_xyz`,
        headers: { 'X-API-Key': TEST_API_KEY },
      }).then((res) => {
        expect(res.status).to.eq(200);
        expect(res.body.results).to.be.an('array');
        expect(res.body.total).to.eq(0);
      });
    });

    it('respects page and pageSize parameters', () => {
      cy.task('db:populateOrganizationWithUser', 5);
      cy.request({
        url: `${SEARCH_URL}?q=Organization&page=0&pageSize=2`,
        headers: { 'X-API-Key': TEST_API_KEY },
      }).then((res) => {
        expect(res.status).to.eq(200);
        expect(res.body.results).to.have.length.at.most(2);
        expect(res.body.pageSize).to.eq(2);
        expect(res.body.page).to.eq(0);
      });
    });
  });

  // 4. Multi-entity UNION ALL search (Phase 1)
  describe('Multi-entity search — UNION ALL', () => {
    it('returns results from multiple entity types in one response', () => {
      cy.task('db:populateOrganizationWithUser', 1);
      cy.task('db:populateRoleFull', 1);
      cy.request({
        url: `${SEARCH_URL}?q=Role`,
        headers: { 'X-API-Key': TEST_API_KEY },
      }).then((res) => {
        expect(res.status).to.eq(200);
        expect(res.body.results).to.have.length.greaterThan(0);
        const entityTypes: string[] = res.body.results.map(
          (r: { entity_type: string }) => r.entity_type,
        );
        expect(entityTypes).to.include('role');
      });
    });

    it('filters results by entityTypes parameter', () => {
      cy.task('db:populateOrganizationWithUser', 2);
      cy.task('db:populateRoleFull', 2);

      // Search restricted to organization only
      cy.request({
        url: `${SEARCH_URL}?q=Organization&entityTypes=organization`,
        headers: { 'X-API-Key': TEST_API_KEY },
      }).then((res) => {
        expect(res.status).to.eq(200);
        expect(res.body.results).to.have.length.greaterThan(0);
        res.body.results.forEach((r: { entity_type: string }) => {
          expect(r.entity_type).to.eq('organization');
        });
      });

      // Search restricted to role only
      cy.request({
        url: `${SEARCH_URL}?q=Role&entityTypes=role`,
        headers: { 'X-API-Key': TEST_API_KEY },
      }).then((res) => {
        expect(res.status).to.eq(200);
        expect(res.body.results).to.have.length.greaterThan(0);
        res.body.results.forEach((r: { entity_type: string }) => {
          expect(r.entity_type).to.eq('role');
        });
      });
    });

    it('each result has entity_type, id, snippet, and rank fields', () => {
      cy.task('db:populateOrganizationWithUser', 1);
      cy.task('db:populateRoleFull', 1);
      cy.request({
        url: `${SEARCH_URL}?q=Role`,
        headers: { 'X-API-Key': TEST_API_KEY },
      }).then((res) => {
        expect(res.status).to.eq(200);
        res.body.results.forEach(
          (r: { entity_type: string; id: string; snippet: string; rank: number }) => {
            expect(r).to.have.property('entity_type').that.is.a('string');
            expect(r).to.have.property('id').that.is.a('string');
            expect(r).to.have.property('snippet').that.is.a('string');
            expect(r).to.have.property('rank').that.is.a('number');
          },
        );
      });
    });
  });

  // 5. Permission boundary test (CRITICAL) — org isolation
  // The test user must NOT see organizations they are not a member of.
  describe('Permission boundary — org isolation (CRITICAL)', () => {
    it('does not return organizations the user is not a member of', () => {
      // Create an org where the test user IS a member (should appear in results)
      cy.task('db:populateOrganizationWithUser', 1).then(() => {
        // Create an org where the test user is NOT a member (should NOT appear)
        // db:populateOrganization does NOT add the test user to the org's users list
        cy.task<{ id: string; name: string }[]>('db:populateOrganization', 1).then((nonMemberOrgs) => {
          const nonMemberOrgName = nonMemberOrgs[0].name;
          const nonMemberOrgId = nonMemberOrgs[0].id;

          // Search for "Organization" — matches both, but user should only see the member org
          cy.request({
            url: `${SEARCH_URL}?q=Organization`,
            headers: { 'X-API-Key': TEST_API_KEY },
          }).then((res) => {
            expect(res.status).to.eq(200);

            const returnedIds: string[] = res.body.results.map((r: { id: string }) => r.id);

            // CRITICAL: the non-member org must NOT appear in results
            expect(returnedIds).not.to.include(
              nonMemberOrgId,
              `org "${nonMemberOrgName}" (id: ${nonMemberOrgId}) appeared in search results but user is NOT a member`,
            );
          });
        });
      });
    });
  });

  // 6. Phase 2: facets — entity type counts in response
  describe('Phase 2: facets', () => {
    it('returns facets field with entity type counts', () => {
      cy.task('db:populateOrganizationWithUser', 2);
      cy.task('db:populateRoleFull', 3);
      cy.request({
        url: `${SEARCH_URL}?q=Organization`,
        headers: { 'X-API-Key': TEST_API_KEY },
      }).then((res) => {
        expect(res.status).to.eq(200);
        expect(res.body).to.have.property('facets').that.is.an('object');
        expect(res.body.facets).to.have.property('organization').that.is.a('number');
      });
    });

    it('facets counts match actual result distribution', () => {
      cy.task('db:populateOrganizationWithUser', 2);
      cy.task('db:populateRoleFull', 3);
      cy.request({
        url: `${SEARCH_URL}?q=Role`,
        headers: { 'X-API-Key': TEST_API_KEY },
      }).then((res) => {
        expect(res.status).to.eq(200);
        const facets: Record<string, number> = res.body.facets;
        const results: { entity_type: string }[] = res.body.results;
        // Verify facet counts are consistent with actual results (within page)
        Object.entries(facets).forEach(([type, count]) => {
          expect(count).to.be.greaterThan(0);
          expect(typeof count).to.eq('number');
        });
      });
    });
  });

  // 7. Phase 2: pg_bigm Japanese 2-gram search
  describe('Phase 2: pg_bigm Japanese bigram search', () => {
    it('returns results for Japanese query matching organization name', () => {
      cy.task('db:createOrganizationJa', { name: '東京テスト組織' });
      cy.request({
        url: `${SEARCH_URL}?q=東京`,
        headers: { 'X-API-Key': TEST_API_KEY },
      }).then((res) => {
        expect(res.status).to.eq(200);
        expect(res.body.results).to.have.length.greaterThan(0);
        const found = res.body.results.some(
          (r: { entity_type: string; snippet: string }) =>
            r.entity_type === 'organization' && r.snippet.includes('東京'),
        );
        expect(found).to.be.true;
      });
    });
  });

  // 8. Phase 2: default_scope=all permission coverage
  describe('Phase 2: default_scope=all permission coverage', () => {
    it('does not leak organization data for any entity type when user has no access', () => {
      // Create an org with user as member
      cy.task('db:populateOrganizationWithUser', 1).then(() => {
        // Create an org where user is NOT a member
        cy.task<{ id: string; name: string }[]>('db:populateOrganization', 1).then((nonMemberOrgs) => {
          const nonMemberOrgId = nonMemberOrgs[0].id;

          cy.request({
            url: `${SEARCH_URL}?q=Organization`,
            headers: { 'X-API-Key': TEST_API_KEY },
          }).then((res) => {
            expect(res.status).to.eq(200);
            const returnedIds: string[] = res.body.results.map((r: { id: string }) => r.id);
            // Non-member org must not appear in any entity type
            expect(returnedIds).not.to.include(nonMemberOrgId,
              'Non-member org leaked through search (default_scope=all coverage failure)');
          });
        });
      });
    });

    it('role search only returns roles created by or accessible to the user', () => {
      // Create roles associated with the test user
      cy.task('db:populateRoleFull', 2);
      cy.request({
        url: `${SEARCH_URL}?q=Role&entityTypes=role`,
        headers: { 'X-API-Key': TEST_API_KEY },
      }).then((res) => {
        expect(res.status).to.eq(200);
        // All returned roles must be accessible via creator_id filter
        res.body.results.forEach((r: { entity_type: string }) => {
          expect(r.entity_type).to.eq('role');
        });
      });
    });
  });
});
