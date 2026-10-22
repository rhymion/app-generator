import { TEST_API_KEY, TEST_CREDENTIALS } from '../../support/test-credentials';

const headers = { 'X-API-Key': TEST_API_KEY };

// A DataGrid child's FK to the parent's own model (other than the structural
// parent link) must show its label in the parent's view and edit pages.
// parent1_child2.related_parent1_id points at parent1, the model of its parent.
describe('child DataGrid shows a non-parent FK to the parent model', () => {
  beforeEach(() => {
    cy.task('db:reset');
    cy.task('db:seed');
    cy.task('db:grantAllPermissions');
    Cypress.session.clearAllSavedSessions();
    cy.clearCookies();
    cy.visit('/en/');
    cy.login(TEST_CREDENTIALS.email, TEST_CREDENTIALS.password);
  });

  // The child row is written through the parent's REST route (the generated
  // test helper for a child with its own audit columns does not fill them).
  function seedChildWithRelatedParent() {
    return cy.task<any>('db:populateParent1Dependencies').then((deps) =>
      cy.task<any[]>('db:populateParent1', 1).then(([parent]) =>
        cy.request({ url: `/api/parent1/${parent.id}`, headers }).then((current) =>
          cy
            .request({
              method: 'PUT',
              url: `/api/parent1/${parent.id}`,
              headers,
              body: {
                ...current.body,
                parent1_child1s: [],
                parent1_child2s: [
                  {
                    name: 'Parent1 Child2 1',
                    end_date: '2025-01-16T00:00:00.000Z',
                    related_parent1_id: deps.relatedParent1.id,
                  },
                ],
              },
            })
            .then(() => parent),
        ),
      ),
    );
  }

  it('renders the related parent label in the child grid (view page)', () => {
    seedChildWithRelatedParent().then((parent) => {
      cy.visit(`/en/parent1/view/${parent.id}`);
      cy.contains('Parent1 Child2 1').should('be.visible');
      cy.contains('Test Related Parent1 A').should('be.visible');
    });
  });

  it('renders the related parent label in the child grid (edit page)', () => {
    seedChildWithRelatedParent().then((parent) => {
      cy.visit(`/en/parent1/edit/${parent.id}`);
      cy.contains('Parent1 Child2 1').should('be.visible');
      cy.contains('Test Related Parent1 A').should('be.visible');
    });
  });
});
