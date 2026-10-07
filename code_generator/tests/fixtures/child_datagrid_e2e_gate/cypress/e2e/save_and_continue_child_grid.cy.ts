import { TEST_CREDENTIALS, TEST_API_KEY } from '../../support/test-credentials';
import { editDataGridCell, getDataGridCell, selectDataGridSingleSelect } from '../../support/datagrid-helpers';

const CHILD = 'Parent Only Probes';
const headers = { 'X-API-Key': TEST_API_KEY };

// parent_only embeds parent_only_probe (no x-generate of its own: an inline
// editable DataGrid). Columns: every type x required/nullable, and FKs to the
// parent's own model (parent_only) and to another model (parent1) with each
// label form: plain, composite, dotted, composite+dotted.
const FK_LABELS: Record<string, string> = {
  same_plain_id: 'Target PO',
  same_comp_id: 'Target PO po desc',
  same_dot_id: 'Owner One',
  same_cd_id: 'Target PO Owner One',
  other_plain_id: 'Owner One',
  other_comp_id: 'Owner One owner desc',
  other_dot_id: 'Test Organization A',
  other_cd_id: 'Owner One Test Organization A',
};

function seed() {
  cy.viewport(6000, 1000);
  cy.task('db:reset');
  cy.task('db:seed');
  cy.task('db:grantAllPermissions');
  Cypress.session.clearAllSavedSessions();
  cy.clearCookies();
  cy.visit('/en/');
  cy.login(TEST_CREDENTIALS.email, TEST_CREDENTIALS.password);
  cy.task<any>('db:populateParent1Dependencies').then((deps) => {
    cy.task<any[]>('db:populateParent1', 1).then(([p1]) => {
      cy.request({ method: 'GET', url: `/api/parent1/${p1.id}`, headers }).then((cur) => {
        cy.request({
          method: 'PUT', url: `/api/parent1/${p1.id}`, headers,
          body: { ...cur.body, name: 'Owner One', description: 'owner desc', organization_id: deps.organization.id,
                  parent1_child1s: [], parent1_child2s: [], parent1_lists: [] },
        });
      });
      cy.request({
        method: 'POST', url: '/api/parent_only', headers,
        body: { name: 'Target PO', description: 'po desc', owner_id: p1.id, parent_only_probes: [] },
      });
    });
  });
}

type Skip = string | undefined;

// Fill one probe row. `skip` leaves one required column empty; `nullables`
// also fills every nullable column.
function fillProbeRow(rowIndex: number, skip: Skip, nullables: boolean) {
  const pick = (field: string, label: string, value?: string) =>
    selectDataGridSingleSelect(rowIndex, field, label, value, CHILD);
  if (skip !== 'same_req_id') pick('same_req_id', 'Target PO');
  if (skip !== 'other_req_id') pick('other_req_id', 'Owner One');
  if (skip !== 'enum_req') pick('enum_req', 'String', 'string');
  if (nullables) {
    Object.entries(FK_LABELS).forEach(([field, label]) => pick(field, label));
    pick('enum_null', 'Number', 'number');
  }
  const text: Record<string, string> = {};
  if (skip !== 'str_req') text.str_req = 'text required';
  if (skip !== 'int_req') text.int_req = '7';
  if (skip !== 'dec_req') text.dec_req = '12.50';
  if (skip !== 'date_req') text.date_req = '2025-01-16';
  if (skip !== 'dt_req') text.dt_req = '2025-01-16T09:30';
  if (nullables) {
    text.str_null = 'text nullable';
    text.int_null = '9';
    text.dec_null = '3.25';
    text.date_null = '2025-02-01';
    text.dt_null = '2025-02-01T10:15';
  }
  const fields = Object.keys(text);
  fields.forEach((f, i) => editDataGridCell(rowIndex, f, text[f], i === fields.length - 1, CHILD));
}

const CONTINUE = 'Save and continue editing';

function probeCount(parentId: string) {
  return cy.request({ url: `/api/parent_only/${parentId}`, headers }).then((r) => (r.body.parent_only_probes as unknown[]).length);
}

// "Save and continue editing" (issue #832) on an entity with an embedded editable child grid.
// After a continue-save the edit page rebuilds the form from the saved record. Without
// that, a row added in the grid would keep its temporary id and the next save would
// create it a second time.
describe('save and continue editing: inline child grid', () => {
  beforeEach(seed);

  it('creates a parent with a grid row and continues on /edit/[id] showing that row once', () => {
    cy.visit('/en/parent_only/new');
    cy.fillField('Name', 'Parent Continue');
    cy.clickButton(`Add ${CHILD}`);
    fillProbeRow(0, undefined, false);
    cy.clickButton(CONTINUE);
    cy.url().should('match', /\/parent_only\/edit\/[a-z0-9]+$/);
    getDataGridCell(0, 'str_req', CHILD).should('contain.text', 'text required');
    cy.url().then((url) => {
      const id = url.split('/').pop() as string;
      probeCount(id).should('eq', 1);
    });
  });

  it('a row added on the edit screen is stored once however many continue-saves follow', () => {
    cy.visit('/en/parent_only/new');
    cy.fillField('Name', 'Parent Repeat');
    cy.clickButton(`Add ${CHILD}`);
    fillProbeRow(0, undefined, false);
    cy.clickButton(CONTINUE);
    cy.url().should('match', /\/parent_only\/edit\/[a-z0-9]+$/);
    getDataGridCell(0, 'str_req', CHILD).should('contain.text', 'text required');
    cy.url().then((editUrl) => {
      const id = editUrl.split('/').pop() as string;
      // Add a second row, then continue-save twice from the same screen.
      cy.clickButton(`Add ${CHILD}`);
      fillProbeRow(1, undefined, false);
      cy.clickButton(CONTINUE);
      cy.url().should('match', /\?saved=\d+$/).then((firstSaved) => {
        probeCount(id).should('eq', 2);
        getDataGridCell(1, 'str_req', CHILD).should('contain.text', 'text required');
        cy.clickButton(CONTINUE);
        cy.url().should('match', /\?saved=\d+$/).and('not.eq', firstSaved);
        probeCount(id).should('eq', 2);
      });
    });
  });
});
