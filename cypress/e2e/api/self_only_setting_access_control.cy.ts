import { TEST_API_KEY } from '../../support/test-credentials';

// x-self-only access-control regression coverage for `setting`
// (x-self-only: { admin_bypass: true }) - cmd_536. `setting` is a proxy
// view of the acting user's OWN `user` row (allOf: [$ref: user, ...]), so
// its self-only scope must be entity (route/getter) -scoped - never the
// `user` model as a whole, or every other entity's FK reference to `user`
// (mentions, comment creators, approvers, etc.) would go blind too. See
// docs/knowledge/self-only-entity.md.
//
// `db:createApiUserWithPermission` returns only the new user's API key
// (`test_mk_${label}_${entityName}_${newUserId}`); the trailing 24-char
// cuid2 IS the new user's own id (and the id `setting`'s route param
// expects, since `setting`'s backing model is `user` itself).
function userIdFromApiKey(apiKey: string): string {
  const match = apiKey.match(/([a-z0-9]{24})$/);
  if (!match) throw new Error(`Could not extract user id from API key: ${apiKey}`);
  return match[1];
}

describe('x-self-only access control (setting)', () => {
  beforeEach(() => {
    cy.task('db:reset');
    cy.task('db:seed');
    cy.task('db:grantAllPermissions');
    Cypress.session.clearAllSavedSessions();
  });

  it('a user can read/edit their own setting, but not another user\'s (404, not 403)', () => {
    cy.task<string>('db:createApiUserWithPermission', {
      entityName: 'setting',
      flags: { read: true, update: true },
      label: 'owner',
    }).then((ownerKey) => {
      const ownerId = userIdFromApiKey(ownerKey);

      cy.task<string>('db:createApiUserWithPermission', {
        entityName: 'setting',
        flags: { read: true, update: true },
        label: 'other',
      }).then((otherKey) => {
        const otherId = userIdFromApiKey(otherKey);

        cy.request({
          url: `/api/setting/${ownerId}`,
          headers: { 'X-API-Key': ownerKey },
        }).then((res) => {
          expect(res.status).to.eq(200);
          expect(res.body.id).to.eq(ownerId);
        });

        cy.request({
          url: `/api/setting/${otherId}`,
          headers: { 'X-API-Key': ownerKey },
          failOnStatusCode: false,
        }).then((res) => {
          expect(res.status).to.eq(404);
        });

        cy.request({
          method: 'PUT',
          url: `/api/setting/${ownerId}`,
          headers: { 'X-API-Key': ownerKey },
          body: { name: 'Updated Own Name', email: `owner_${ownerId}@example.com` },
        }).then((res) => {
          expect(res.status).to.eq(200);
        });

        cy.request({
          method: 'PUT',
          url: `/api/setting/${otherId}`,
          headers: { 'X-API-Key': ownerKey },
          body: { name: 'Attempted Hijack', email: `other_${otherId}@example.com` },
          failOnStatusCode: false,
        }).then((res) => {
          expect(res.status).to.eq(404);
        });
      });
    });
  });

  it('an Administrator CAN read another user\'s setting via admin_bypass, and the access is audited', () => {
    cy.task<string>('db:createApiUserWithPermission', {
      entityName: 'setting',
      flags: { read: true },
      label: 'bypass_target',
    }).then((targetKey) => {
      const targetId = userIdFromApiKey(targetKey);

      cy.request({
        url: `/api/setting/${targetId}`,
        headers: { 'X-API-Key': TEST_API_KEY },
      }).then((res) => {
        expect(res.status).to.eq(200);
        expect(res.body.id).to.eq(targetId);
      });

      cy.request({
        url: '/api/audit_log',
        headers: { 'X-API-Key': TEST_API_KEY },
      }).then((res) => {
        expect(res.status).to.eq(200);
        const bypassEvents = (res.body.rows as any[]).filter(
          (row) => row.action === 'self_only:admin_bypass' && row.target_table === 'setting',
        );
        expect(bypassEvents.length).to.be.greaterThan(0);
        expect(bypassEvents[0].actor_user_id).to.be.a('string').and.not.be.empty;
      });
    });
  });

  it('other users\' names stay visible through the `user` entity itself (self-only never touches user)', () => {
    cy.task<string>('db:createApiUserWithPermission', {
      entityName: 'user',
      flags: { read: true },
      label: 'user_reader',
    }).then((readerKey) => {
      cy.request({
        url: '/api/user',
        headers: { 'X-API-Key': readerKey },
      }).then((res) => {
        expect(res.status).to.eq(200);
        expect((res.body.rows as any[]).length).to.be.greaterThan(0);
      });
    });
  });
});
