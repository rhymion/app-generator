// Verification for app-generator#753 (list sort/filter crashes on
// non-plain-string columns; FK display columns were silently dropped
// instead). approval_flow is the one entity in this repo's own dogfood
// schema with a real, always-present FK display column (requestor_role /
// approver_role, both x-display.table entries backed by a simple labelField
// on role.name) driven through a live MUI DataGrid, so this spec exercises
// the fix through the actual UI filter/sort panel rather than a curl/unit
// substitute.
import { TEST_CREDENTIALS } from '../support/test-credentials';
import { apiCreateApprovalFlow, apiCreateRole } from '../support/approval_flow_seed';

function openColumnFilter(field: string) {
  cy.get(`.MuiDataGrid-columnHeader[data-field="${field}"] .MuiDataGrid-menuIconButton`).click({ force: true });
  cy.get('.MuiDataGrid-menuList').contains('Filter').click();
}

function setFilterValue(value: string) {
  cy.get('.MuiDataGrid-panel .MuiDataGrid-filterForm input[type="text"]').last().clear().type(value);
}

describe('List filter/sort on a relation display column (app-generator#753)', () => {
  beforeEach(() => {
    cy.task('db:reset');
    cy.task('db:seed');
    cy.task('db:grantAllPermissions');
    Cypress.session.clearAllSavedSessions();
    cy.clearCookies();
    cy.clearLocalStorage();
    cy.visit('/en/');
    cy.window().then((win) => { win.sessionStorage.clear(); });
    cy.login(TEST_CREDENTIALS.email, TEST_CREDENTIALS.password);
  });

  it('filters by the FK column labelField without crashing or no-op-ing (Part 1)', () => {
    apiCreateRole('Filterable Approver Alpha').then((approverA) => {
      apiCreateApprovalFlow({ entityName: 'user', approverRoleId: approverA.id }).then(() => {
        apiCreateRole('Filterable Approver Beta').then((approverB) => {
          apiCreateApprovalFlow({ entityName: 'organization', approverRoleId: approverB.id }).then(() => {
            cy.visit('/en/approval_flow');
            cy.get('.MuiDataGrid-row').should('have.length', 2);

            openColumnFilter('approver_role');
            setFilterValue('Filterable Approver Alpha');

            // Before the fix, a relation column's `field` was never in
            // FILTERABLE_FIELDS, so the request silently returned every row
            // unfiltered (Part 1's "no-op", not a crash).
            cy.get('.MuiDataGrid-row').should('have.length', 1);
            cy.contains('.MuiDataGrid-row', 'user').should('exist');
            cy.contains('.MuiDataGrid-row', 'organization').should('not.exist');

            // A value matching neither row's approver_role must return zero
            // rows (proves the filter is real, not a pass-through).
            setFilterValue('Nonexistent Role Name');
            cy.get('.MuiDataGrid-row').should('have.length', 0);
          });
        });
      });
    });
  });

  it('sorts by the FK column labelField via a nested orderBy (Part 1)', () => {
    apiCreateRole('Zzz Sort Role').then((roleZ) => {
      apiCreateApprovalFlow({ entityName: 'user', approverRoleId: roleZ.id }).then(() => {
        apiCreateRole('Aaa Sort Role').then((roleA) => {
          apiCreateApprovalFlow({ entityName: 'organization', approverRoleId: roleA.id }).then(() => {
            cy.visit('/en/approval_flow');
            cy.get('.MuiDataGrid-row').should('have.length', 2);

            cy.get('[data-field="approver_role"] .MuiDataGrid-columnHeaderTitle').click();
            cy.get('.MuiDataGrid-row').eq(0).should('contain.text', 'organization');
            cy.get('.MuiDataGrid-row').eq(1).should('contain.text', 'user');
          });
        });
      });
    });
  });
});
