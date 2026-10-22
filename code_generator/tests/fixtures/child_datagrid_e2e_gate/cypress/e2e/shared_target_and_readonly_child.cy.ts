import { TEST_CREDENTIALS } from '../../support/test-credentials';
import { fillDataGridRow, editDataGridCell, selectDataGridSingleSelect } from '../../support/datagrid-helpers';

const CHILD = 'Parent1 Child2s';

// parent1_child2: read-only child (own list/view pages, new/edit/delete false),
// embedded as an inline DataGrid in parent1. parent1_child1 is a writable
// independent child sharing the parent_only FK target.
describe('read-only child grid is editable from the parent', () => {
  beforeEach(() => {
    cy.task('db:reset');
    cy.task('db:seed');
    cy.task('db:grantAllPermissions');
    Cypress.session.clearAllSavedSessions();
    cy.clearCookies();
    cy.visit('/en/');
    cy.login(TEST_CREDENTIALS.email, TEST_CREDENTIALS.password);
  });

  function openEdit(parentName: string) {
    cy.visit('/en/parent1');
    cy.get('.MuiDataGrid-virtualScroller').scrollTo('bottom', { ensureScrollable: false });
    cy.contains(new RegExp(`^${parentName}$`)).click();
    cy.get('a[aria-label="Edit"]').click();
    cy.url().should('include', '/parent1/edit');
  }

  it('adds, edits, saves and deletes rows through service and actions', () => {
    cy.task('db:populateParent1', 1);
    openEdit('Parent1 1');
    // add
    cy.clickButton(`Add ${CHILD}`);
    fillDataGridRow(0, { name: 'RO Row A', end_date: '2025-01-16' }, true, CHILD);
    cy.clickButton('Save');
    cy.url().should('not.include', '/parent1/');
    // persisted
    openEdit('Parent1 1');
    cy.contains('RO Row A').should('be.visible');
    // edit
    editDataGridCell(0, 'name', 'RO Row B', true, CHILD);
    cy.clickButton('Save');
    cy.url().should('not.include', '/parent1/');
    openEdit('Parent1 1');
    cy.contains('RO Row B').should('be.visible');
    cy.contains('RO Row A').should('not.exist');
    // delete
    cy.selectDataGridRows([0], CHILD);
    cy.contains('h2', CHILD).parent().find('button[aria-label="Delete Selected"]').click();
    cy.get('div[role="dialog"]').find('button').contains('Delete').first().click();
    cy.clickButton('Save');
    cy.url().should('not.include', '/parent1/');
    openEdit('Parent1 1');
    cy.contains('RO Row B').should('not.exist');
  });

  it('offers and saves the FK shared with a sibling independent child', () => {
    cy.task('db:populateParent1', 1);
    cy.task('db:populateParent1Dependencies');
    openEdit('Parent1 1');
    cy.clickButton(`Add ${CHILD}`);
    selectDataGridSingleSelect(0, 'parent_only_id', 'Test Parent Only A', undefined, CHILD);
    fillDataGridRow(0, { name: 'FK Row', end_date: '2025-01-16' }, true, CHILD);
    cy.clickButton('Save');
    cy.url().should('not.include', '/parent1/');
    openEdit('Parent1 1');
    cy.contains('FK Row').should('be.visible');
    cy.contains('Test Parent Only A').should('be.visible');
  });
});
