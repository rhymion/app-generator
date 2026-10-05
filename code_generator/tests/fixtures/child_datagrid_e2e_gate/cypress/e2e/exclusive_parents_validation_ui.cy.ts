import { TEST_API_KEY, TEST_CREDENTIALS } from '../../support/test-credentials';
import { editDataGridCell } from '../../support/datagrid-helpers';

const headers = { 'X-API-Key': TEST_API_KEY };
const CHILD = 'Excl Links';
const MISSING = 'Exactly one of excl_alpha_id, excl_beta_id must be set.';
const INVALID = 'Only one of excl_alpha_id, excl_beta_id can be set; the others must be empty.';

// x-exclusive-parents [excl_alpha, excl_beta]: a save must leave exactly one owner FK set.
//   excl_owned has its own new/edit pages, so its form is the standalone screen;
//   excl_link is written from the parents' screens (embedded grid), so the parent's form is
//   the screen that reports a rejection.
// The message is the form-level banner under the page title (the form's `error` state), above
// the fields and outside the <form> element: neither screen attaches it to a field.
type Ids = { alphaId: string; betaId: string };

function create(entity: string, body: object): Cypress.Chainable<string> {
  return cy.request({ method: 'POST', url: `/api/${entity}`, headers, body }).then((r) => r.body.id as string);
}

function expectFormBanner(message: string) {
  cy.contains(message).should('be.visible').parents('form').should('have.length', 0);
}

function seed(): Cypress.Chainable<Ids> {
  cy.viewport(3000, 1000);
  cy.task('db:reset');
  cy.task('db:seed');
  cy.task('db:grantAllPermissions');
  // excl_owned is not generated with test: true, so the shared grant does not cover it.
  cy.task('db:grantExclOwnedPermission');
  Cypress.session.clearAllSavedSessions();
  cy.clearCookies();
  cy.visit('/en/');
  cy.login(TEST_CREDENTIALS.email, TEST_CREDENTIALS.password);
  return create('excl_alpha', { name: 'Alpha One', excl_links: [], excl_owneds: [] }).then((alphaId) =>
    create('excl_beta', { name: 'Beta One', excl_links: [], excl_owneds: [] }).then((betaId) => ({ alphaId, betaId })),
  );
}

describe('x-exclusive-parents: the standalone form of a child with its own pages (excl_owned)', () => {
  let ids: Ids;
  beforeEach(() => {
    seed().then((v) => (ids = v));
  });

  it('new: no owner shows the missing message and saves nothing', () => {
    cy.visit('/en/excl_owned/new');
    cy.fillField('Name', 'no owner');
    cy.clickButton('Save');
    expectFormBanner(MISSING);
    cy.url().should('include', '/excl_owned/new');
    cy.request({ url: '/api/excl_owned', headers }).then((r) => expect(r.body.rows).to.have.length(0));
  });

  it('new: both owners shows the invalid message; dropping one then saves', () => {
    cy.visit('/en/excl_owned/new');
    cy.fillField('Name', 'two owners');
    cy.selectAutocomplete('Excl Alpha', 'Alpha One');
    cy.selectAutocomplete('Excl Beta', 'Beta One');
    cy.clickButton('Save');
    expectFormBanner(INVALID);
    cy.url().should('include', '/excl_owned/new');
    cy.clearAutocomplete('Excl Beta');
    cy.clickButton('Save');
    cy.url().should('not.include', '/new');
    cy.request({ url: '/api/excl_owned', headers }).then((r) => {
      expect(r.body.rows).to.have.length(1);
      expect(r.body.rows[0].excl_alpha_id).to.eq(ids.alphaId);
      expect(r.body.rows[0].excl_beta_id).to.be.null;
    });
  });

  it('edit: adding a second owner is rejected, clearing the only owner is rejected, moving it is accepted', () => {
    create('excl_owned', { name: 'row', excl_alpha_id: ids.alphaId }).then((rowId) => {
      cy.visit(`/en/excl_owned/edit/${rowId}`);
      cy.selectAutocomplete('Excl Beta', 'Beta One');
      cy.clickButton('Save');
      expectFormBanner(INVALID);
      cy.url().should('include', '/edit');

      cy.visit(`/en/excl_owned/edit/${rowId}`);
      cy.clearAutocomplete('Excl Alpha');
      cy.clickButton('Save');
      expectFormBanner(MISSING);
      cy.url().should('include', '/edit');
      cy.request({ url: `/api/excl_owned/${rowId}`, headers }).then((r) => {
        expect(r.body.excl_alpha_id).to.eq(ids.alphaId);
        expect(r.body.excl_beta_id).to.be.null;
      });

      cy.visit(`/en/excl_owned/edit/${rowId}`);
      cy.clearAutocomplete('Excl Alpha');
      cy.selectAutocomplete('Excl Beta', 'Beta One');
      cy.clickButton('Save');
      cy.url().should('not.include', '/edit');
      cy.request({ url: `/api/excl_owned/${rowId}`, headers }).then((r) => {
        expect(r.body.excl_alpha_id).to.be.null;
        expect(r.body.excl_beta_id).to.eq(ids.betaId);
      });
    });
  });
});

describe("x-exclusive-parents: a parent screen that saves a child row (excl_link) reports the rejection on the parent's form", () => {
  let ids: Ids;
  beforeEach(() => {
    seed().then((v) => (ids = v));
  });

  it('a row that already holds both owners is rejected when its parent is saved, and stays unchanged', () => {
    cy.task<string>('db:insertExclLinkWithBothOwners', { name: 'legacy', alphaId: ids.alphaId, betaId: ids.betaId }).then((rowId) => {
      cy.visit(`/en/excl_alpha/edit/${ids.alphaId}`);
      editDataGridCell(0, 'name', 'legacy edited', true, CHILD);
      cy.clickButton('Save');
      expectFormBanner(INVALID);
      cy.url().should('include', '/edit');
      cy.request({ url: `/api/excl_alpha/${ids.alphaId}`, headers }).then((res) => {
        const row = res.body.excl_links.find((l: any) => l.id === rowId);
        expect(row.name).to.eq('legacy');
        expect(row.excl_alpha_id).to.eq(ids.alphaId);
        expect(row.excl_beta_id).to.eq(ids.betaId);
      });
    });
  });

  it('a row with a single owner saves from its parent screen as before', () => {
    create('excl_alpha', { name: 'Alpha Rows', excl_links: [], excl_owneds: [] }).then((alphaId) => {
      cy.visit(`/en/excl_alpha/edit/${alphaId}`);
      cy.clickButton(`Add ${CHILD}`);
      editDataGridCell(0, 'name', 'single owner', true, CHILD);
      cy.clickButton('Save');
      cy.url().should('not.include', '/edit');
      cy.request({ url: `/api/excl_alpha/${alphaId}`, headers }).then((res) => {
        expect(res.body.excl_links).to.have.length(1);
        expect(res.body.excl_links[0].excl_alpha_id).to.eq(alphaId);
        expect(res.body.excl_links[0].excl_beta_id).to.be.null;
      });
    });
  });
});
