# Security test helpers for hand-written code

A permission-denied or cross-organization test for a route you wrote yourself takes enough setup that it tends to be
skipped. The generator ships short helpers for it, for Cypress and for vitest, built on the security test matrix
(`docs/knowledge/security-test-matrix.md`): they claim a matrix cell, they use the status the matrix declares for it,
and they prove a denied write left the database unchanged.

## Files

| File | Role |
|------|------|
| `test/helpers/security_core.ts` (+ `security_manifest.ts`, Node-only manifest reader) | Shared checks: the claimed cell exists in `.security-manifest.json`, the status equals the matrix's `denied_status`, a write names the rows to re-read, the rows are unchanged. |
| `cypress/support/security_helpers.ts` | Cypress: `expectDeniedFor`, `seedActorWithoutRole`, `seedActorFromOtherOrganization`. Uses the tasks `security:checkCell` and `security:snapshot` of `cypress.config.ts`. |
| `test/helpers/security.ts` | vitest: the same three helpers (`fetch` against a running app, rows re-read through Prisma). |

An app gets them with `app-generator/` itself; nothing is generated per entity.

## `expectDeniedFor`

```ts
expectDeniedFor({
  cell: { entity, operation, case },   // the matrix cell this test claims
  status: 403,                         // explicit: 401, 403 or 404. "Any 4xx" is not accepted.
  actor,                               // { apiKey }
  request: { method, url, body },
  persistence: { model, where },       // required for POST/PUT/PATCH/DELETE
});
```

It fails when

- the cell is not in the manifest (a typo, or an entity without that case), or the status differs from the
  `denied_status` the matrix declares for the cell's case (`permission_denied` is 403, `cross_org` is 404);
- the response status is not exactly `status`;
- a write is given no `persistence`, or the rows named by `persistence`, re-read from the database before and after the
  request, differ.

The manifest is written by `npm run generate-code`.

## Seeding actors

| Helper | Actor |
|--------|-------|
| `seedActorWithoutRole(entity)` | A user whose role has the entity's permission row with every flag false. |
| `seedActorFromOtherOrganization(entity, id)` | Moves row `id` into an organization the main test user does not belong to; returns that user as `actor` and the row's `targetId`. |

## Claiming the cell

A test that calls `expectDeniedFor` carries the `security-cell:` marker for the cell it claims, next to the call.
`npm run check:security-matrix` fails for a test file that calls `expectDeniedFor` without any marker. A hand-written
route claims the cell of the generated operation it is another write path to (a rename route claims `update`).

## Worked example

A hand-written route `PATCH /api/sx_account/{id}/rename_probe` (it authenticates, checks the permission, looks the row
up within the caller's organizations, then updates it), tested for an actor without the permission and for an actor of
another organization. The spec and route are the ones the `test:security-matrix-e2e-gate` runs
(`code_generator/tests/fixtures/security_matrix_e2e_gate/`).

```ts
import { expectDeniedFor, seedActorFromOtherOrganization, seedActorWithoutRole } from '../../support/security_helpers';

it('refuses an actor without the permission (403) and leaves the row unchanged', () => {
  // security-cell: entity=sx_account operation=update case=permission_denied
  cy.task<Account[]>('db:populateSxAccount', 1).then(([account]) => {
    seedActorWithoutRole('sx_account').then((actor) => {
      expectDeniedFor({
        cell: { entity: 'sx_account', operation: 'update', case: 'permission_denied' },
        status: 403,
        actor,
        request: { method: 'PATCH', url: `/api/sx_account/${account.id}/rename_probe`, body: { name: 'x' } },
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
        request: { method: 'PATCH', url: `/api/sx_account/${targetId}/rename_probe`, body: { name: 'x' } },
        persistence: { model: 'sx_account', where: { id: targetId } },
      });
    });
  });
});
```

In vitest the same call is `await expectDeniedFor({ ..., request: { url: `${BASE_URL}/api/...` } })` with the helpers
from `test/helpers/security.ts`, against a running app (see `test/flows/`).

## Changing what a denial returns

The expected status of a denial is data: edit `denied_status` under the case value in
`code_generator/security_matrix.yaml`. The helpers and the generated manifest follow.
