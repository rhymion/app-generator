import { TEST_CREDENTIALS } from '../../support/test-credentials';

// FK read-permission graceful degradation: browser-session regression
// coverage. The generated API spec (cypress/e2e/api/approval_flow.cy.ts,
// "preserves approver_role_id ... omits it from the PUT body") proves the
// server-side persistence guarantee via a raw API-key PUT. This spec proves
// the actual UI path an acting user with full CRUD on approval_flow but no
// read permission on its required FK target (role) experiences: the edit
// page must not crash, and saving unrelated field changes must still
// succeed. See docs/knowledge/fk-read-permission-graceful-degradation.md.
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
    cy.task<any[]>('db:populateApprovalFlow', 1).then((records) => {
      cy.task<string>('db:createSessionUserWithPermission', {
        entityName: 'approval_flow',
        flags: { create: true, read: true, update: true, delete: true },
        label: 'ui_fk_read_denied_a',
      }).then((email) => {
        cy.login(email, TEST_CREDENTIALS.password);
        cy.visit(`/en/approval_flow/edit/${records[0].id}`);
        // Previously: search{Entity}Options() threw inside Promise.all,
        // crashing the whole page. Now: the FK field renders as a
        // disabled, labeled field instead.
        cy.contains('Entity Name').should('be.visible');
        cy.contains('Approver Role').should('be.visible');
      });
    });
  });

  it('b) other fields can still be changed and saved when the required FK target (role) is unreadable', () => {
    cy.task<any[]>('db:populateApprovalFlow', 1).then((records) => {
      cy.task<string>('db:createSessionUserWithPermission', {
        entityName: 'approval_flow',
        flags: { create: true, read: true, update: true, delete: true },
        label: 'ui_fk_read_denied_b',
      }).then((email) => {
        cy.login(email, TEST_CREDENTIALS.password);
        cy.visit(`/en/approval_flow/edit/${records[0].id}`);
        cy.selectAutocomplete('Entity Name', 'Setting');
        cy.clickButton('Save');
        cy.url().should('include', '/approval_flow');
        cy.url().should('not.include', '/approval_flow/edit');
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
    cy.task<any[]>('db:populateApprovalFlowFull', 1).then((records) => {
      cy.task<string>('db:createSessionUserWithPermission', {
        entityName: 'approval_flow',
        flags: { create: true, read: true, update: true, delete: true },
        label: 'ui_fk_read_denied_c',
      }).then((email) => {
        cy.login(email, TEST_CREDENTIALS.password);
        cy.visit(`/en/approval_flow/edit/${records[0].id}`);
        // Exactly one clear affordance on the page: the optional FK's.
        cy.get('button[aria-label="clear"]').should('have.length', 1);
        cy.get('button[aria-label="clear"]').click();
        cy.clickButton('Save');
        cy.url().should('include', '/approval_flow');
        cy.url().should('not.include', '/approval_flow/edit');
        cy.visit(`/en/approval_flow/view/${records[0].id}`);
        cy.checkField('Requestor Role', '');
        cy.checkField('Approver Role', 'Test Approver Role 1');
      });
    });
  });
});
