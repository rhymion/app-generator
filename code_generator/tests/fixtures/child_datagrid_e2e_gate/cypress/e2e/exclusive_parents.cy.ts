import { TEST_API_KEY, TEST_CREDENTIALS } from '../../support/test-credentials';
import { editDataGridCell, getDataGridCell } from '../../support/datagrid-helpers';

const headers = { 'X-API-Key': TEST_API_KEY };
const CHILD = 'Excl Links';

// excl_link declares x-exclusive-parents: [excl_alpha, excl_beta]. Each row has
// exactly one of excl_alpha_id / excl_beta_id; placed_alpha_id is a further FK
// to excl_alpha that is not a parent link. On a parent's screens the grid hides
// the OTHER parent's FK column and keeps everything else; the child's own pages
// keep both parent columns.
type Ids = { alphaId: string; betaId: string };

function column(field: string) {
  return cy.contains('h2', CHILD).parent().find(`[role="columnheader"][data-field="${field}"]`);
}

function expectGridColumns(shown: string[], hidden: string[]) {
  cy.contains('h2', CHILD).should('be.visible');
  shown.forEach((field) => column(field).should('exist'));
  hidden.forEach((field) => column(field).should('not.exist'));
}

function findByName(entity: string, name: string) {
  return cy.request({ url: `/api/${entity}`, headers }).then((r) => cy.wrap(r.body.rows.find((x: any) => x.name === name)));
}

function putChildren(entity: string, id: string, links: any[]) {
  return cy.request({ url: `/api/${entity}/${id}`, headers }).then((cur) =>
    cy.request({ method: 'PUT', url: `/api/${entity}/${id}`, headers, body: { ...cur.body, excl_links: links } }),
  );
}

// Seeds one alpha (with a row owned by it) and one beta (with a row owned by it).
function seed(): Cypress.Chainable<Ids> {
  cy.viewport(3000, 1000);
  cy.task('db:reset');
  cy.task('db:seed');
  cy.task('db:grantAllPermissions');
  Cypress.session.clearAllSavedSessions();
  cy.clearCookies();
  cy.visit('/en/');
  cy.login(TEST_CREDENTIALS.email, TEST_CREDENTIALS.password);
  cy.request({ method: 'POST', url: '/api/excl_alpha', headers, body: { name: 'Alpha One', excl_links: [] } });
  cy.request({ method: 'POST', url: '/api/excl_beta', headers, body: { name: 'Beta One', excl_links: [] } });
  return findByName('excl_alpha', 'Alpha One').then((alpha: any) =>
    findByName('excl_beta', 'Beta One').then((beta: any) => {
      putChildren('excl_alpha', alpha.id, [{ name: 'alpha row', placed_alpha_id: alpha.id }]);
      putChildren('excl_beta', beta.id, [{ name: 'beta row', placed_alpha_id: alpha.id }]);
      return cy.wrap({ alphaId: alpha.id, betaId: beta.id });
    }),
  );
}

describe('x-exclusive-parents: the grid on a parent screen hides the other parent FK column', () => {
  let ids: Ids;
  beforeEach(() => {
    seed().then((v) => (ids = v));
  });

  it('excl_alpha view, edit and new screens: no excl_beta_id column, placed_alpha_id kept', () => {
    cy.visit(`/en/excl_alpha/view/${ids.alphaId}`);
    expectGridColumns(['name', 'placed_alpha_id'], ['excl_beta_id', 'excl_alpha_id']);
    cy.visit(`/en/excl_alpha/edit/${ids.alphaId}`);
    expectGridColumns(['name', 'placed_alpha_id'], ['excl_beta_id', 'excl_alpha_id']);
    cy.visit('/en/excl_alpha/new');
    cy.clickButton(`Add ${CHILD}`);
    expectGridColumns(['name', 'placed_alpha_id'], ['excl_beta_id', 'excl_alpha_id']);
  });

  it('excl_beta view, edit and new screens: no excl_alpha_id column, placed_alpha_id kept', () => {
    cy.visit(`/en/excl_beta/view/${ids.betaId}`);
    expectGridColumns(['name', 'placed_alpha_id'], ['excl_alpha_id', 'excl_beta_id']);
    cy.visit(`/en/excl_beta/edit/${ids.betaId}`);
    expectGridColumns(['name', 'placed_alpha_id'], ['excl_alpha_id', 'excl_beta_id']);
    cy.visit('/en/excl_beta/new');
    cy.clickButton(`Add ${CHILD}`);
    expectGridColumns(['name', 'placed_alpha_id'], ['excl_alpha_id', 'excl_beta_id']);
  });

  it('the non-parent FK shows its label in the grid', () => {
    cy.visit(`/en/excl_beta/view/${ids.betaId}`);
    getDataGridCell(0, 'placed_alpha_id', CHILD).should('contain.text', 'Alpha One');
  });

  it("the child's own list page keeps both parent FK columns", () => {
    // excl_link is not an independent entity, so the shared grant does not cover it.
    cy.task<string>('db:createSessionUserWithPermission', { entityName: 'excl_link', flags: { read: true }, label: 'list' }).then((email) => {
      Cypress.session.clearAllSavedSessions();
      cy.clearCookies();
      cy.visit('/en/');
      cy.login(email, TEST_CREDENTIALS.password);
    });
    cy.visit('/en/excl_link');
    ['excl_alpha_id', 'excl_beta_id', 'placed_alpha_id'].forEach((field) =>
      cy.get(`[role="columnheader"][data-field="${field}"]`).should('exist'),
    );
  });
});

describe('x-exclusive-parents: rows written from a parent screen set only that parent FK', () => {
  let ids: Ids;
  beforeEach(() => {
    seed().then((v) => (ids = v));
  });

  it('adding a row on the excl_alpha edit screen fills excl_alpha_id and leaves excl_beta_id NULL', () => {
    cy.visit(`/en/excl_alpha/edit/${ids.alphaId}`);
    cy.clickButton(`Add ${CHILD}`);
    editDataGridCell(1, 'name', 'added from alpha', true, CHILD);
    cy.clickButton('Save');
    cy.url().should('not.include', '/edit');
    cy.request({ url: `/api/excl_alpha/${ids.alphaId}`, headers }).then((res) => {
      const row = res.body.excl_links.find((l: any) => l.name === 'added from alpha');
      expect(row.excl_alpha_id).to.eq(ids.alphaId);
      expect(row.excl_beta_id).to.be.null;
    });
  });

  it('adding a row on the excl_beta new screen fills excl_beta_id and leaves excl_alpha_id NULL', () => {
    cy.visit('/en/excl_beta/new');
    cy.fillField('Name', 'Beta Two');
    cy.clickButton(`Add ${CHILD}`);
    editDataGridCell(0, 'name', 'added from beta', true, CHILD);
    cy.clickButton('Save');
    cy.url().should('not.include', '/excl_beta/new');
    findByName('excl_beta', 'Beta Two').then((beta: any) =>
      cy.request({ url: `/api/excl_beta/${beta.id}`, headers }).then((res) => {
        expect(res.body.excl_links).to.have.length(1);
        expect(res.body.excl_links[0].excl_beta_id).to.eq(beta.id);
        expect(res.body.excl_links[0].excl_alpha_id).to.be.null;
      }),
    );
  });

  it('editing an existing row from a parent screen leaves the hidden FK unchanged', () => {
    cy.visit(`/en/excl_alpha/edit/${ids.alphaId}`);
    editDataGridCell(0, 'name', 'alpha row edited', true, CHILD);
    cy.clickButton('Save');
    cy.url().should('not.include', '/edit');
    cy.request({ url: `/api/excl_alpha/${ids.alphaId}`, headers }).then((res) => {
      expect(res.body.excl_links).to.have.length(1);
      expect(res.body.excl_links[0].name).to.eq('alpha row edited');
      expect(res.body.excl_links[0].excl_alpha_id).to.eq(ids.alphaId);
      expect(res.body.excl_links[0].excl_beta_id).to.be.null;
    });
  });
});
