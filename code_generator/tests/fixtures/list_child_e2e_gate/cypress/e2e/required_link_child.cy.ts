import { TEST_CREDENTIALS, TEST_API_KEY } from '../../support/test-credentials';

const headers = { 'X-API-Key': TEST_API_KEY };

// lc_req_child: own editable pages, one-to-many, REQUIRED link to the parent. A
// child always belongs to a parent, so the parent's list is read-only: no child
// can be added to it or taken out of it from the parent screen, whichever way
// (screen, server action, REST route) the change is sent.
describe('editable list child with a required link', () => {
  let r1: string;
  let r2: string;
  let k1: string;
  let k2: string;

  const belongsTo = (childId: string, parentId: string) =>
    cy.request({ url: `/api/lc_req_child/${childId}`, headers }).then((res) => {
      expect(res.status).to.eq(200);
      expect(res.body.lc_req_parent_id).to.eq(parentId);
    });

  beforeEach(() => {
    cy.task('db:reset');
    cy.task('db:seed');
    cy.task('db:grantAllPermissions');
    Cypress.session.clearAllSavedSessions();
    cy.clearCookies();
    cy.visit('/en/');
    cy.login(TEST_CREDENTIALS.email, TEST_CREDENTIALS.password);
    cy.request({ method: 'POST', url: '/api/lc_req_parent', headers, body: { name: 'Req Parent 1' } })
      .its('body.id').then((id) => { r1 = id; });
    cy.request({ method: 'POST', url: '/api/lc_req_parent', headers, body: { name: 'Req Parent 2' } })
      .its('body.id').then((id) => { r2 = id; });
    cy.then(() => cy.request({ method: 'POST', url: '/api/lc_req_child', headers, body: { name: 'Req Kid 1', lc_req_parent_id: r1 } }))
      .its('body.id').then((id) => { k1 = id; });
    cy.then(() => cy.request({ method: 'POST', url: '/api/lc_req_child', headers, body: { name: 'Req Kid 2', lc_req_parent_id: r2 } }))
      .its('body.id').then((id) => { k2 = id; });
  });

  it('shows the children on the parent screens with no way to add or remove one', () => {
    cy.visit(`/en/lc_req_parent/view/${r1}`);
    cy.contains('Req Kid 1').should('be.visible');
    cy.visit(`/en/lc_req_parent/edit/${r1}`);
    cy.contains('Req Kid 1').should('be.visible');
    cy.get('button[aria-label="delete"]').should('not.exist');
    cy.contains('button', /add kids/i).should('not.exist');
  });

  it('keeps the associations when a save from the parent screen carries a child list', () => {
    cy.intercept('POST', `**/lc_req_parent/edit/${'*'}`, (req) => {
      const type = String(req.headers['content-type'] ?? '');
      const boundary = /boundary=(.+)$/.exec(type)?.[1];
      if (!boundary || !req.headers['next-action']) return;
      const body = typeof req.body === 'string' ? req.body : new TextDecoder().decode(req.body as ArrayBuffer);
      const extra = `--${boundary}\r\nContent-Disposition: form-data; name="kid[]"\r\n\r\n${JSON.stringify({ id: k2, name: 'Req Kid 2' })}\r\n`;
      req.body = body.replace(`--${boundary}--`, `${extra}--${boundary}--`);
    }).as('save');
    cy.visit(`/en/lc_req_parent/edit/${r1}`);
    cy.clearAndFillField('Name', 'Req Parent 1 renamed');
    cy.clickButton('Save');
    cy.wait('@save').then((i) => {
      expect(String(i.request.body)).to.include('name="kid[]"');
    });
    cy.url().should('not.include', '/lc_req_parent/edit');
    belongsTo(k1, r1);
    belongsTo(k2, r2);
  });

  it('ignores a child list sent to the REST route', () => {
    ([{ kids_ids: [k2] }, { kids: [{ id: k2, name: 'Req Kid 2' }] }, { kids: [] }] as object[]).forEach((extra) => {
      cy.request({ method: 'PUT', url: `/api/lc_req_parent/${r1}`, headers, body: { name: 'Req Parent 1', ...extra } })
        .its('status').should('eq', 200);
      belongsTo(k1, r1);
      belongsTo(k2, r2);
    });
    cy.request({ method: 'POST', url: '/api/lc_req_parent', headers, body: { name: 'Req Parent 3', kids_ids: [k2], kids: [{ id: k2 }] } })
      .its('status').should('eq', 201);
    belongsTo(k2, r2);
  });
});
