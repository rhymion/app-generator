import { TEST_API_KEY, TEST_CREDENTIALS } from '../support/test-credentials';

// Self-contained dependency seeding (cmd_663) — this spec used to call the
// generator-produced `db:populateApprovalFlow` / `db:populateApprovalFlowFull`
// Cypress tasks, which lived in cypress/support/approval_flow/helper.ts. That
// file is only written while x-generate.test is true for approval_flow; cmd_661
// set approval_flow to test: false, which silently broke this spec as
// collateral damage — verified by grepping the repo for both task names and
// finding no registration left anywhere except this file's own now-dead
// cy.task() calls. Fixed the same way cmd_661 already fixed
// approval_flow_same_entity_autocomplete_filter.cy.ts: seed directly through
// the (still generated, still api: true) /api/role and /api/approval_flow
// endpoints instead of depending on generated test scaffolding. db:reset in
// beforeEach wipes the DB before every test, so a plain create (no
// find-or-create) is enough — each test starts from empty.
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

function createApprovalFlow(body: {
  entity_name: string;
  approver_role_id: string;
  requestor_role_id?: string;
}) {
  return cy
    .request({
      method: 'POST',
      url: '/api/approval_flow',
      headers: { 'X-API-Key': TEST_API_KEY },
      body: { ...body, precededBy_ids: [], followedBy_ids: [] },
    })
    .then((res) => {
      expect(res.status).to.eq(201);
      return res.body as { id: string };
    });
}

// FK read-permission graceful degradation: browser-session regression
// coverage. Moved here from cypress/e2e/api/ (cmd_648) — every case in this
// file drives the browser (cy.visit/cy.login/cy.selectAutocomplete) and
// never issues a raw cy.request, so it was never actually API-gate coverage
// despite living under api/; it belongs in test:e2e:cy:ui's spec glob
// (cypress/e2e/*.cy.ts), not test:e2e:cy:api's. The generated API spec
// (cypress/e2e/api/approval_flow.cy.ts, "4.4 preserves approver_role_id ...
// omits it from the PUT body" and "4.5 returns 200 for GET (list and
// detail) when the acting user cannot read role") proves the server-side
// contract via raw X-API-Key requests — that pair is this file's API-side
// counterpart and now carries the mandatory-gate coverage for the same
// underlying mechanism. This spec proves the actual UI path an acting user
// with full CRUD on approval_flow but no read permission on its required FK
// target (role) experiences: the edit page must not crash, and saving
// unrelated field changes must still succeed. See
// docs/knowledge/fk-read-permission-graceful-degradation.md.
//
// The same graceful-degradation treatment applied to the selector
// one-to-one autocomplete (getAvailable{Target}sFor{Parent}()) has no live
// counterpart in this schema — no entity currently declares a selector
// one-to-one relation — so it is verified by code inspection only:
// getters.ts.jinja2 applies the identical no-throw treatment to both code
// paths.
describe('FK read-permission graceful degradation — browser session', () => {
  beforeEach(() => {
    cy.task('db:reset');
    cy.task('db:seed');
    cy.task('db:grantAllPermissions');
    Cypress.session.clearAllSavedSessions();
  });

  it('a) the edit page opens without crashing when the actor cannot read the required FK target (role)', () => {
    createRole('Test Approver Role A').then((approverRoleId) => {
      createApprovalFlow({ entity_name: 'user', approver_role_id: approverRoleId }).then((record) => {
        cy.task<string>('db:createSessionUserWithPermission', {
          entityName: 'approval_flow',
          flags: { create: true, read: true, update: true, delete: true },
          label: 'ui_fk_read_denied_a',
        }).then((email) => {
          cy.login(email, TEST_CREDENTIALS.password);
          cy.visit(`/en/approval_flow/edit/${record.id}`);
          // Previously: search{Entity}Options() threw inside Promise.all,
          // crashing the whole page. Now: the FK field renders as a
          // disabled, labeled field instead.
          cy.contains('Entity Name').should('be.visible');
          cy.contains('Approver Role').should('be.visible');
        });
      });
    });
  });

  it('b) other fields can still be changed and saved when the required FK target (role) is unreadable', () => {
    createRole('Test Approver Role B').then((approverRoleId) => {
      createApprovalFlow({ entity_name: 'user', approver_role_id: approverRoleId }).then((record) => {
        cy.task<string>('db:createSessionUserWithPermission', {
          entityName: 'approval_flow',
          flags: { create: true, read: true, update: true, delete: true },
          label: 'ui_fk_read_denied_b',
        }).then((email) => {
          cy.login(email, TEST_CREDENTIALS.password);
          cy.visit(`/en/approval_flow/edit/${record.id}`);
          cy.selectAutocomplete('Entity Name', 'Setting');
          cy.clickButton('Save');
          cy.url().should('include', '/approval_flow');
          cy.url().should('not.include', '/approval_flow/edit');
        });
      });
    });
  });

  it('c) an optional denied FK (requestor role) can be cleared; the required one (approver role) cannot', () => {
    // approval_flow has two FKs to role: requestor_role_id (optional) and
    // approver_role_id (required). Denying read on role makes both
    // permission-denied at once, letting a single actor exercise the
    // asymmetry: AppFieldRelation only renders a clear button
    // (`!required && !!value`) for the optional one — clearing a required
    // FK would leave the record permanently unsubmittable, since there is
    // no way for this actor to pick a replacement.
    createRole('Test Requestor Role C').then((requestorRoleId) => {
      createRole('Test Approver Role C').then((approverRoleId) => {
        createApprovalFlow({
          entity_name: 'user',
          requestor_role_id: requestorRoleId,
          approver_role_id: approverRoleId,
        }).then((record) => {
          cy.task<string>('db:createSessionUserWithPermission', {
            entityName: 'approval_flow',
            flags: { create: true, read: true, update: true, delete: true },
            label: 'ui_fk_read_denied_c',
          }).then((email) => {
            cy.login(email, TEST_CREDENTIALS.password);
            cy.visit(`/en/approval_flow/edit/${record.id}`);
            // Capture the seeded Approver Role label instead of asserting a
            // hardcoded literal (cmd_620: populateApprovalFlowFullData's
            // primary-FK-dep row is now callIndex-suffixed to give every call a
            // fully isolated row, so the exact string depends on how many prior
            // calls happened in this process — round-trip the actual value
            // instead of assuming it's always the first-ever call).
            cy.getFieldValue('Approver Role').then((approverRoleLabel) => {
              // Exactly one clear affordance on the page: the optional FK's.
              cy.get('button[aria-label="clear"]').should('have.length', 1);
              cy.get('button[aria-label="clear"]').click();
              cy.clickButton('Save');
              cy.url().should('include', '/approval_flow');
              cy.url().should('not.include', '/approval_flow/edit');
              cy.visit(`/en/approval_flow/view/${record.id}`);
              cy.checkField('Requestor Role', '');
              cy.checkField('Approver Role', approverRoleLabel);
            });
          });
        });
      });
    });
  });
});
