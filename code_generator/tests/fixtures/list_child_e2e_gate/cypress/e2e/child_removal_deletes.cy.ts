import { TEST_CREDENTIALS, TEST_API_KEY } from '../../support/test-credentials';

const headers = { 'X-API-Key': TEST_API_KEY };

// A child whose link to the parent is required (no pages of its own, or only
// read-only pages) is always attached to its parent, so taking it out of the
// parent's list is deleting the record itself.
describe('removing a child that is always attached to its parent', () => {
  beforeEach(() => {
    cy.task('db:reset');
    cy.task('db:seed');
    cy.task('db:grantAllPermissions');
    Cypress.session.clearAllSavedSessions();
    cy.clearCookies();
    cy.visit('/en/');
    cy.login(TEST_CREDENTIALS.email, TEST_CREDENTIALS.password);
  });

  it('deletes a child with read-only pages when it is removed from the parent screen', () => {
    cy.request({
      method: 'POST', url: '/api/lc_ro_parent', headers,
      body: { name: 'Ro Parent', kids: [{ name: 'Ro Kid A' }, { name: 'Ro Kid B' }] },
    }).its('body.id').then((parentId) => {
      cy.request({ url: `/api/lc_ro_parent/${parentId}`, headers }).its('body.kids').then((kids) => {
        const a = kids.find((k: { name: string }) => k.name === 'Ro Kid A').id;
        const b = kids.find((k: { name: string }) => k.name === 'Ro Kid B').id;
        cy.visit(`/en/lc_ro_parent/edit/${parentId}`);
        cy.contains('li', 'Ro Kid A').find('button[aria-label="delete"]').click();
        cy.clickButton('Save');
        cy.url().should('not.include', '/lc_ro_parent/edit');
        cy.request({ url: `/api/lc_ro_child/${a}`, headers, failOnStatusCode: false })
          .its('status').should('eq', 404);
        cy.request({ url: `/api/lc_ro_child/${b}`, headers }).its('status').should('eq', 200);
      });
    });
  });

  it('removes a child without pages from the parent, leaving the other child', () => {
    cy.request({
      method: 'POST', url: '/api/lc_plain_parent', headers,
      body: { name: 'Plain Parent B', kids: [{ name: 'Plain Gone' }, { name: 'Plain Stays' }] },
    }).its('body.id').then((parentId) => {
      cy.visit(`/en/lc_plain_parent/edit/${parentId}`);
      cy.contains('li', 'Plain Gone').find('button[aria-label="delete"]').click();
      cy.clickButton('Save');
      cy.url().should('not.include', '/lc_plain_parent/edit');
      cy.request({ url: `/api/lc_plain_parent/${parentId}`, headers }).its('body.kids').then((kids) => {
        expect(kids.map((k: { name: string }) => k.name)).to.deep.eq(['Plain Stays']);
      });
    });
  });

  it('creates a child with read-only pages by typing its text on the parent screen', () => {
    cy.visit('/en/lc_ro_parent/new');
    cy.clearAndFillField('Name', 'Typed Ro Parent');
    cy.clickButton('Add Kids');
    cy.get('div[role="dialog"]').find('input').type('Typed Ro Kid');
    cy.get('div[role="dialog"]').find('button').contains('Add').click();
    cy.clickButton('Save');
    cy.url().should('not.include', '/lc_ro_parent/new');
    // The record was created with the child; the parent's view screen shows it.
    cy.visit('/en/lc_ro_parent');
    cy.contains('.MuiDataGrid-cell', 'Typed Ro Parent').find('a').first().click();
    cy.url().should('include', '/lc_ro_parent/view/');
    cy.contains('Typed Ro Kid').should('be.visible');
  });
});
