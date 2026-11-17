// A hand-written route (probe_routes/rename_probe_route.ts) tested with the shipped security helpers:
// an actor without the role (403) and an actor from another organization (404), each with an explicit
// status, and each proving by re-reading the database that the denied write did not persist.
import { expectDeniedFor, seedActorFromOtherOrganization, seedActorWithoutRole } from '../../support/security_helpers';

type Account = { id: string; name: string };

describe('hand-written route /api/sx_account/{id}/rename_probe', () => {
  const url = (id: string) => `/api/sx_account/${id}/rename_probe`;

  // Start from a freshly seeded database, as the generated specs do: the helpers create fixed-name
  // users and keys, which collide with rows left behind by the spec that ran before this one.
  beforeEach(() => {
    cy.task('db:reset');
    cy.task('db:seed');
    cy.task('db:grantAllPermissions');
    Cypress.session.clearAllSavedSessions();
  });

  it('refuses an actor without the permission (403) and leaves the row unchanged', () => {
    // The route is another write path to the update cell, so it claims that cell.
    // security-cell: entity=sx_account operation=update case=permission_denied
    cy.task<Account[]>('db:populateSxAccount', 1).then(([account]) => {
      seedActorWithoutRole('sx_account').then((actor) => {
        expectDeniedFor({
          cell: { entity: 'sx_account', operation: 'update', case: 'permission_denied' },
          status: 403,
          actor,
          request: { method: 'PATCH', url: url(account.id), body: { name: 'renamed by a denied actor' } },
          persistence: { model: 'sx_account', where: { id: account.id } },
        });
      });
    });
  });

  it('hides a row of another organization (404) and leaves it unchanged', () => {
    // security-cell: entity=sx_account operation=update case=cross_org
    cy.task<Account[]>('db:populateSxAccount', 1).then(([account]) => {
      seedActorFromOtherOrganization('sx_account', account.id).then(({ actor, targetId }) => {
        expectDeniedFor({
          cell: { entity: 'sx_account', operation: 'update', case: 'cross_org' },
          status: 404,
          actor,
          request: { method: 'PATCH', url: url(targetId), body: { name: 'renamed across organizations' } },
          persistence: { model: 'sx_account', where: { id: targetId } },
        });
      });
    });
  });
});
