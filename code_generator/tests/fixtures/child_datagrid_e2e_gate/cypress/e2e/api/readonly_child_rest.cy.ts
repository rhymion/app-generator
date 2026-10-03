import { TEST_API_KEY } from '../../../support/test-credentials';

const API_BASE = '/api/parent1';
const headers = { 'X-API-Key': TEST_API_KEY };

// parent1_child2 is a read-only child (new/edit/delete false): the parent's
// REST route must still create, update and delete its rows.
describe('API: read-only child rows are written through the parent', () => {
  beforeEach(() => {
    cy.task('db:reset');
    cy.task('db:seed');
    cy.task('db:grantAllPermissions');
  });

  it('creates, updates and deletes child rows via POST/PUT', () => {
    cy.task('db:populateParent1Dependencies');
    cy.request({
      method: 'POST', url: API_BASE, headers,
      body: {
        name: 'REST Parent', price: 100, due_date: '2025-01-15T09:00:00.000Z',
        parent1_child1s: [],
        parent1_child2s: [{ name: 'REST Child A', end_date: '2025-01-16T00:00:00.000Z' }],
        parent1_lists: [],
      },
    }).then((created) => {
      expect(created.status).to.eq(201);
      const id = created.body.id;
      cy.request({ url: `${API_BASE}/${id}`, headers }).then((res) => {
        expect(res.body.parent1_child2s.map((c: any) => c.name)).to.deep.eq(['REST Child A']);
        const row = res.body.parent1_child2s[0];
        cy.request({
          method: 'PUT', url: `${API_BASE}/${id}`, headers,
          body: {
            name: 'REST Parent', price: 100, due_date: '2025-01-15T09:00:00.000Z',
            parent1_child1s: [],
            parent1_child2s: [{ id: row.id, name: 'REST Child B', end_date: '2025-01-16T00:00:00.000Z' }],
            parent1_lists: [],
          },
        }).then((put) => {
          expect(put.status).to.be.oneOf([200, 204]);
          cy.request({ url: `${API_BASE}/${id}`, headers }).then((after) => {
            expect(after.body.parent1_child2s.map((c: any) => c.name)).to.deep.eq(['REST Child B']);
            cy.request({
              method: 'PUT', url: `${API_BASE}/${id}`, headers,
              body: {
                name: 'REST Parent', price: 100, due_date: '2025-01-15T09:00:00.000Z',
                parent1_child1s: [], parent1_child2s: [], parent1_lists: [],
              },
            }).then(() => {
              cy.request({ url: `${API_BASE}/${id}`, headers }).then((gone) => {
                expect(gone.body.parent1_child2s).to.have.length(0);
              });
            });
          });
        });
      });
    });
  });
});
