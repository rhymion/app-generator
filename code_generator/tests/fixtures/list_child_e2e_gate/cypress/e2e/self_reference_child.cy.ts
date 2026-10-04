import { TEST_CREDENTIALS, TEST_API_KEY } from '../../support/test-credentials';

const headers = { 'X-API-Key': TEST_API_KEY };

// lc_node: the child entity is the parent entity (self-reference), editable
// pages, nullable link. The parent screen lists the node's children, takes one
// out and adds one back; the node taken out stays as a record, and a node is
// never offered as its own child.
describe('self-referencing list child', () => {
  let rootId: string;
  let childId: string;

  beforeEach(() => {
    cy.task('db:reset');
    cy.task('db:seed');
    cy.task('db:grantAllPermissions');
    Cypress.session.clearAllSavedSessions();
    cy.clearCookies();
    cy.visit('/en/');
    cy.login(TEST_CREDENTIALS.email, TEST_CREDENTIALS.password);
    cy.request({ method: 'POST', url: '/api/lc_node', headers, body: { name: 'Root Node', kids_ids: [] } })
      .its('body.id').then((id) => {
        rootId = id;
        cy.request({
          method: 'POST', url: '/api/lc_node', headers,
          body: { name: 'Leaf Node', lc_node_id: id, kids_ids: [] },
        }).its('body.id').then((kid) => { childId = kid; });
      });
  });

  it('shows the children of a node', () => {
    cy.visit(`/en/lc_node/view/${rootId}`);
    cy.contains('Leaf Node').should('be.visible');
    cy.visit(`/en/lc_node/view/${childId}`);
    cy.checkField('Name', 'Leaf Node');
  });

  it('takes a child out, keeps the record, adds it back, and never offers the node itself', () => {
    cy.visit(`/en/lc_node/edit/${rootId}`);
    cy.contains('li', 'Leaf Node').find('button[aria-label="delete"]').click();
    cy.clickButton('Save');
    cy.url().should('not.include', '/lc_node/edit');
    cy.visit(`/en/lc_node/view/${rootId}`);
    cy.contains('Leaf Node').should('not.exist');
    cy.request({ url: `/api/lc_node/${childId}`, headers }).then((res) => {
      expect(res.status).to.eq(200);
      expect(res.body.name).to.eq('Leaf Node');
      expect(res.body.lc_node_id).to.eq(null);
    });

    cy.visit(`/en/lc_node/edit/${rootId}`);
    cy.clickButton('Add Kids');
    cy.get('div[role="dialog"]').find('input').type('Root');
    cy.get('.MuiAutocomplete-popper').should('not.contain', 'Root Node');
    cy.get('div[role="dialog"]').find('input').clear().type('Leaf Node');
    cy.get('.MuiAutocomplete-popper li').contains('Leaf Node').click();
    cy.get('div[role="dialog"]').find('button').contains('Add').click();
    cy.clickButton('Save');
    cy.url().should('not.include', '/lc_node/edit');
    cy.visit(`/en/lc_node/view/${rootId}`);
    cy.contains('Leaf Node').should('be.visible');
  });
});
