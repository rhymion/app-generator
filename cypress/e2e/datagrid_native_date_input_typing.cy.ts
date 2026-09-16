import { editDataGridCell } from '../support/datagrid-helpers';

// Regression coverage for issue #583: editDataGridCell() (cypress/support/
// datagrid-helpers.ts) recognized only the 16-char datetime-local ISO shape
// (`YYYY-MM-DDThh:mm`) and fell through to `input.type('{selectall}' +
// value)` for every other value shape, including the 10-char date-only ISO
// shape (`YYYY-MM-DD`) that a `format: date` DataGrid-child column has
// produced since issue #540/#542 introduced MUI's dedicated `type: 'date'`
// GridColDef for such columns. Cypress validates the *entire* string passed
// to `.type()` against a strict `YYYY-MM-DD` regex for a native
// `<input type="date">` and throws on anything else — a `{selectall}`-
// prefixed value included — so every embedded-DataGrid `format: date`
// column's generated create/edit test (e.g. app-generator issue #583's
// insurance-app repro: `agent.cy.ts` "2.1 creates with minimal data" typing
// `issued_date: '2025-01-15'` into the "Agent Licenses" child grid) failed
// with `CypressError: Typing into a date input with cy.type() requires a
// valid date with the format YYYY-MM-DD. You passed: {selectAll}...`.
//
// The fix does not hardcode any locale-specific display format — YYYY-MM-DD
// is what a native date input's underlying `value` always is per the HTML5
// spec, and empirically also what Cypress's own `.type()` validation
// requires for this element type, regardless of the browser's display
// locale. The fix only changes *how* that same ISO value is typed
// (`.clear().type(value)`, mirroring the pre-existing datetime-local branch
// immediately above it in the source), never reformatting the value itself.
// Injects the minimal DataGrid-cell DOM shape editDataGridCell()/
// getDataGridCell() query onto an already-loaded, auth-free page (rather
// than visiting a static fixture file directly — this repo's cypress.config.ts
// always sets `baseUrl` to the real running app, which does not serve
// `cypress/fixtures/*.html`, so a direct `cy.visit()` of the fixture 404s
// once this spec runs alongside the rest of the suite instead of standalone).
function mountFixtureRow() {
  cy.visit('/en/legal/terms');
  cy.document().then((doc) => {
    const row = doc.createElement('div');
    row.setAttribute('role', 'row');
    row.setAttribute('data-rowindex', '0');
    row.innerHTML = '<div data-field="effective_from"><input type="date"></div>';
    doc.body.appendChild(row);
  });
}

describe('editDataGridCell native date input typing (issue #583)', () => {
  it('types a YYYY-MM-DD value into an empty native date input without throwing', () => {
    mountFixtureRow();
    editDataGridCell(0, 'effective_from', '2025-01-15');
    cy.get('div[data-field="effective_from"] input').should('have.value', '2025-01-15');
  });

  it('overwrites an existing native date input value with a new YYYY-MM-DD value', () => {
    mountFixtureRow();
    cy.get('div[data-field="effective_from"] input').invoke('val', '2020-01-01');
    editDataGridCell(0, 'effective_from', '2025-01-15');
    cy.get('div[data-field="effective_from"] input').should('have.value', '2025-01-15');
  });
});
