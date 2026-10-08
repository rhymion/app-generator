// Hand-written -- not part of the generated entity test set.
// GET /api/<entity>/options: the REST side of the relation picker the web forms use.
import { TEST_API_KEY, TEST_CREDENTIALS } from '../../support/test-credentials';

type Row = { id: string; name?: string };

const optionsUrl = (entity: string, query = '') => `/api/${entity}/options${query}`;

describe('API: relation picker options', () => {
  beforeEach(() => {
    cy.task('db:reset');
    cy.task('db:seed');
    cy.task('db:grantAllPermissions');
  });

  describe('authentication', () => {
    it('rejects a request without credentials', () => {
      cy.request({ url: optionsUrl('role'), failOnStatusCode: false }).its('status').should('eq', 401);
    });

    it('rejects an invalid API key', () => {
      cy.request({ url: optionsUrl('role'), headers: { 'X-API-Key': 'not-a-real-key' }, failOnStatusCode: false })
        .its('status')
        .should('eq', 401);
    });

    it('accepts a mobile access token', () => {
      cy.task<Row[]>('db:populateRole', 2);
      cy.request('POST', '/api/mobile/auth/token', {
        email: TEST_CREDENTIALS.email,
        password: TEST_CREDENTIALS.password,
      }).then((login) => {
        const accessToken = (login.body as { access_token: string }).access_token;
        cy.request({ url: optionsUrl('role', '?q=Role'), headers: { Authorization: `Bearer ${accessToken}` } }).then((res) => {
          expect(res.status).to.eq(200);
          expect(res.body).to.be.an('array');
          expect((res.body as Row[]).map((r) => r.name)).to.include.members(['Role 1', 'Role 2']);
        });
      });
    });

    it('rejects a mobile access token that is not valid', () => {
      cy.request({
        url: optionsUrl('role'),
        headers: { Authorization: 'Bearer aaa.bbb.ccc' },
        failOnStatusCode: false,
      })
        .its('status')
        .should('eq', 401);
    });
  });

  describe('search and id lookup', () => {
    beforeEach(() => {
      cy.task<Row[]>('db:populateRole', 3).as('roles');
    });

    it('searches by substring', () => {
      cy.request({ url: optionsUrl('role', '?q=Role%202'), headers: { 'X-API-Key': TEST_API_KEY } }).then((res) => {
        expect(res.status).to.eq(200);
        expect((res.body as Row[]).map((r) => r.name)).to.deep.equal(['Role 2']);
      });
    });

    it('looks up records by id and returns only those', function () {
      const roles = this.roles as Row[];
      const ids = [roles[0].id, roles[2].id].join(',');
      cy.request({ url: optionsUrl('role', `?ids=${ids}`), headers: { 'X-API-Key': TEST_API_KEY } }).then((res) => {
        expect(res.status).to.eq(200);
        expect((res.body as Row[]).map((r) => r.id)).to.have.members([roles[0].id, roles[2].id]);
        expect(res.body).to.have.length(2);
      });
    });

    it('returns an empty array for an id that does not exist', () => {
      cy.request({ url: optionsUrl('role', '?ids=does-not-exist'), headers: { 'X-API-Key': TEST_API_KEY } }).then((res) => {
        expect(res.status).to.eq(200);
        expect(res.body).to.deep.equal([]);
      });
    });

    it('honours limit', () => {
      cy.request({ url: optionsUrl('role', '?q=Role&limit=2'), headers: { 'X-API-Key': TEST_API_KEY } }).then((res) => {
        expect(res.status).to.eq(200);
        expect(res.body).to.have.length(2);
      });
    });

    it('rejects a limit outside 1-200 and a non-integer limit', () => {
      for (const limit of ['0', '201', '-1', 'abc', '1.5']) {
        cy.request({ url: optionsUrl('role', `?limit=${limit}`), headers: { 'X-API-Key': TEST_API_KEY }, failOnStatusCode: false })
          .its('status')
          .should('eq', 400);
      }
    });

    it('rejects more than 200 ids', () => {
      const ids = Array.from({ length: 201 }, (_, i) => `id${i}`).join(',');
      cy.request({ url: optionsUrl('role', `?ids=${ids}`), headers: { 'X-API-Key': TEST_API_KEY }, failOnStatusCode: false })
        .its('status')
        .should('eq', 400);
    });

    it('rejects a caller that is not an entity name and a context that is not a JSON object', () => {
      for (const query of ['?caller=Role', '?caller=a;b', '?context=%5B1%5D', '?context=not-json']) {
        cy.request({ url: optionsUrl('role', query), headers: { 'X-API-Key': TEST_API_KEY }, failOnStatusCode: false })
          .its('status')
          .should('eq', 400);
      }
    });

    it('returns the row shape of the entity itself', function () {
      const roles = this.roles as Row[];
      cy.request({ url: optionsUrl('role', `?ids=${roles[0].id}`), headers: { 'X-API-Key': TEST_API_KEY } }).then((picked) => {
        cy.request({ url: `/api/role/${roles[0].id}`, headers: { 'X-API-Key': TEST_API_KEY } }).then((detail) => {
          const [row] = picked.body as Record<string, unknown>[];
          expect(row.id).to.eq(roles[0].id);
          expect(row.name).to.eq((detail.body as Row).name);
          expect(Object.keys(row)).to.include.members(['id', 'name']);
        });
      });
    });
  });

  describe('permission', () => {
    it('answers 403 when the caller cannot read the target entity', () => {
      cy.task<Row[]>('db:populateRole', 1);
      cy.task<string>('db:createApiUserWithPermission', {
        entityName: 'permission',
        flags: { read: true },
        label: 'optionsdenied',
      }).then((apiKey) => {
        cy.request({ url: optionsUrl('role'), headers: { 'X-API-Key': apiKey }, failOnStatusCode: false }).then((res) => {
          expect(res.status).to.eq(403);
          expect(res.body).to.not.be.an('array');
        });
      });
    });

    it('answers 200 when the caller can read the target entity', () => {
      cy.task<Row[]>('db:populateRole', 1);
      cy.task<string>('db:createApiUserWithPermission', {
        entityName: 'role',
        flags: { read: true },
        label: 'optionsallowed',
      }).then((apiKey) => {
        cy.request({ url: optionsUrl('role'), headers: { 'X-API-Key': apiKey } }).its('status').should('eq', 200);
      });
    });

    it('answers 403 for an organization picker when the caller cannot read organization', () => {
      cy.task<string>('db:createApiUserWithPermission', {
        entityName: 'role',
        flags: { read: true },
        label: 'optionsorgdenied',
      }).then((apiKey) => {
        cy.request({ url: optionsUrl('organization'), headers: { 'X-API-Key': apiKey }, failOnStatusCode: false })
          .its('status')
          .should('eq', 403);
      });
    });
  });

  describe('organization isolation', () => {
    it('the organization picker returns only organizations the caller belongs to', () => {
      cy.task<any>('db:createCrossOrgScenario', { entityName: 'options' }).then((scenario) => {
        const ids = `${scenario.orgA.id},${scenario.orgB.id}`;
        cy.request({ url: optionsUrl('organization', `?ids=${ids}`), headers: { 'X-API-Key': TEST_API_KEY } }).then((res) => {
          expect(res.status).to.eq(200);
          expect((res.body as Row[]).map((r) => r.id)).to.deep.equal([scenario.orgA.id]);
        });
      });
    });

    it('the organization picker never matches a search against an organization the caller is not in', () => {
      cy.task<any>('db:createCrossOrgScenario', { entityName: 'optionssearch' }).then(() => {
        cy.request({ url: optionsUrl('organization', '?q=CrossOrgB_optionssearch'), headers: { 'X-API-Key': TEST_API_KEY } }).then((res) => {
          expect(res.status).to.eq(200);
          expect(res.body).to.deep.equal([]);
        });
        cy.request({ url: optionsUrl('organization', '?q=CrossOrgA_optionssearch'), headers: { 'X-API-Key': TEST_API_KEY } }).then((res) => {
          expect(res.status).to.eq(200);
          expect(res.body).to.have.length(1);
        });
      });
    });

    it('the same holds through a mobile access token', () => {
      cy.task<any>('db:createCrossOrgScenario', { entityName: 'optionsmobile' }).then((scenario) => {
        cy.request('POST', '/api/mobile/auth/token', {
          email: TEST_CREDENTIALS.email,
          password: TEST_CREDENTIALS.password,
        }).then((login) => {
          const accessToken = (login.body as { access_token: string }).access_token;
          const ids = `${scenario.orgA.id},${scenario.orgB.id}`;
          cy.request({ url: optionsUrl('organization', `?ids=${ids}`), headers: { Authorization: `Bearer ${accessToken}` } }).then((res) => {
            expect((res.body as Row[]).map((r) => r.id)).to.deep.equal([scenario.orgA.id]);
          });
        });
      });
    });

    // An entity with an organization column is covered by its generated spec (G3.5 in
    // cypress/e2e/api/<entity>.cy.ts), because which entities carry that column depends on the schema.
  });

  describe('invalidated records', () => {
    it('does not offer a user that was invalidated', () => {
      cy.task<Row[]>('db:populateUser', 2).then((users) => {
        cy.request({
          method: 'POST',
          url: `/api/user/${users[0].id}/actions/invalidate`,
          headers: { 'X-API-Key': TEST_API_KEY },
        }).its('status').should('eq', 200);
        const ids = `${users[0].id},${users[1].id}`;
        cy.request({ url: optionsUrl('user', `?ids=${ids}`), headers: { 'X-API-Key': TEST_API_KEY } }).then((res) => {
          expect(res.status).to.eq(200);
          expect((res.body as Row[]).map((r) => r.id)).to.deep.equal([users[1].id]);
        });
      });
    });
  });
});
