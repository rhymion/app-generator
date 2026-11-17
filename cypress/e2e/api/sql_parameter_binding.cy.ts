// Hand-written -- not part of the generated entity test set.
// ASVS V1.1.2 (Issue #1273): values reach PostgreSQL as bound parameters, never as SQL text.
// Values made of SQL syntax are stored and read back byte for byte through the generated
// write path (Prisma query builder), the list filter, the trigram list search and the global
// search (tagged-template $queryRaw), and no other row or table is affected.
import { TEST_API_KEY } from '../../support/test-credentials';

const headers = { 'X-API-Key': TEST_API_KEY };

// Each one breaks out of a string literal in a different way if it were concatenated into SQL.
const PAYLOADS = [
  `x'); DROP TABLE "role"; --`,
  `' OR '1'='1`,
  `"; DELETE FROM "user" WHERE ''='`,
  `\\'; SELECT pg_sleep(5); --`,
  `$$; TRUNCATE audit_log; $$`,
];

type Row = { id: string; name?: string; description?: string | null };
type Page = { rows: Row[]; total: number };

function createRole(name: string, description: string): Cypress.Chainable<string> {
  return cy
    .request({ method: 'POST', url: '/api/role', headers, body: { name, description } })
    .then((res) => {
      expect(res.status).to.eq(201);
      return res.body.id as string;
    });
}

function roleCount(): Cypress.Chainable<number> {
  return cy.request({ url: '/api/role?pageSize=1', headers }).then((res) => (res.body as Page).total);
}

describe('API: SQL syntax in values is bound as data (V1.1.2)', () => {
  beforeEach(() => {
    cy.task('db:reset');
    cy.task('db:seed');
    cy.task('db:grantAllPermissions');
    cy.task('db:populateRole', 3);
  });

  it('stores and reads back each value unchanged, leaving every other row in place', () => {
    roleCount().then((before) => {
      PAYLOADS.forEach((p, i) => {
        createRole(`${p} #${i}`, p).then((id) => {
          cy.request({ url: `/api/role/${id}`, headers }).then((res) => {
            expect(res.status).to.eq(200);
            expect(res.body.name).to.eq(`${p} #${i}`);
            expect(res.body.description).to.eq(p);
          });
        });
      });
      roleCount().should('eq', before + PAYLOADS.length);
    });
    // The user table the third payload targets still answers with its seeded rows.
    cy.request({ url: '/api/user?pageSize=1', headers }).then((res) => {
      expect(res.status).to.eq(200);
      expect((res.body as Page).total).to.be.greaterThan(0);
    });
  });

  it('a list filter value made of SQL syntax matches only the row that holds it', () => {
    createRole(PAYLOADS[1], 'filter target').then((id) => {
      cy.request({ url: `/api/role?f.name=${encodeURIComponent(PAYLOADS[1])}`, headers }).then((res) => {
        expect(res.status).to.eq(200);
        expect((res.body as Page).rows.map((r) => r.id)).to.deep.equal([id]);
      });
    });
  });

  it('the trigram list search treats SQL syntax as text', () => {
    createRole(PAYLOADS[0], 'search target').then((id) => {
      cy.request({ url: `/api/role?search=${encodeURIComponent("DROP TABLE \"role\"")}`, headers }).then((res) => {
        expect(res.status).to.eq(200);
        expect((res.body as Page).rows.map((r) => r.id)).to.deep.equal([id]);
      });
      cy.request({ url: `/api/role?search=${encodeURIComponent("' OR '1'='1")}`, headers }).then((res) => {
        expect(res.status).to.eq(200);
        expect((res.body as Page).rows).to.deep.equal([]);
      });
    });
  });

  it('the global search answers normally for a query made of SQL syntax', () => {
    PAYLOADS.forEach((p) => {
      cy.request({ url: `/api/search?q=${encodeURIComponent(p)}`, headers, failOnStatusCode: false }).then((res) => {
        expect(res.status).to.eq(200);
      });
    });
    roleCount().should('be.greaterThan', 0);
  });
});
