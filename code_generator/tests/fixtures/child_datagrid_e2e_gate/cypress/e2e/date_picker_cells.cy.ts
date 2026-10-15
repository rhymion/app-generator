import { TEST_CREDENTIALS, TEST_API_KEY } from '../../support/test-credentials';
import { editDataGridCell, getDataGridCell, selectDataGridSingleSelect } from '../../support/datagrid-helpers';

// Issue #764: embedded child DataGrid date / dateTime columns edit and filter
// through MUI pickers, so the calendar follows the app locale (not the
// browser's UI language) and the saved values are unchanged.
const CHILD = 'Parent Only Probes';
const headers = { 'X-API-Key': TEST_API_KEY };

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

function createParentWithDates(name: string) {
  cy.visit('/en/parent_only/new');
  cy.fillField('Name', name);
  cy.clickButton(`Add ${CHILD}`);
  selectDataGridSingleSelect(0, 'same_req_id', 'Target PO', undefined, CHILD);
  selectDataGridSingleSelect(0, 'other_req_id', 'Owner One', undefined, CHILD);
  selectDataGridSingleSelect(0, 'enum_req', 'String', 'string', CHILD);
  const text: Record<string, string> = {
    str_req: 'text', int_req: '7', dec_req: '12.50',
    date_req: '2025-01-16', dt_req: '2025-01-16T09:30',
  };
  const fields = Object.keys(text);
  fields.forEach((f, i) => editDataGridCell(0, f, text[f], i === fields.length - 1, CHILD));
}

function openEditOf(name: string, locale: string) {
  cy.request({ url: '/api/parent_only', headers }).then((r) => {
    const row = r.body.rows.find((x: any) => x.name === name);
    expect(row, `parent ${name} exists`).to.not.be.undefined;
    cy.visit(`/${locale}/parent_only/edit/${row.id}`);
  });
}

describe('child DataGrid date pickers (issue #764)', () => {
  beforeEach(seed);

  it('saves the typed date and dateTime values unchanged', () => {
    createParentWithDates('Dates P');
    cy.clickButton('Save');
    cy.url().should('not.include', '/parent_only/new');
    // The stored instants are the browser-local midnight / 09:30 the native
    // inputs produced before the pickers, so the saved value type and time zone
    // are unchanged (compared in the same browser time zone, not a fixed one).
    cy.window().then((win) => {
      const expectedDate = new win.Date(2025, 0, 16).toISOString();
      const expectedDateTime = new win.Date(2025, 0, 16, 9, 30).toISOString();
      cy.request({ url: '/api/parent_only', headers }).then((r) => {
        const row = r.body.rows.find((x: any) => x.name === 'Dates P');
        expect(row, 'parent Dates P exists').to.not.be.undefined;
        cy.request({ url: `/api/parent_only/${row.id}`, headers }).then((cur) => {
          const probe = cur.body.parent_only_probes[0];
          expect(new Date(probe.date_req).toISOString()).to.eq(expectedDate);
          expect(new Date(probe.dt_req).toISOString()).to.eq(expectedDateTime);
        });
      });
    });
  });

  it('edit cell is a picker, and its calendar is in English on /en', () => {
    createParentWithDates('Dates EN');
    cy.clickButton('Save');
    cy.url().should('not.include', '/parent_only/new');
    openEditOf('Dates EN', 'en');
    getDataGridCell(0, 'date_req', CHILD).dblclick();
    getDataGridCell(0, 'date_req', CHILD).find('input[type="date"]').should('not.exist');
    getDataGridCell(0, 'date_req', CHILD).find('button[aria-label]').click();
    cy.get('.MuiPickersCalendarHeader-label').should('contain.text', 'January').and('contain.text', '2025');
  });

  it('edit cell calendar is in Japanese on /ja', () => {
    createParentWithDates('Dates JA');
    cy.clickButton('Save');
    cy.url().should('not.include', '/parent_only/new');
    openEditOf('Dates JA', 'ja');
    getDataGridCell(0, 'date_req', CHILD).dblclick();
    getDataGridCell(0, 'date_req', CHILD).find('button[aria-label]').click();
    cy.get('.MuiPickersCalendarHeader-label').invoke('text').should('match', /1月/).and('not.match', /January/);
  });
});
