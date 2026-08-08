// Hand-written (not generator-produced) — cmd_613.
//
// approval_flow.preceded_by / followed_by candidate narrowing
// (lib/approval_flow/autocomplete_filter.ts) is bespoke, entity-specific
// business logic ("a predecessor/successor only ever makes sense within the
// same entity_name approval chain") with no declarative schema counterpart
// the generator could derive a spec from — the generator produces the CRUD
// spec for approval_flow itself (cypress/e2e/approval_flow.cy.ts) but has no
// concept of "narrow this m2m picker by a sibling field's value", since that
// mechanism (lib/{entity}/autocomplete_filter.ts) is, by design, a
// hand-editable write-once insertion point (see generate.py's stub writer).
// Hand-writing this spec is the documented, intended way to cover it.
//
// Also covers the View/Edit label-consistency fix (labelField now composite
// instead of the legacy secondaryLabelField) as a regression guard.
import { TEST_API_KEY, TEST_CREDENTIALS } from '../support/test-credentials';

const API_BASE = '/api/approval_flow';

function createApprovalFlow(entityName: string, approverRoleId: string) {
  return cy
    .request({
      method: 'POST',
      url: API_BASE,
      headers: { 'X-API-Key': TEST_API_KEY },
      body: { entity_name: entityName, approver_role_id: approverRoleId, precededBy_ids: [], followedBy_ids: [] },
    })
    .then((res) => {
      expect(res.status).to.eq(201);
      return res.body as { id: string };
    });
}

describe('approval_flow preceded_by/followed_by same-entity_name candidate filtering (cmd_613)', () => {
  beforeEach(() => {
    cy.task('db:reset');
    cy.task('db:seed');
    cy.task('db:grantAllPermissions');
    Cypress.session.clearAllSavedSessions();
    cy.clearCookies();
    cy.clearLocalStorage();
    cy.visit('/en/');
    cy.window().then((win) => {
      win.sessionStorage.clear();
    });
    cy.login(TEST_CREDENTIALS.email, TEST_CREDENTIALS.password);
  });

  it('(A)(B) shows a same-entity_name candidate and hides a different-entity_name candidate when adding Preceded By', () => {
    cy.task<any>('db:populateApprovalFlowDependencies').then((deps) => {
      // deps.precededBy already exists with entity_name 'setting' — the (B)
      // candidate: a different entity_name than editTarget.
      //
      // editTarget and the (A) candidate share entity_name 'permission' but
      // use DIFFERENT roles (approverRole vs approverRole2): approval_flow's
      // @@unique([entity_name, approver_role_id]) (where it exists, e.g.
      // proj_c) would otherwise reject the second 'permission' row outright.
      // The candidate filter only keys on entity_name, so this still proves
      // (A) correctly — searching by a token common to both rows (found
      // below) isolates the entity_name filter from role identity.
      createApprovalFlow('permission', deps.approverRole.id).then((editTarget) => {
        // (A) candidate: same entity_name as editTarget, different role.
        createApprovalFlow('permission', deps.approverRole2.id).then(() => {
          cy.visit(`/en/approval_flow/edit/${editTarget.id}`);
          cy.clickButton('Add Preceded By');
          cy.get('div[role="dialog"]').find('input').type('permission');
          cy.get('.MuiAutocomplete-popper').contains('li', 'permission').should('exist');
          cy.get('.MuiAutocomplete-popper').contains('li', 'setting').should('not.exist');
        });
      });
    });
  });

  it('View and Edit render the identical preceded_by label (entity_name + approver_role.name, space-joined)', () => {
    cy.task<any>('db:populateApprovalFlowDependencies').then((deps) => {
      // Different roles (approverRole vs approverRole2) so the two
      // 'permission' rows don't trip @@unique([entity_name, approver_role_id])
      // where it exists (e.g. proj_c) — see the (A)(B) test above for detail.
      createApprovalFlow('permission', deps.approverRole2.id).then((predecessor) => {
        createApprovalFlow('permission', deps.approverRole.id).then((editTarget) => {
          cy.request({
            method: 'PUT',
            url: `${API_BASE}/${editTarget.id}`,
            headers: { 'X-API-Key': TEST_API_KEY },
            body: {
              entity_name: 'permission',
              approver_role_id: deps.approverRole.id,
              precededBy_ids: [predecessor.id],
              followedBy_ids: [],
            },
          }).then((res) => {
            expect(res.status).to.eq(200);
            // Before cmd_613, View rendered `approver_role.name || entity_name`
            // (role name only, entity_name dropped whenever a role was set) and
            // Edit rendered `entity_name + ' - ' + approver_role.name` (dash
            // form) — two different strings for the same row. Both must now
            // render this exact space-joined composite.
            const expectedLabel = `permission ${deps.approverRole.name}`;
            cy.visit(`/en/approval_flow/edit/${editTarget.id}`);
            cy.contains(expectedLabel).should('exist');
            cy.visit(`/en/approval_flow/view/${editTarget.id}`);
            cy.contains(expectedLabel).should('exist');
          });
        });
      });
    });
  });
});
