import { TEST_API_KEY, TEST_CREDENTIALS } from '../../support/test-credentials';

// x-self-only access-control regression coverage for personal_note
// (x-self-only: { admin_bypass: true }).
//
// The generated spec (cypress/e2e/api/personal_note.cy.ts) only ever
// exercises the OWNER's own rows — db:grantAllPermissions makes
// TEST_CREDENTIALS both the row's creator and an Administrator, so it can't
// tell an ownership-based invariant apart from an ordinary permission grant.
// This spec proves the actual invariant: a grant of general.read cannot
// widen visibility beyond the row's creator, an audited admin_bypass grant
// can, and unauthenticated vs. authenticated-non-owner get different status
// codes.
describe('x-self-only access control (personal_note)', () => {
  beforeEach(() => {
    cy.task('db:reset');
    cy.task('db:seed');
    // TEST_CREDENTIALS becomes an Administrator (general CRUD on every
    // entity, and — separately — the literal 'Administrator' role that
    // trySelfOnlyAdminBypass() checks for).
    cy.task('db:grantAllPermissions');
    Cypress.session.clearAllSavedSessions();
  });

  it('general.read=true on a non-owner does NOT expose another user\'s row (list is empty, detail is 404)', () => {
    cy.task<string>('db:createApiUserWithPermission', {
      entityName: 'personal_note',
      flags: { create: true, read: true },
      label: 'owner',
    }).then((ownerKey) => {
      cy.request({
        method: 'POST',
        url: '/api/personal_note',
        headers: { 'X-API-Key': ownerKey },
        body: { title: 'Owner private note' },
      }).then((createRes) => {
        expect(createRes.status).to.eq(201);
        const noteId = createRes.body.id as string;

        cy.task<string>('db:createApiUserWithPermission', {
          entityName: 'personal_note',
          // general.read: true — this is exactly the permission grant the
          // pre-x-self-only creator scope would have let bypass ownership.
          flags: { read: true },
          label: 'cross_user_reader',
        }).then((otherReaderKey) => {
          // Detail: authenticated, general.read=true, NOT the owner → 404,
          // not 403 — "not found" unifies "no permission" (cmd_523 pattern).
          cy.request({
            url: `/api/personal_note/${noteId}`,
            headers: { 'X-API-Key': otherReaderKey },
            failOnStatusCode: false,
          }).then((res) => {
            expect(res.status).to.eq(404);
          });

          // List: the row exists, but must not appear for a non-owner even
          // though they hold general.read=true on the whole entity.
          cy.request({
            url: '/api/personal_note',
            headers: { 'X-API-Key': otherReaderKey },
          }).then((res) => {
            expect(res.status).to.eq(200);
            expect(res.body.rows).to.deep.eq([]);
            expect(res.body.total).to.eq(0);
          });

          // Sanity: the owner itself can still see it.
          cy.request({
            url: `/api/personal_note/${noteId}`,
            headers: { 'X-API-Key': ownerKey },
          }).then((res) => {
            expect(res.status).to.eq(200);
            expect(res.body.id).to.eq(noteId);
          });
        });
      });
    });
  });

  it('a privileged (Administrator) user CAN read another user\'s row via admin_bypass, and the access is audited', () => {
    cy.task<string>('db:createApiUserWithPermission', {
      entityName: 'personal_note',
      flags: { create: true, read: true },
      label: 'owner2',
    }).then((ownerKey) => {
      cy.request({
        method: 'POST',
        url: '/api/personal_note',
        headers: { 'X-API-Key': ownerKey },
        body: { title: 'Note the admin will inspect' },
      }).then((createRes) => {
        const noteId = createRes.body.id as string;

        // TEST_CREDENTIALS holds the literal 'Administrator' role (from
        // db:grantAllPermissions above) and is NOT this row's creator.
        cy.request({
          url: `/api/personal_note/${noteId}`,
          headers: { 'X-API-Key': TEST_API_KEY },
        }).then((res) => {
          expect(res.status).to.eq(200);
          expect(res.body.id).to.eq(noteId);
        });

        // The bypass must have left an audit trail — read it back via the
        // real audit_log API (also Administrator-gated).
        cy.request({
          url: '/api/audit_log',
          headers: { 'X-API-Key': TEST_API_KEY },
        }).then((res) => {
          expect(res.status).to.eq(200);
          const bypassEvents = (res.body.rows as any[]).filter(
            (row) => row.action === 'self_only:admin_bypass' && row.target_table === 'personal_note',
          );
          expect(bypassEvents.length).to.be.greaterThan(0);
          expect(bypassEvents[0].actor_user_id).to.be.a('string').and.not.be.empty;
        });
      });
    });
  });

  it('unauthenticated request gets 401; authenticated non-owner gets 404 — never confused', () => {
    cy.task<string>('db:createApiUserWithPermission', {
      entityName: 'personal_note',
      flags: { create: true, read: true },
      label: 'owner3',
    }).then((ownerKey) => {
      cy.request({
        method: 'POST',
        url: '/api/personal_note',
        headers: { 'X-API-Key': ownerKey },
        body: { title: 'Note for 401 vs 404 check' },
      }).then((createRes) => {
        const noteId = createRes.body.id as string;

        // No API key at all → 401 (missing credentials).
        cy.request({
          url: `/api/personal_note/${noteId}`,
          failOnStatusCode: false,
        }).then((res) => {
          expect(res.status).to.eq(401);
        });

        // Invalid API key → 401 (bad credentials) — never 404, which would
        // leak "this id exists" to an unauthenticated caller.
        cy.request({
          url: `/api/personal_note/${noteId}`,
          headers: { 'X-API-Key': 'not_a_real_key' },
          failOnStatusCode: false,
        }).then((res) => {
          expect(res.status).to.eq(401);
        });

        // Authenticated, but not the owner and no admin_bypass role → 404,
        // never 401 (they ARE authenticated) and never 403 (would confirm
        // the row exists but is someone else's — 404 also denies that).
        cy.task<string>('db:createApiUserWithPermission', {
          entityName: 'personal_note',
          flags: { read: true },
          label: 'non_owner_401_vs_404',
        }).then((nonOwnerKey) => {
          cy.request({
            url: `/api/personal_note/${noteId}`,
            headers: { 'X-API-Key': nonOwnerKey },
            failOnStatusCode: false,
          }).then((res) => {
            expect(res.status).to.eq(404);
          });
        });
      });
    });
  });
});
