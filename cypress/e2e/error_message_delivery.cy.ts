// Hand-written (not generator-produced) — cmd_695.
//
// Regression coverage for docs/knowledge/error-message-framework.md: Server
// Action errors used to `throw`, cross the React Server Components render
// boundary, and get replaced in production by a minified/opaque error
// message — losing the actionable text entirely. cmd_695 converted the
// throw sites named in the framework's Implementation Checklist to return
// an `ActionFailure` value instead.
//
// This spec exercises the three scenarios named literally in cmd_695's
// north star ("Insufficient privilege", "Unique key constraint violation",
// "Updated by another user") end-to-end through the browser, asserting the
// inline message renders and the page never falls through to
// error.tsx's generic/minified text. Uses approval_flow (self-seeding via
// direct API calls, same pattern as approval_flow_desktop_crud.cy.ts — see
// ../support/approval_flow_seed.ts) since it is a plain, non-org-scoped
// CRUD entity with both a real DB-level compound unique constraint
// (`@@unique([entity_name, approver_role_id])`, prisma/schema.prisma) and a
// tracked-snapshot update path, and does not require org-scoping
// infrastructure this dogfood schema does not currently have.
import { TEST_CREDENTIALS } from '../support/test-credentials';
import { apiCreateRole, apiCreateApprovalFlow } from '../support/approval_flow_seed';

function assertNoReactErrorBoundary() {
  // The whole point of cmd_695: these scenarios must never fall through to
  // error.tsx's generic/minified text.
  cy.contains('Minified React error').should('not.exist');
  cy.contains('Something went wrong').should('not.exist');
}

describe('Error message delivery (cmd_695 — Server Action ActionFailure conversion)', () => {
  beforeEach(() => {
    cy.task('db:reset');
    cy.task('db:seed');
    cy.task('db:grantAllPermissions');
    Cypress.session.clearAllSavedSessions();
    cy.clearCookies();
    cy.clearLocalStorage();
    cy.visit('/en/');
    cy.window().then((win) => { win.sessionStorage.clear(); });
  });

  it('1) unique constraint violation ("Unique key constraint violation") shows inline, not error.tsx', () => {
    cy.login(TEST_CREDENTIALS.email, TEST_CREDENTIALS.password);
    apiCreateRole('Approver Unique Test').then((role) => {
      apiCreateApprovalFlow({ entityName: 'user', approverRoleId: role.id }).then(() => {
        cy.visit('/en/approval_flow/new');
        cy.selectAutocomplete('Entity Name', 'User');
        cy.selectAutocomplete('Approver Role', role.name);
        cy.clickButton('Save');

        // Stays on the create form — the Server Action returned an
        // ActionFailure instead of redirecting.
        cy.url().should('include', '/approval_flow/new');
        assertNoReactErrorBoundary();
        // service.ts.jinja2 converts Prisma P2002 to
        // AppError('CONFLICT', ..., field) — form_upsert.tsx.jinja2 renders
        // this via the same 'fieldAlreadyLinked' i18n key as an OTO
        // conflict ("{field} is already linked to another record.").
        cy.contains('already linked to another record').should('be.visible');
        cy.screenshot('cmd695-1-unique-constraint-fixed', { capture: 'fullPage' });
      });
    });
  });

  it('2) stale update ("Updated since you opened it") shows inline, not error.tsx', () => {
    cy.login(TEST_CREDENTIALS.email, TEST_CREDENTIALS.password);
    apiCreateRole('Approver Stale Test A').then((roleA) => {
      apiCreateRole('Approver Stale Test B').then((roleB) => {
        apiCreateApprovalFlow({ entityName: 'user', approverRoleId: roleA.id }).then((record) => {
          cy.visit(`/en/approval_flow/edit/${record.id}`);
          cy.checkField('Approver Role', roleA.name);

          // Simulate a concurrent edit by another user — the already-open
          // form's captured __src_snapshot still reflects roleA.
          cy.request({
            method: 'PUT',
            url: `/api/approval_flow/${record.id}`,
            headers: { 'X-API-Key': 'test_mk_0000000000000000000000000000000000000000000000000000000000000000' },
            body: { entity_name: 'user', approver_role_id: roleB.id, precededBy_ids: [], followedBy_ids: [] },
          }).its('status').should('eq', 200);

          // Submit the still-open (now stale) form unchanged.
          cy.clickButton('Save');

          cy.url().should('include', `/approval_flow/edit/${record.id}`);
          assertNoReactErrorBoundary();
          // lib/normalize.ts assertNotStale throws AppError('CONFLICT') with
          // no field — form_upsert.tsx.jinja2 falls back to 'staleMutation'.
          // The message states only what the snapshot comparison can
          // actually establish (changed since it was opened) — it does not
          // claim "another user" (cmd_849).
          cy.contains('updated since you opened it').should('be.visible');
          cy.screenshot('cmd695-2-stale-update-fixed', { capture: 'fullPage' });
        });
      });
    });
  });

  it('3) permission denied on delete ("Insufficient privilege") shows inline, not error.tsx', () => {
    apiCreateRole('Approver Perm Test').then((role) => {
      apiCreateApprovalFlow({ entityName: 'user', approverRoleId: role.id }).then(() => {
        cy.task<string>('db:createSessionUserWithPermission', {
          entityName: 'approval_flow',
          flags: { read: true, delete: true },
          label: 'delete_perm_race',
        }).then((email) => {
          cy.login(email, TEST_CREDENTIALS.password);
          cy.visit('/en/approval_flow');
          cy.get('.MuiDataGrid-virtualScroller').scrollTo('bottom', { ensureScrollable: false });
          cy.contains('user').scrollIntoView().should('be.visible');

          // Revoke delete permission after the grid (and its Delete button)
          // already rendered with delete:true — the only reliable way to
          // reach actions.ts's requirePermission()-denied branch without
          // the page's own assertPermission() gate blocking navigation
          // first (see cypress.config.ts db:setEntityPermission comment).
          cy.task('db:setEntityPermission', {
            email,
            entityName: 'approval_flow',
            flags: { delete: false },
          });
          // getModelPermissions() (lib/authz.ts) is process-cached
          // (PERMISSION_TTL_MS = 30s) — the DB write above is invisible to
          // the running server until that entry expires. POSTing
          // /api/test-utils/reset-caches (cypress/support/db-helpers.ts's
          // own approach after db:reset) did NOT reliably bust it here —
          // empirically confirmed by a temporary diagnostic log in the
          // generated remove{Entity} action: the read after two resets +
          // 500ms still showed the pre-revoke `delete:true`, while the same
          // read after simply waiting past the 30s TTL (no reset call at
          // all) correctly showed `delete:false`. Root cause not fully
          // isolated (a background request racing the reset and re-caching
          // the stale value before the click is one candidate — see
          // db-helpers.ts's own straggler-request note for the api-key
          // cache's version of the same class of problem) — waiting out the
          // TTL sidesteps it entirely and is deterministic rather than
          // racy, at the cost of making this one test slow.
          cy.wait(31000);

          cy.get('.MuiDataGrid-row').first().find('input[type="checkbox"]').click();
          // ResponsiveListClient mounts both the desktop (DataGridClient)
          // and mobile (CardListClient) delete-selected controls during the
          // SSR->client hydration window at this viewport size before
          // useMediaQuery settles — filter to the one actually visible.
          cy.get('[aria-label="Delete Selected"]:visible').first().click();
          cy.get('#delete-dialog-title').should('be.visible');
          cy.get('[role="dialog"]:visible').find('[aria-label="Delete"]').click();

          assertNoReactErrorBoundary();
          // lib/authz.ts requirePermission throws
          // AppError('PERMISSION_DENIED') — actions.ts's remove{Entity}
          // catches it (cmd_695) and DataGridClient shows it via AppAlert
          // instead of crashing, and rolls back the optimistic removal.
          cy.contains('do not have permission').should('be.visible');
          cy.contains('user').should('be.visible');
          cy.screenshot('cmd695-3-permission-denied-fixed', { capture: 'fullPage' });
        });
      });
    });
  });
});
