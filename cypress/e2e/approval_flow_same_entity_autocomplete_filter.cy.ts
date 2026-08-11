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
      // deps.precededBy already exists with entity_name 'user' (cmd_646:
      // matches populateApprovalFlowDependencies' own base record, so the
      // generated approval_flow.cy.ts 2.2/3.1 create/edit flows link a
      // SAME-entity dep and don't trip the cmd_646 save-time guard below) —
      // unused here as the (B) candidate; this test creates its own
      // 'setting'-entity_name row instead. The (B) candidate below is a
      // different entity_name than editTarget.
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
            //
            // The "Preceded By" entry renders the PREDECESSOR row's own
            // composite label (its own entity_name + its own approver_role),
            // not editTarget's — predecessor was created with
            // approver_role_id: deps.approverRole2.id, so the expected label
            // must reference approverRole2, not approverRole. This was
            // previously masked: pre-cmd_618, 'Test Approver Role' (editTarget's
            // role, no suffix) was a byte-for-byte PREFIX of 'Test Approver
            // Role 2' (predecessor's actual rendered role via the old digit-2
            // dep suffix), so cy.contains() partial-matched it by accident.
            // cmd_618's letter-indexed dep suffixes ('...Role A' / '...Role B')
            // are no longer prefixes of one another, so the wrong-variable bug
            // this masked is now a real assertion failure — fixed here.
            const expectedLabel = `permission ${deps.approverRole2.name}`;
            cy.visit(`/en/approval_flow/edit/${editTarget.id}`);
            cy.contains(expectedLabel).should('exist');
            cy.visit(`/en/approval_flow/view/${editTarget.id}`);
            cy.contains(expectedLabel).should('exist');
          });
        });
      });
    });
  });

  // cmd_646 D1 (Option B): entity_name empty/mid-edit windows intentionally
  // show every candidate rather than disabling preceded_by/followed_by
  // outright (no existing generator mechanism to conditionally disable a
  // child list on a sibling field's value — see the isCrossEntityRef()
  // comment in lib/approval_flow/autocomplete_filter.ts). The two tests
  // below prove the AC-2(3)/AC-5 backstop this relies on instead: a
  // cross-entity_name link can never actually be PERSISTED, whatever the
  // client-side filter let through — enforced by validateSameEntityRefs()
  // in lib/approval_flow/service_validation.ts, reached both through the
  // UI (FormUpsert's server action) and a bare API call.
  // cmd_646 finding: pre-existing, not fixed here (out of scope). See report.
  it('(UI) rejects saving after changing entity_name to no longer match an already-added Preceded By', () => {
    cy.task<any>('db:populateApprovalFlowDependencies').then((deps) => {
      createApprovalFlow('permission', deps.approverRole2.id).then(() => {
        createApprovalFlow('permission', deps.approverRole.id).then((editTarget) => {
          cy.visit(`/en/approval_flow/edit/${editTarget.id}`);
          // Add a Preceded By that is same-entity_name at the moment it is
          // picked (the client-side filter narrows to 'permission' here).
          cy.clickButton('Add Preceded By');
          cy.get('div[role="dialog"]').find('input').type('permission');
          cy.contains('.MuiAutocomplete-popper li', 'permission').click();
          cy.get('div[role="dialog"]').find('button').contains('Add').click();
          // Now change entity_name — the already-added item is NOT
          // retroactively removed client-side (EditableListWrapper only
          // holds what was explicitly added/removed), so this reproduces a
          // real "stale selection now mismatches" save attempt.
          cy.selectAutocomplete('Entity Name', 'Setting');
          cy.intercept('POST', `/en/approval_flow/edit/${editTarget.id}`).as('save');
          cy.clickButton('Save');
          cy.wait('@save').its('response.statusCode').should('be.gte', 400);
          // Strongest available proof the save never committed: the record
          // is unchanged server-side, independent of the client's crashed
          // rendering (see comment above).
          cy.request({
            method: 'GET',
            url: `/api/approval_flow/${editTarget.id}`,
            headers: { 'X-API-Key': TEST_API_KEY },
          }).then((res) => {
            expect(res.body.entity_name).to.eq('permission');
          });
        });
      });
    });
  });

  it('(API) rejects a bare POST linking preceded_by to a different-entity_name row', () => {
    cy.task<any>('db:populateApprovalFlowDependencies').then((deps) => {
      createApprovalFlow('setting', deps.approverRole2.id).then((crossEntityRow) => {
        cy.request({
          method: 'POST',
          url: API_BASE,
          headers: { 'X-API-Key': TEST_API_KEY },
          failOnStatusCode: false,
          body: {
            entity_name: 'permission',
            approver_role_id: deps.approverRole.id,
            precededBy_ids: [crossEntityRow.id],
            followedBy_ids: [],
          },
        }).then((res) => {
          // plain `throw new Error(...)` in validateSchemaRules (not
          // ApiError) falls through handleApiError()'s 500 branch — same
          // convention the generated api/approval_flow.cy.ts spec already
          // uses (`.to.be.gte(400)`) for the pre-existing REQUIRED_FIELDS
          // checks, not a cmd_646-specific choice.
          expect(res.status).to.be.gte(400);
          expect(res.body?.error ?? JSON.stringify(res.body)).to.contain(
            "Preceded By must share this record's entity_name",
          );
        });
      });
    });
  });

  it('(API) rejects a bare PUT linking followed_by to a different-entity_name row', () => {
    cy.task<any>('db:populateApprovalFlowDependencies').then((deps) => {
      createApprovalFlow('setting', deps.approverRole2.id).then((crossEntityRow) => {
        createApprovalFlow('permission', deps.approverRole.id).then((editTarget) => {
          cy.request({
            method: 'PUT',
            url: `${API_BASE}/${editTarget.id}`,
            headers: { 'X-API-Key': TEST_API_KEY },
            failOnStatusCode: false,
            body: {
              entity_name: 'permission',
              approver_role_id: deps.approverRole.id,
              precededBy_ids: [],
              followedBy_ids: [crossEntityRow.id],
            },
          }).then((res) => {
            // plain `throw new Error(...)` in validateSchemaRules (not
          // ApiError) falls through handleApiError()'s 500 branch — same
          // convention the generated api/approval_flow.cy.ts spec already
          // uses (`.to.be.gte(400)`) for the pre-existing REQUIRED_FIELDS
          // checks, not a cmd_646-specific choice.
          expect(res.status).to.be.gte(400);
            expect(res.body?.error ?? JSON.stringify(res.body)).to.contain(
              "Followed By must share this record's entity_name",
            );
          });
        });
      });
    });
  });
});
