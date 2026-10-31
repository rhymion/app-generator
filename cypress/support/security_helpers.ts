// Cypress helpers for security tests of hand-written code (routes the generator did not write).
// The vitest counterpart is test/helpers/security.ts; both share test/helpers/security_core.ts.
// Worked example: docs/knowledge/security-test-helpers.md.
//
//   // security-cell: entity=sx_account operation=update case=permission_denied
//   seedActorWithoutRole('sx_account').then((actor) => {
//     expectDeniedFor({
//       cell: { entity: 'sx_account', operation: 'update', case: 'permission_denied' },
//       status: 403,
//       actor,
//       request: { method: 'PATCH', url: `/api/sx_account/${id}/rename`, body: { name: 'x' } },
//       persistence: { model: 'sx_account', where: { id } },
//     });
//   });
import { TEST_API_KEY } from './test-credentials';
import { assertPersistenceDeclared, type PersistenceSpec, type SecurityCell } from '../../test/helpers/security_core';

export type { SecurityCell, PersistenceSpec };

export type SecurityActor = { apiKey: string };

export type ExpectDeniedForOptions = {
  /** The matrix cell this test claims; the `security-cell:` marker comment names the same cell. */
  cell: SecurityCell;
  /** Explicit status, 401/403/404: "any 4xx" is not accepted. */
  status: number;
  actor: SecurityActor;
  request: { method: string; url: string; body?: unknown };
  /** Required for POST/PUT/PATCH/DELETE: the rows re-read from the database before and after. */
  persistence?: PersistenceSpec;
};

/** An actor whose role holds the entity's permission row with every flag false (no permission). */
export function seedActorWithoutRole(entity: string): Cypress.Chainable<SecurityActor> {
  return cy.task<string>('db:createLimitedApiUser', entity).then((apiKey) => ({ apiKey }));
}

/**
 * An actor from another organization: moves the row `entityId` into an organization the main test
 * user (the returned actor) does not belong to. The row is then foreign to the actor.
 */
export function seedActorFromOtherOrganization(
  entity: string,
  entityId: string,
): Cypress.Chainable<{ actor: SecurityActor; targetId: string; foreignOrganizationId: string }> {
  return cy
    .task<{ orgB: { id: string }; entityInOrgB: { id: string } }>('db:createCrossOrgScenario', { entityName: entity, entityId })
    .then((scenario) => ({
      actor: { apiKey: TEST_API_KEY },
      targetId: scenario.entityInOrgB.id,
      foreignOrganizationId: scenario.orgB.id,
    }));
}

/**
 * Asserts that `actor` is refused with exactly `status`, and that the denied write left the database
 * unchanged (the rows named by `persistence` are re-read from the database before and after).
 */
export function expectDeniedFor(options: ExpectDeniedForOptions): Cypress.Chainable<unknown> {
  const { cell, status, actor, request, persistence } = options;
  assertPersistenceDeclared(request.method, persistence);
  return cy.task('security:checkCell', { cell, status }).then(() => {
    const send = () =>
      cy.request({
        method: request.method,
        url: request.url,
        headers: { 'X-API-Key': actor.apiKey },
        body: request.body,
        failOnStatusCode: false,
      });
    if (!persistence) {
      return send().then((res) => {
        expect(res.status, `${request.method} ${request.url}`).to.eq(status);
      });
    }
    return cy.task('security:snapshot', persistence).then((before) =>
      send().then((res) => {
        expect(res.status, `${request.method} ${request.url}`).to.eq(status);
        return cy.task('security:snapshot', persistence).then((after) => {
          expect(after, `${persistence.model} rows after the denied request`).to.deep.eq(before);
        });
      }),
    );
  });
}
