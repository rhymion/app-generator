// Hand-written -- not part of the generated entity test set.
// The permission cache keeps what a user may do for up to 30 seconds in a production build. A change made
// through the REST API to a role or to one of its permissions must apply on the next request, not after
// that window. Verified by: permission_cache_invalidation.cy.ts.
import { TEST_API_KEY } from '../../support/test-credentials';

const LABEL = 'pcache';
const ADMIN = { 'X-API-Key': TEST_API_KEY };

type Row = { id: string; name: string; role_id?: string | null };

function rows(body: unknown): Row[] {
  return (body as { rows: Row[] }).rows;
}

describe('API: permission cache is cleared by role and permission writes', () => {
  let limitedKey: string;
  let roleId: string;

  beforeEach(() => {
    cy.task('db:reset');
    cy.task('db:seed');
    cy.task('db:grantAllPermissions');
    // The limited user may only read the `role` entity.
    cy.task<string>('db:createApiUserWithPermission', {
      entityName: 'role',
      flags: { read: true },
      label: LABEL,
    }).then((key) => {
      limitedKey = key;
      // The first request fills the cache with the grant.
      cy.request({ url: '/api/role', headers: { 'X-API-Key': limitedKey } }).its('status').should('eq', 200);
      cy.request({ url: '/api/role?pageSize=100', headers: ADMIN }).then((res) => {
        const role = (rows(res.body) as Array<Row & { name: string }>).find((r) => r.name.startsWith(`ApiRole_${LABEL}_role_`));
        expect(role, 'the limited user role').to.exist;
        roleId = role!.id;
      });
    });
  });

  it('applies a permission update on the next request', () => {
    cy.request({ url: '/api/permission?pageSize=100', headers: ADMIN }).then((res) => {
      const grant = rows(res.body).find((r) => r.name === 'role' && r.role_id === roleId);
      expect(grant, 'the read grant').to.exist;
      cy.request({
        method: 'PUT',
        url: `/api/permission/${grant!.id}`,
        headers: ADMIN,
        body: { name: 'role', create: false, read: false, update: false, delete: false, import: false, role_id: roleId },
      }).its('status').should('eq', 200);
    });
    cy.request({ url: '/api/role', headers: { 'X-API-Key': limitedKey }, failOnStatusCode: false })
      .its('status')
      .should('eq', 403);
  });

  it('applies a permission delete on the next request', () => {
    cy.request({ url: '/api/permission?pageSize=100', headers: ADMIN }).then((res) => {
      const grant = rows(res.body).find((r) => r.name === 'role' && r.role_id === roleId);
      expect(grant, 'the read grant').to.exist;
      cy.request({ method: 'DELETE', url: `/api/permission/${grant!.id}`, headers: ADMIN }).its('status').should('eq', 204);
    });
    cy.request({ url: '/api/role', headers: { 'X-API-Key': limitedKey }, failOnStatusCode: false })
      .its('status')
      .should('eq', 403);
  });
});
