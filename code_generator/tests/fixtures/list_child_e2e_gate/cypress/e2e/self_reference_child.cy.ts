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

  // Top -> Mid -> Leaf, and a node with no parent. Editing Leaf: Leaf itself and its
  // ancestors (Mid, Top) are never offered or accepted as its children, which would
  // make a cycle; Top has no parent, so only the ancestor rule keeps it out. Mid
  // already has a parent, which keeps it out for a second reason.
  describe('cycles and nodes that already have a parent', () => {
    let topId: string;
    let midId: string;
    let leafId: string;
    let freeId: string;

    const parentOf = (id: string) =>
      cy.request({ url: `/api/lc_node/${id}`, headers }).its('body.lc_node_id');

    beforeEach(() => {
      cy.request({ method: 'POST', url: '/api/lc_node', headers, body: { name: 'Top Node', kids_ids: [] } })
        .its('body.id').then((id) => { topId = id; });
      cy.then(() => cy.request({ method: 'POST', url: '/api/lc_node', headers, body: { name: 'Mid Node', lc_node_id: topId, kids_ids: [] } }))
        .its('body.id').then((id) => { midId = id; });
      cy.then(() => cy.request({ method: 'POST', url: '/api/lc_node', headers, body: { name: 'Leaf Two', lc_node_id: midId, kids_ids: [] } }))
        .its('body.id').then((id) => { leafId = id; });
      cy.request({ method: 'POST', url: '/api/lc_node', headers, body: { name: 'Free Node', kids_ids: [] } })
        .its('body.id').then((id) => { freeId = id; });
    });

    it('does not offer the node, its ancestors, or a node that has a parent; a free node is offered', () => {
      cy.visit(`/en/lc_node/edit/${leafId}`);
      cy.clickButton('Add Kids');
      ['Top Node', 'Mid Node', 'Leaf Two', 'Leaf Node'].forEach((name) => {
        cy.get('div[role="dialog"]').find('input').clear().type(name);
        cy.get('.MuiAutocomplete-popper').should('be.visible');
        cy.get('.MuiAutocomplete-popper').should('not.contain', name);
      });
      cy.get('div[role="dialog"]').find('input').clear().type('Free Node');
      cy.get('.MuiAutocomplete-popper li').contains('Free Node').should('be.visible');
    });

    it('rejects the node itself, an ancestor and a node with another parent over the REST route', () => {
      [leafId, topId, midId].forEach((kid) => {
        cy.request({
          method: 'PUT', url: `/api/lc_node/${leafId}`, headers, failOnStatusCode: false,
          body: { name: 'Leaf Two', lc_node_id: midId, kids_ids: [kid] },
        }).its('status').should('be.within', 400, 499);
      });
      parentOf(topId).should('eq', null);
      parentOf(midId).should('eq', topId);
      parentOf(leafId).should('eq', midId);
    });

    // Adds Free Node through the picker, then swaps the id in the `kid[]` field of the
    // Server Action request for `sentId`, the way a client that bypasses the picker would.
    const saveSending = (sentId: string) => {
      cy.intercept('POST', `**/lc_node/edit/${'*'}`, (req) => {
        if (!req.headers['next-action']) return;
        const body = typeof req.body === 'string' ? req.body : new TextDecoder().decode(req.body as ArrayBuffer);
        // The picker's search calls reach the same URL; only the save carries `kid[]`.
        if (!/name="[^"]*kid\[\]"/.test(body)) return;
        req.alias = 'save';
        req.body = body.split(`"id":"${freeId}"`).join(`"id":"${sentId}"`);
      });
      cy.visit(`/en/lc_node/edit/${leafId}`);
      cy.clickButton('Add Kids');
      cy.get('div[role="dialog"]').find('input').type('Free Node');
      cy.get('.MuiAutocomplete-popper li').contains('Free Node').click();
      cy.get('div[role="dialog"]').find('button').contains('Add').click();
      cy.clickButton('Save');
      cy.wait('@save').then((i) => {
        expect(String(i.request.body)).to.include(`"id":"${sentId}"`);
      });
    };

    it('control: the server action attaches a node without a parent', () => {
      saveSending(freeId);
      cy.url().should('not.include', `/lc_node/edit/${leafId}`);
      parentOf(freeId).should('eq', leafId);
    });

    it('rejects an ancestor sent through the server action behind the parent screen', () => {
      saveSending(topId);
      cy.url().should('include', `/lc_node/edit/${leafId}`);
      parentOf(topId).should('eq', null);
      parentOf(freeId).should('eq', null);
    });

    it('accepts a node without a parent over the REST route', () => {
      cy.request({
        method: 'PUT', url: `/api/lc_node/${leafId}`, headers,
        body: { name: 'Leaf Two', lc_node_id: midId, kids_ids: [freeId] },
      }).its('status').should('eq', 200);
      parentOf(freeId).should('eq', leafId);
    });
  });
});
