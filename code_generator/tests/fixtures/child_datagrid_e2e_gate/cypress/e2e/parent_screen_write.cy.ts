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

function openNew() {
  cy.visit('/en/parent_only/new');
  cy.url().should('include', '/parent_only/new');
}

function findParent(name: string) {
  return cy.request({ url: '/api/parent_only', headers }).then((r) => cy.wrap(r.body.rows.find((x: any) => x.name === name) ?? null));
}

function openEdit(name: string) {
  findParent(name).then((row) => {
    expect(row, `parent ${name} exists`).to.not.be.null;
    cy.visit(`/en/parent_only/edit/${row.id}`);
  });
}

describe('parent screen: create and edit an inline child grid', () => {
  beforeEach(seed);

  it('(a)(b) new screen: creates a row with every column; FK labels show in options and after save', () => {
    openNew();
    cy.fillField('Name', 'Parent X');
    cy.clickButton(`Add ${CHILD}`);
    fillProbeRow(0, undefined, true);
    cy.clickButton('Save');
    cy.url().should('not.include', '/parent_only/new');
    openEdit('Parent X');
    cy.contains('h2', CHILD).should('be.visible');
    Object.entries(FK_LABELS).forEach(([field, label]) => {
      getDataGridCell(0, field, CHILD).should('contain.text', label);
    });
    getDataGridCell(0, 'str_req', CHILD).should('contain.text', 'text required');
    getDataGridCell(0, 'int_req', CHILD).should('contain.text', '7');
    getDataGridCell(0, 'dec_req', CHILD).should('contain.text', '12.50');
    getDataGridCell(0, 'str_null', CHILD).should('contain.text', 'text nullable');
  });

  it('(a)(b) edit screen: edits an existing row and the change persists', () => {
    openNew();
    cy.fillField('Name', 'Parent Y');
    cy.clickButton(`Add ${CHILD}`);
    fillProbeRow(0, undefined, false);
    cy.clickButton('Save');
    cy.url().should('not.include', '/parent_only/new');
    openEdit('Parent Y');
    editDataGridCell(0, 'str_req', 'text changed', true, CHILD);
    selectDataGridSingleSelect(0, 'same_comp_id', 'Target PO po desc', undefined, CHILD);
    cy.clickButton('Save');
    cy.url().should('not.include', '/edit');
    openEdit('Parent Y');
    getDataGridCell(0, 'str_req', CHILD).should('contain.text', 'text changed');
    getDataGridCell(0, 'same_comp_id', CHILD).should('contain.text', 'Target PO po desc');
  });

  it('(c) nullable columns may stay empty: a row with only the required columns saves', () => {
    openNew();
    cy.fillField('Name', 'Parent Z');
    cy.clickButton(`Add ${CHILD}`);
    fillProbeRow(0, undefined, false);
    cy.clickButton('Save');
    cy.url().should('not.include', '/parent_only/new');
    findParent('Parent Z').then((row) => expect(row).to.not.be.null);
  });

  // Required columns that start empty on a new row: leave them empty.
  ['str_req', 'same_req_id', 'other_req_id'].forEach((skip) => {
    it(`(c) required column ${skip} left empty: saving is refused and nothing is stored`, () => {
      openNew();
      cy.fillField('Name', `Parent skip ${skip}`);
      cy.clickButton(`Add ${CHILD}`);
      fillProbeRow(0, skip, false);
      cy.clickButton('Save');
      cy.contains('required fields').should('be.visible');
      cy.url().should('include', '/parent_only/new');
      findParent(`Parent skip ${skip}`).then((row) => expect(row).to.be.null);
    });
  });

  // Required columns a new row is seeded for (0, 10.50, now, now): clear them.
  ['int_req', 'dec_req', 'date_req', 'dt_req'].forEach((field) => {
    it(`(c) required column ${field} cleared: saving is refused and nothing is stored`, () => {
      openNew();
      cy.fillField('Name', `Parent clear ${field}`);
      cy.clickButton(`Add ${CHILD}`);
      fillProbeRow(0, undefined, false);
      getDataGridCell(0, field, CHILD).dblclick();
      getDataGridCell(0, field, CHILD).find('input').clear();
      cy.press(Cypress.Keyboard.Keys.TAB);
      cy.get('p').first().click(); // click outside to commit the row edit
      cy.clickButton('Save');
      cy.contains('required fields').should('be.visible');
      cy.url().should('include', '/parent_only/new');
      findParent(`Parent clear ${field}`).then((row) => expect(row).to.be.null);
    });
  });

  it('(c) a required enum column has no empty choice and starts with its first member', () => {
    openNew();
    cy.clickButton(`Add ${CHILD}`);
    getDataGridCell(0, 'enum_req', CHILD).should('contain.text', 'String'); // first member of the enum
    getDataGridCell(0, 'enum_req', CHILD).dblclick();
    getDataGridCell(0, 'enum_req', CHILD).click();
    cy.get('[role="option"]').then(($o) => {
      expect([...$o].map((e) => (e.textContent || '').trim())).to.deep.eq(['String', 'Number', 'Boolean', 'Date']);
    });
  });

  it('(c) a nullable enum column starts empty and offers an empty choice', () => {
    openNew();
    cy.clickButton(`Add ${CHILD}`);
    getDataGridCell(0, 'enum_null', CHILD).should('contain.text', '-- None --'); // starts on the empty choice
    getDataGridCell(0, 'enum_null', CHILD).dblclick();
    getDataGridCell(0, 'enum_null', CHILD).click();
    cy.get('[role="option"]').then(($o) => {
      const labels = [...$o].map((e) => (e.textContent || '').trim());
      expect(labels).to.have.length(5);
      expect(labels[0]).to.match(/none/i);
    });
  });

  it('(c) nullable columns cleared to empty save as empty', () => {
    openNew();
    cy.fillField('Name', 'Parent nullable cleared');
    cy.clickButton(`Add ${CHILD}`);
    fillProbeRow(0, undefined, false);
    ['date_null', 'dt_null'].forEach((field) => {
      getDataGridCell(0, field, CHILD).dblclick();
      getDataGridCell(0, field, CHILD).find('input').clear();
      cy.press(Cypress.Keyboard.Keys.TAB);
    });
    cy.get('p').first().click(); // click outside to commit the row edit
    cy.clickButton('Save');
    cy.url().should('not.include', '/parent_only/new');
    findParent('Parent nullable cleared').then((row) => {
      expect(row).to.not.be.null;
      cy.request({ url: `/api/parent_only/${row.id}`, headers }).then((res) => {
        const probe = res.body.parent_only_probes[0];
        expect(probe.date_null).to.be.null;
        expect(probe.dt_null).to.be.null;
        expect(probe.str_null).to.satisfy((v: any) => v === null || v === '');
        expect(probe.int_null).to.be.null;
      });
    });
  });
});

describe('parent screen: a child with its own writable pages is read-only', () => {
  beforeEach(seed);

  ['new', 'edit'].forEach((screen) => {
    it(`${screen} screen of parent1 offers no add or edit controls for the independent child`, () => {
      if (screen === 'new') {
        cy.visit('/en/parent1/new');
      } else {
        cy.task<any[]>('db:populateParent1', 1);
        cy.request({ url: '/api/parent1', headers }).then((r) => {
          const row = r.body.rows.find((x: any) => x.name === 'Owner One');
          cy.visit(`/en/parent1/edit/${row.id}`);
        });
      }
      if (screen === 'edit') cy.contains('h2', 'Parent1 Child1s').should('exist');
      cy.get('button[aria-label="Add Parent1 Child1s"]').should('not.exist');
    });
  });
});

// parent1_child2: own list/view pages but new/edit/delete false (read-only
// page mode), inline editable in parent1. name and end_date are required;
// start_date, parent_only_id and related_parent1_id are nullable.
describe('parent screen: a child with read-only own pages is created and edited from the parent', () => {
  const RO = 'Parent1 Child2s';
  beforeEach(seed);

  function fillParent1(name: string) {
    cy.fillField('Name', name);
    cy.fillField('Price', '100');
    cy.fillDateTime('Due Date', '01/15/2025 09:00 AM');
  }

  function findParent1(name: string) {
    return cy.request({ url: '/api/parent1', headers }).then((r) => cy.wrap(r.body.rows.find((x: any) => x.name === name) ?? null));
  }

  it('(a)(b) new screen: creates a row with its FK picked by label, then edits it', () => {
    cy.visit('/en/parent1/new');
    fillParent1('P1 new');
    cy.clickButton(`Add ${RO}`);
    selectDataGridSingleSelect(0, 'parent_only_id', 'Target PO', undefined, RO);
    editDataGridCell(0, 'name', 'ro row', false, RO);
    editDataGridCell(0, 'end_date', '2025-01-16', true, RO);
    cy.clickButton('Save');
    cy.url().should('not.include', '/parent1/new');
    findParent1('P1 new').then((row) => {
      expect(row).to.not.be.null;
      cy.visit(`/en/parent1/edit/${row.id}`);
    });
    getDataGridCell(0, 'name', RO).should('contain.text', 'ro row');
    getDataGridCell(0, 'parent_only_id', RO).should('contain.text', 'Target PO');
    editDataGridCell(0, 'name', 'ro row edited', true, RO);
    cy.clickButton('Save');
    cy.url().should('not.include', '/edit');
    findParent1('P1 new').then((row) => cy.visit(`/en/parent1/edit/${row.id}`));
    getDataGridCell(0, 'name', RO).should('contain.text', 'ro row edited');
  });

  it('(c) required name left empty: refused; nullable start_date left empty: saved', () => {
    cy.visit('/en/parent1/new');
    fillParent1('P1 empty name');
    cy.clickButton(`Add ${RO}`);
    editDataGridCell(0, 'end_date', '2025-01-16', true, RO);
    cy.clickButton('Save');
    cy.contains('required fields').should('be.visible');
    findParent1('P1 empty name').then((row) => expect(row).to.be.null);
    editDataGridCell(0, 'name', 'now named', true, RO);
    cy.clickButton('Save');
    cy.url().should('not.include', '/parent1/new');
    findParent1('P1 empty name').then((row) => {
      expect(row).to.not.be.null;
      cy.request({ url: `/api/parent1/${row.id}`, headers }).then((res) => {
        expect(res.body.parent1_child2s[0].start_date).to.be.null;
      });
    });
  });
});
