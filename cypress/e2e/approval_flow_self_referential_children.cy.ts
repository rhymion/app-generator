// Hand-written (not generator-produced) — cmd_665.
//
// approval_flow.preceded_by / followed_by are a self-referential many-to-many
// relationship (an approval_flow row's Preceded By / Followed By lists point
// to OTHER approval_flow rows) — the only self-referential m2m relationship
// in this schema (verified: `grep preceded_by\|followed_by
// code_generator/json_schema.yaml` matches only inside the approval_flow
// entity definition). The generator-produced cypress/e2e/approval_flow.cy.ts
// (removed by cmd_661's x-generate.test: false) had two tests that actually
// exercised the "Add Preceded By" / "Add Followed By" dialogs to attach
// child rows — '2.2 creates with full data (all fields and children)' and
// '3.1 adds optional data and child items' — every other CRUD test in that
// file (and in cypress/e2e/mobile/approval_flow.cy.ts) only touched plain
// scalar fields, a shape still covered continuously by many other entities'
// generated specs (role.cy.ts, organization.cy.ts, etc). Losing those two
// tests specifically leaves the self-referential-children UI path with zero
// coverage — this file replaces them.
//
// Candidate rows must share entity_name with the record being edited (the
// same-entity_name autocomplete filter, cmd_613/646/652 — see
// approval_flow_same_entity_autocomplete_filter.cy.ts) to appear in the
// "Add Preceded By"/"Add Followed By" dialogs at all. Each candidate/target
// uses a distinct Role so its composite label (`${entity_name}
// ${approver_role.name}`, see components/approval_flow/FormUpsert.tsx) is
// unambiguous to select by, and so the two candidates never collide with
// each other on consumer schemas that carry a
// @@unique([entity_name, approver_role_id]) constraint (e.g. proj_c — see
// approval_flow_same_entity_autocomplete_filter.cy.ts's comment on the same
// point).
import { TEST_API_KEY, TEST_CREDENTIALS } from '../support/test-credentials';

const API_BASE = '/api/approval_flow';

function createRole(name: string) {
  return cy
    .request({
      method: 'POST',
      url: '/api/role',
      headers: { 'X-API-Key': TEST_API_KEY },
      body: { name },
    })
    .then((res) => {
      expect(res.status).to.eq(201);
      return (res.body as { id: string }).id;
    });
}

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

describe('approval_flow self-referential children (Preceded By / Followed By)', () => {
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

  it('creates a new approval_flow with a Preceded By and a Followed By child attached via the autocomplete dialogs', () => {
    createRole('Role Main Create').then(() => {
      createRole('Role PrecededBy Create').then((precededByRoleId) => {
        createRole('Role FollowedBy Create').then((followedByRoleId) => {
          // Candidates share entity_name 'user' with the record created
          // below so the same-entity_name filter surfaces them.
          createApprovalFlow('user', precededByRoleId).then((precededByCandidate) => {
            createApprovalFlow('user', followedByRoleId).then((followedByCandidate) => {
              cy.visit('/en/approval_flow');
              cy.clickButton('Create New Approval Flow');
              cy.url().should('include', '/approval_flow/new');
              cy.selectAutocomplete('Entity Name', 'User');
              cy.selectAutocomplete('Approver Role', 'Role Main Create');

              cy.clickButton('Add Preceded By');
              cy.get('div[role="dialog"]').find('input').type('Role PrecededBy Create');
              cy.contains('.MuiAutocomplete-popper li', 'Role PrecededBy Create').click();
              cy.get('div[role="dialog"]').find('button').contains('Add').click();

              cy.clickButton('Add Followed By');
              cy.get('div[role="dialog"]').find('input').type('Role FollowedBy Create');
              cy.contains('.MuiAutocomplete-popper li', 'Role FollowedBy Create').click();
              cy.get('div[role="dialog"]').find('button').contains('Add').click();

              cy.clickButton('Save');
              cy.url().should('include', '/approval_flow');
              cy.url().should('not.include', '/approval_flow/new');

              // Verify server-side: the saved record actually links both
              // the intended children, not merely "some" candidate.
              cy.get('.MuiDataGrid-virtualScroller').scrollTo('bottom', { ensureScrollable: false });
              cy.get('.MuiDataGrid-row').last().find('a').first().click();
              cy.url().should('include', '/approval_flow/view');
              cy.location('pathname').then((path) => {
                const id = path.split('/').pop();
                cy.request({
                  method: 'GET',
                  url: `${API_BASE}/${id}`,
                  headers: { 'X-API-Key': TEST_API_KEY },
                }).then((res) => {
                  const precededByIds = (res.body.preceded_by ?? []).map((r: { id: string }) => r.id);
                  const followedByIds = (res.body.followed_by ?? []).map((r: { id: string }) => r.id);
                  expect(precededByIds).to.include(precededByCandidate.id);
                  expect(followedByIds).to.include(followedByCandidate.id);
                });
              });
            });
          });
        });
      });
    });
  });

  it('adds a Preceded By and a Followed By child to an existing approval_flow via the edit page', () => {
    createRole('Role Main Edit').then((mainRoleId) => {
      createRole('Role PrecededBy Edit').then((precededByRoleId) => {
        createRole('Role FollowedBy Edit').then((followedByRoleId) => {
          createApprovalFlow('user', mainRoleId).then((editTarget) => {
            createApprovalFlow('user', precededByRoleId).then((precededByCandidate) => {
              createApprovalFlow('user', followedByRoleId).then((followedByCandidate) => {
                cy.visit(`/en/approval_flow/edit/${editTarget.id}`);

                cy.clickButton('Add Preceded By');
                cy.get('div[role="dialog"]').find('input').type('Role PrecededBy Edit');
                cy.contains('.MuiAutocomplete-popper li', 'Role PrecededBy Edit').click();
                cy.get('div[role="dialog"]').find('button').contains('Add').click();

                cy.clickButton('Add Followed By');
                cy.get('div[role="dialog"]').find('input').type('Role FollowedBy Edit');
                cy.contains('.MuiAutocomplete-popper li', 'Role FollowedBy Edit').click();
                cy.get('div[role="dialog"]').find('button').contains('Add').click();

                cy.clickButton('Save');
                cy.url().should('include', '/approval_flow');
                cy.url().should('not.include', '/approval_flow/edit');

                cy.request({
                  method: 'GET',
                  url: `${API_BASE}/${editTarget.id}`,
                  headers: { 'X-API-Key': TEST_API_KEY },
                }).then((res) => {
                  const precededByIds = (res.body.preceded_by ?? []).map((r: { id: string }) => r.id);
                  const followedByIds = (res.body.followed_by ?? []).map((r: { id: string }) => r.id);
                  expect(precededByIds).to.include(precededByCandidate.id);
                  expect(followedByIds).to.include(followedByCandidate.id);
                });
              });
            });
          });
        });
      });
    });
  });
});
