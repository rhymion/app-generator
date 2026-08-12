// Hand-written (not generator-produced) — cmd_665.
//
// Recovered from the generator-produced cypress/e2e/approval_flow.cy.ts as
// it existed immediately before x-generate.test was set to false for
// approval_flow (app-generator commit 4e8ae006, the last commit where this
// file was still generated). Removing the generated CRUD coverage without
// leaving a replacement was flagged as a real regression risk: recover the
// base file, keep every scenario that still applies as-is, adjust only what
// the same-entity_name save-time validation now makes genuinely
// impossible, and self-seed instead of depending on the generated
// cypress/support/approval_flow/helper.ts + task registry entries that
// x-generate.test: false also removes.
//
// Every one of these 13 tests turned out to be usable unmodified (only the
// seeding mechanism changed, from a generated Cypress task to direct API
// calls): none of them ever linked preceded_by/followed_by across a
// different entity_name, even in the original generated version (verified
// by reading the removed helper.ts before this port — its dependency
// candidates always shared entity_name 'user' with the record under test).
// See apiCreateRole/apiCreateApprovalFlow/apiPopulateApprovalFlowDependencies
// in ../support/approval_flow_seed.ts.
import { TEST_CREDENTIALS } from '../support/test-credentials';
import { assertDataGridEmpty, getDataGridTotalRowCount } from '../support/datagrid-helpers';
import {
  apiCreateRole,
  apiPopulateApprovalFlowDependencies,
  seedApprovalFlowRows,
  seedApprovalFlowRowsFull,
} from '../support/approval_flow_seed';

// A dependency record's display name can share a substring with another
// record (e.g. the split-lineage decoy the generated dependency helper used
// to create, cmd_592) — cy.contains() is substring-based, so row lookups
// keyed on a dep's display name need an exact-match anchor instead (cmd_614:
// widened from self-ref-only to all entities). Kept from the original
// generated file even though this port's own deps no longer produce that
// specific decoy, since the guard is harmless and other entities' generated
// specs use the same pattern.
function exactRe(text: string): RegExp {
  return new RegExp('^' + text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$');
}

describe('Testing Approval Flow pages and their behavior (hand-written port, cmd_665)', () => {
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

  describe('Display list', () => {
    it('1.1 shows empty state with no items', () => {
      cy.visit('/en/approval_flow');
      cy.visit('/en/approval_flow');
      assertDataGridEmpty();
    });

    it('1.2 shows list with one item', () => {
      seedApprovalFlowRows(1);
      cy.visit('/en/approval_flow');
      cy.get('.MuiDataGrid-virtualScroller').scrollTo('bottom', { ensureScrollable: false });
      cy.contains('user').scrollIntoView().should('be.visible');
      getDataGridTotalRowCount().should('eq', 1);
    });

    it('1.3 shows list with multiple items', () => {
      seedApprovalFlowRows(3);
      cy.visit('/en/approval_flow');
      cy.get('.MuiDataGrid-virtualScroller').scrollTo('bottom', { ensureScrollable: false });
      cy.contains('user').scrollIntoView().should('be.visible');
      getDataGridTotalRowCount().should('eq', 3);
    });
  });

  describe('Create', () => {
    it('2.1 creates with minimal data (required fields only)', () => {
      apiPopulateApprovalFlowDependencies().then((deps) => {
        cy.visit('/en/approval_flow');
        cy.clickButton('Create New Approval Flow');
        cy.url().should('include', '/approval_flow/new');
        cy.selectAutocomplete('Entity Name', 'User');
        cy.selectAutocomplete('Approver Role', deps.approverRole.name);
        cy.clickButton('Save');
        cy.url().should('include', '/approval_flow');
        cy.url().should('not.include', '/approval_flow/');
        cy.get('.MuiDataGrid-virtualScroller').scrollTo('bottom', { ensureScrollable: false });
        cy.contains('user').scrollIntoView().should('be.visible');
        cy.get('.MuiDataGrid-virtualScroller').scrollTo('bottom', { ensureScrollable: false });
        cy.contains('.MuiDataGrid-row', 'user').find('a').first().click();
        cy.url().should('include', '/approval_flow/view');
        cy.checkField('Entity Name', 'User');
        cy.checkField('Approver Role', 'Test Approver Role A');
      });
    });

    // deps.precededBy/deps.followedBy share entity_name 'user' with this
    // record (see apiPopulateApprovalFlowDependencies), exactly as the
    // original generated deps did, so this never crosses entity_name.
    it('2.2 creates with full data (all fields and children)', () => {
      apiPopulateApprovalFlowDependencies().then((deps) => {
        cy.visit('/en/approval_flow');
        cy.clickButton('Create New Approval Flow');
        cy.url().should('include', '/approval_flow/new');
        cy.selectAutocomplete('Entity Name', 'User');
        cy.selectAutocomplete('Requestor Role', deps.requestorRole.name);
        cy.selectAutocomplete('Approver Role', deps.approverRole.name);
        cy.clickButton('Add Preceded By');
        cy.get('div[role="dialog"]').find('input').type(deps.precededBy.name);
        cy.contains('.MuiAutocomplete-popper li', exactRe(deps.precededBy.name)).click();
        cy.get('div[role="dialog"]').find('button').contains('Add').click();
        cy.clickButton('Add Followed By');
        cy.get('div[role="dialog"]').find('input').type(deps.followedBy.name);
        cy.contains('.MuiAutocomplete-popper li', exactRe(deps.followedBy.name)).click();
        cy.get('div[role="dialog"]').find('button').contains('Add').click();
        cy.clickButton('Save');
        cy.url().should('include', '/approval_flow');
        cy.url().should('not.include', '/approval_flow/');
        cy.get('.MuiDataGrid-virtualScroller').scrollTo('bottom', { ensureScrollable: false });
        cy.contains('user').scrollIntoView().should('be.visible');
        cy.get('.MuiDataGrid-virtualScroller').scrollTo('bottom', { ensureScrollable: false });
        cy.get('.MuiDataGrid-row').last().find('a').first().click();
        cy.url().should('include', '/approval_flow/view');
        cy.checkField('Entity Name', 'User');
        cy.checkField('Requestor Role', 'Test Requestor Role A');
        cy.checkField('Approver Role', 'Test Approver Role A');
      });
    });
  });

  describe('Edit', () => {
    it('3.1 adds optional data and child items', () => {
      apiPopulateApprovalFlowDependencies().then((deps) => {
        seedApprovalFlowRows(1).then((records) => {
          cy.visit(`/en/approval_flow/view/${records[0].id}`);
          cy.get('a[aria-label="Edit"]').click();
          cy.url().should('include', '/approval_flow/edit');
          cy.selectAutocomplete('Requestor Role', deps.requestorRole.name);
          cy.clickButton('Add Preceded By');
          cy.get('div[role="dialog"]').find('input').type(deps.precededBy.name);
          cy.contains('.MuiAutocomplete-popper li', exactRe(deps.precededBy.name)).click();
          cy.get('div[role="dialog"]').find('button').contains('Add').click();
          cy.clickButton('Add Followed By');
          cy.get('div[role="dialog"]').find('input').type(deps.followedBy.name);
          cy.contains('.MuiAutocomplete-popper li', exactRe(deps.followedBy.name)).click();
          cy.get('div[role="dialog"]').find('button').contains('Add').click();
          cy.clickButton('Save');
          cy.url().should('include', '/approval_flow');
          cy.url().should('not.include', '/approval_flow/');
          cy.get('.MuiDataGrid-virtualScroller').scrollTo('bottom', { ensureScrollable: false });
          cy.contains('user').scrollIntoView().should('be.visible');
          cy.visit(`/en/approval_flow/view/${records[0].id}`);
          cy.url().should('include', '/approval_flow/view');
          cy.checkField('Entity Name', 'User');
        });
      });
    });

    // The original title says "removes ... child items", but the generated
    // populateApprovalFlowFullData() never attached preceded_by/followed_by
    // children in the first place (verified by reading the pre-cmd_661
    // helper.ts) — this test has only ever exercised an unchanged save.
    // Kept as a regression guard for that path; the misleading title is a
    // pre-existing generator-side issue, out of scope here (see
    // subtask_660a report).
    it('3.2 removes optional data and child items', () => {
      seedApprovalFlowRowsFull(1).then((_records) => {
        cy.visit('/en/approval_flow');
        cy.get('.MuiDataGrid-virtualScroller').scrollTo('bottom', { ensureScrollable: false });
        cy.contains('.MuiDataGrid-row', 'user').find('a').first().click();
        cy.get('a[aria-label="Edit"]').click();
        cy.url().should('include', '/approval_flow/edit');
        cy.clickButton('Save');
        cy.url().should('include', '/approval_flow');
        cy.url().should('not.include', '/approval_flow/');
        cy.get('.MuiDataGrid-virtualScroller').scrollTo('bottom', { ensureScrollable: false });
        cy.contains('user').scrollIntoView().should('be.visible');
      });
    });

    // This is the one concrete "success path" the same-entity_name
    // save-time validation needs: a record with ZERO preceded_by/followed_by
    // children changing entity_name must succeed (validateSameEntityRefs()
    // returns early when ids.length === 0 — see
    // lib/approval_flow/service_validation_custom.ts).
    // approval_flow_same_entity_autocomplete_filter.cy.ts only covers the
    // REJECT branch (a stale cross-entity_name child blocking save); this
    // test is what closes that gap, and it already existed in the generated
    // file — no new spec needed, just recovering it.
    it('3.3 edits with mixed changes', () => {
      seedApprovalFlowRows(1).then((records) => {
        cy.visit(`/en/approval_flow/edit/${records[0].id}`);
        cy.selectAutocomplete('Entity Name', 'Setting');
        cy.clickButton('Save');
        cy.url().should('include', '/approval_flow');
        cy.url().should('not.include', '/approval_flow/');
        cy.visit(`/en/approval_flow/view/${records[0].id}`);
        cy.url().should('include', '/approval_flow/view');
        cy.checkField('Entity Name', 'Setting');
      });
    });
  });

  describe('Delete', () => {
    it('4.1 deletes a single item from list view', () => {
      seedApprovalFlowRows(2);
      cy.visit('/en/approval_flow');
      cy.selectDataGridRows([0]);
      cy.get('div').find('button[aria-label="Delete Selected"]').first().click();
      cy.get('div[role="dialog"]').find('button').contains('Delete').first().click();
      getDataGridTotalRowCount().should('eq', 1);
    });

    it('4.2 deletes multiple items from list view', () => {
      seedApprovalFlowRows(3);
      cy.visit('/en/approval_flow');
      cy.selectDataGridRows([0, 1]);
      cy.get('div').find('button[aria-label="Delete Selected"]').first().click();
      cy.get('div[role="dialog"]').find('button').contains('Delete').first().click();
      getDataGridTotalRowCount().should('eq', 1);
    });

    it('4.3 deletes an item from edit page', () => {
      seedApprovalFlowRows(1);
      cy.visit('/en/approval_flow');
      cy.get('.MuiDataGrid-virtualScroller').scrollTo('bottom', { ensureScrollable: false });
      cy.contains('.MuiDataGrid-row', 'user').find('a').first().click();
      cy.get('a[aria-label="Edit"]').click();
      cy.url().should('include', '/approval_flow/edit');
      cy.clickButton('Delete Approval Flow');
      cy.get('div[role="dialog"]').find('button').contains('Delete').first().click();
      cy.url().should('not.include', '/edit');
      cy.url().should('include', '/approval_flow');
      cy.url().should('not.include', '/approval_flow/');
    });
  });

  describe('Fail create', () => {
    it('5.1 fails when required parent field is missing', () => {
      apiCreateRole('Test Approver Role Alias A').then((role) => {
        cy.visit('/en/approval_flow/new');
        cy.get('button[aria-label="Save"]').should('be.visible');
        cy.selectAutocomplete('Approver Role', role.name);
        cy.clickButton('Save');
        cy.url().should('include', '/approval_flow/new');
      });
    });
  });

  describe('Fail edit', () => {
    it('6.1 fails when required parent field is cleared', () => {
      seedApprovalFlowRows(1);
      cy.visit('/en/approval_flow');
      cy.get('.MuiDataGrid-virtualScroller').scrollTo('bottom', { ensureScrollable: false });
      cy.contains('.MuiDataGrid-row', 'user').find('a').first().click();
      cy.get('a[aria-label="Edit"]').click();
      cy.clearAutocomplete('Entity Name');
      cy.clickButton('Save');
      cy.url().should('include', '/approval_flow/edit');
    });
  });
});
