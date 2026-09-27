// Permanent per-type coverage for app-generator#753/#756: real
// column types on the list-page filter (GridColDef.type/valueOptions) and
// server-side operator dispatch (buildFilter's per-kind table). Uses
// list_filter_gate, a dedicated dogfood entity (see prisma/schema.prisma's
// ListFilterGateStatus/list_filter_gate comment) -- this repo's own real
// product entities have zero enum/boolean/date-only/date-time/number/
// decimal columns anywhere in x-display.table (confirmed by a full schema
// walk, subtask_1193a), so #755's own permanent spec
// (list_filter_sort_relation_column.cy.ts) could only cover the FK
// relation column kind. This file covers every other kind #755/#756 dispatch
// on: string, enum (native), boolean, date-only, date-time, number,
// decimal.
import { TEST_CREDENTIALS } from '../support/test-credentials';
import { apiCreateListFilterGate } from '../support/list_filter_gate_seed';

function openColumnFilter(field: string) {
  cy.get(`.MuiDataGrid-columnHeader[data-field="${field}"] .MuiDataGrid-menuIconButton`).click({ force: true });
  cy.get('.MuiDataGrid-menuList').contains('Filter').click();
}

function selectOperator(operatorText: string) {
  cy.get('.MuiDataGrid-panel .MuiDataGrid-filterFormOperatorInput [role="combobox"]').click();
  cy.get('.MuiMenu-list li[role="option"]').contains(operatorText).click();
}

// singleSelect (enum) / boolean value input: a MUI <Select> rendering its
// options in a portal-mounted .MuiMenu-list, not nested under the filter
// panel itself.
function selectSingleValueOption(optionText: string) {
  cy.get('.MuiDataGrid-panel .MuiDataGrid-filterFormValueInput [role="combobox"]').click();
  cy.get('.MuiMenu-list li[role="option"]').contains(optionText).click();
}

// singleSelect isAnyOf value input: a MUI Autocomplete (multi-select),
// distinct DOM shape from the plain Select above -- click to open, then
// click each wanted option in its .MuiAutocomplete-option listbox.
function selectAutocompleteOption(optionText: string) {
  cy.get('.MuiDataGrid-panel .MuiDataGrid-filterFormValueInput input[role="combobox"]').click();
  cy.get('.MuiAutocomplete-option').contains(optionText).click();
}

function typeDateValue(dateStr: string) {
  cy.get('.MuiDataGrid-panel .MuiDataGrid-filterFormValueInput input[type="date"]').clear().type(dateStr);
}

function typeTextValue(value: string) {
  cy.get('.MuiDataGrid-panel .MuiDataGrid-filterFormValueInput input').last().clear().type(value);
}

describe('List filter/sort per column-type kind (app-generator#753/#756)', () => {
  beforeEach(() => {
    cy.task('db:reset');
    cy.task('db:seed');
    cy.task('db:grantAllPermissions');
    // list_filter_gate is deliberately standalone (x-generate.test: false,
    // no relationships) -- outside grantAllEntityPermissions()'s own
    // ALL_ENTITIES (template-derived from entities with x-generate.test:
    // true, or reached via another entity's labelField hop). Grant it
    // explicitly.
    cy.task('db:grantEntityPermission', 'list_filter_gate');
    Cypress.session.clearAllSavedSessions();
    cy.clearCookies();
    cy.clearLocalStorage();
    cy.visit('/en/');
    cy.window().then((win) => { win.sessionStorage.clear(); });
    cy.login(TEST_CREDENTIALS.email, TEST_CREDENTIALS.password);
  });

  it('filters a string column by contains (default operator)', () => {
    apiCreateListFilterGate({ label: 'Alpha Widget' }).then(() => {
      apiCreateListFilterGate({ label: 'Beta Gadget' }).then(() => {
        cy.visit('/en/list_filter_gate');
        cy.get('.MuiDataGrid-row').should('have.length', 2);
        openColumnFilter('label');
        typeTextValue('Widget');
        cy.get('.MuiDataGrid-row').should('have.length', 1);
        cy.contains('.MuiDataGrid-row', 'Alpha Widget').should('exist');
      });
    });
  });

  it('filters an enum column via the translated-label dropdown (is, default) -- app-generator#756 Finding 3 regression', () => {
    apiCreateListFilterGate({ label: 'Row Queued', statusType: 'queued' }).then(() => {
      apiCreateListFilterGate({ label: 'Row Running', statusType: 'running' }).then(() => {
        cy.visit('/en/list_filter_gate');
        cy.get('.MuiDataGrid-row').should('have.length', 2);
        openColumnFilter('status_type');
        // The user only ever sees/picks the translated label ("Queued"), never
        // types the raw enum literal -- this is exactly the input Finding 3
        // showed crashing the whole page pre-#756.
        selectSingleValueOption('Queued');
        cy.get('.MuiDataGrid-row').should('have.length', 1);
        cy.contains('.MuiDataGrid-row', 'Row Queued').should('exist');
        cy.contains('.MuiDataGrid-row', 'Row Running').should('not.exist');
      });
    });
  });

  it('filters an enum column via isAnyOf (multi-select dropdown)', () => {
    apiCreateListFilterGate({ label: 'Row Queued', statusType: 'queued' }).then(() => {
      apiCreateListFilterGate({ label: 'Row Running', statusType: 'running' }).then(() => {
        apiCreateListFilterGate({ label: 'Row Done', statusType: 'done' }).then(() => {
          cy.visit('/en/list_filter_gate');
          cy.get('.MuiDataGrid-row').should('have.length', 3);
          openColumnFilter('status_type');
          selectOperator('is any of');
          selectAutocompleteOption('Queued');
          selectAutocompleteOption('Running');
          cy.get('.MuiDataGrid-row').should('have.length', 2);
          cy.contains('.MuiDataGrid-row', 'Row Queued').should('exist');
          cy.contains('.MuiDataGrid-row', 'Row Running').should('exist');
          cy.contains('.MuiDataGrid-row', 'Row Done').should('not.exist');
        });
      });
    });
  });

  it('filters a boolean column via the true/false dropdown (is, default) -- app-generator#756 Finding 2 regression', () => {
    apiCreateListFilterGate({ label: 'Row Enabled', isEnabled: true }).then(() => {
      apiCreateListFilterGate({ label: 'Row Disabled', isEnabled: false }).then(() => {
        cy.visit('/en/list_filter_gate');
        cy.get('.MuiDataGrid-row').should('have.length', 2);
        openColumnFilter('is_enabled');
        selectSingleValueOption('true');
        cy.get('.MuiDataGrid-row').should('have.length', 1);
        cy.contains('.MuiDataGrid-row', 'Row Enabled').should('exist');
        cy.contains('.MuiDataGrid-row', 'Row Disabled').should('not.exist');
      });
    });
  });

  it('filters a date-only column by an exact date without crashing -- app-generator#756 Finding 1 regression', () => {
    apiCreateListFilterGate({ label: 'Row Jan15', validFrom: '2026-01-15T00:00:00.000Z' }).then(() => {
      apiCreateListFilterGate({ label: 'Row Feb01', validFrom: '2026-02-01T00:00:00.000Z' }).then(() => {
        cy.visit('/en/list_filter_gate');
        cy.get('.MuiDataGrid-row').should('have.length', 2);
        openColumnFilter('valid_from');
        typeDateValue('2026-01-15');
        cy.get('.MuiDataGrid-row').should('have.length', 1);
        cy.contains('.MuiDataGrid-row', 'Row Jan15').should('exist');
      });
    });
  });

  it('filters a date-only column with the after operator', () => {
    apiCreateListFilterGate({ label: 'Row Jan15', validFrom: '2026-01-15T00:00:00.000Z' }).then(() => {
      apiCreateListFilterGate({ label: 'Row Feb01', validFrom: '2026-02-01T00:00:00.000Z' }).then(() => {
        cy.visit('/en/list_filter_gate');
        cy.get('.MuiDataGrid-row').should('have.length', 2);
        openColumnFilter('valid_from');
        selectOperator('is after');
        typeDateValue('2026-01-20');
        cy.get('.MuiDataGrid-row').should('have.length', 1);
        cy.contains('.MuiDataGrid-row', 'Row Feb01').should('exist');
      });
    });
  });

  it('filters a date-time column by an exact date without crashing', () => {
    // MUI's dateTime filter is a native <input type="datetime-local">,
    // which reads/writes local wall-clock time, not UTC. Build the seeded
    // row's ISO value from the SAME local wall-clock numbers we're about
    // to type (`new Date(y, m, d, h, min)` is local-timezone, matching the
    // browser under test since both run on this same machine) rather than
    // hardcoding a UTC string -- a hardcoded UTC offset earlier silently
    // seeded a different instant than what got typed, since this
    // environment's local timezone isn't UTC (found via real Cypress
    // interaction, subtask_1193a).
    const early = new Date(2026, 0, 15, 8, 0).toISOString();
    const late = new Date(2026, 0, 20, 8, 0).toISOString();
    apiCreateListFilterGate({ label: 'Row Early', startedAt: early }).then(() => {
      apiCreateListFilterGate({ label: 'Row Late', startedAt: late }).then(() => {
        cy.visit('/en/list_filter_gate');
        cy.get('.MuiDataGrid-row').should('have.length', 2);
        openColumnFilter('started_at');
        cy.get('.MuiDataGrid-panel .MuiDataGrid-filterFormValueInput input').last().type('2026-01-15T08:00');
        cy.get('.MuiDataGrid-row').should('have.length', 1);
        cy.contains('.MuiDataGrid-row', 'Row Early').should('exist');
      });
    });
  });

  it('filters a plain number column with the > operator', () => {
    apiCreateListFilterGate({ label: 'Row Low', priority: 3 }).then(() => {
      apiCreateListFilterGate({ label: 'Row High', priority: 9 }).then(() => {
        cy.visit('/en/list_filter_gate');
        cy.get('.MuiDataGrid-row').should('have.length', 2);
        openColumnFilter('priority');
        selectOperator('>');
        typeTextValue('5');
        cy.get('.MuiDataGrid-row').should('have.length', 1);
        cy.contains('.MuiDataGrid-row', 'Row High').should('exist');
      });
    });
  });

  it('filters a Decimal column by exact match without crashing', () => {
    apiCreateListFilterGate({ label: 'Row Cheap', weight: '3.50' }).then(() => {
      apiCreateListFilterGate({ label: 'Row Pricey', weight: '99.99' }).then(() => {
        cy.visit('/en/list_filter_gate');
        cy.get('.MuiDataGrid-row').should('have.length', 2);
        openColumnFilter('weight');
        typeTextValue('99.99');
        cy.get('.MuiDataGrid-row').should('have.length', 1);
        cy.contains('.MuiDataGrid-row', 'Row Pricey').should('exist');
      });
    });
  });

  it('filters a Decimal column with the > operator', () => {
    apiCreateListFilterGate({ label: 'Row Cheap', weight: '3.50' }).then(() => {
      apiCreateListFilterGate({ label: 'Row Pricey', weight: '99.99' }).then(() => {
        cy.visit('/en/list_filter_gate');
        cy.get('.MuiDataGrid-row').should('have.length', 2);
        openColumnFilter('weight');
        selectOperator('>');
        typeTextValue('50');
        cy.get('.MuiDataGrid-row').should('have.length', 1);
        cy.contains('.MuiDataGrid-row', 'Row Pricey').should('exist');
      });
    });
  });
});
