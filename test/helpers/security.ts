// vitest helpers for security tests of hand-written code (routes, Server Actions behind a route).
// The Cypress counterpart is cypress/support/security_helpers.ts. Worked example:
// docs/knowledge/security-test-helpers.md.
//
//   // security-cell: entity=sx_account operation=update case=permission_denied
//   await expectDeniedFor({
//     cell: { entity: 'sx_account', operation: 'update', case: 'permission_denied' },
//     status: 403,
//     actor: await seedActorWithoutRole('sx_account'),
//     request: { method: 'PATCH', url: `${BASE}/api/sx_account/${id}/rename`, body: { name: 'x' } },
//     persistence: { model: 'sx_account', where: { id } },
//   });
import {
  assertCellAndStatus,
  assertPersistenceDeclared,
  assertUnchanged,
  type PersistenceSpec,
  type SecurityCell,
  type SecurityManifest,
  type SnapshotReader,
} from './security_core';
import { loadManifest } from './security_manifest';

export type { SecurityCell, PersistenceSpec } from './security_core';

export type DeniedRequest = { method: string; url: string; body?: unknown };

export type ExpectDeniedForOptions = {
  cell: SecurityCell;
  /** Explicit status, 401/403/404: "any 4xx" is not accepted. */
  status: number;
  actor: { apiKey: string };
  request: DeniedRequest;
  /** Required for POST/PUT/PATCH/DELETE: the rows re-read from the database before and after. */
  persistence?: PersistenceSpec;
};

type Deps = {
  fetch: typeof fetch;
  readSnapshot: SnapshotReader;
  manifest: () => SecurityManifest;
};

/** Reads the rows of `spec` through Prisma, ordered by id, as plain JSON. */
async function readSnapshotFromDatabase(spec: PersistenceSpec): Promise<unknown> {
  const { default: db } = await import('@/lib/prisma');
  type Delegate = { findMany(args: { where: Record<string, unknown>; orderBy: { id: 'asc' } }): Promise<unknown[]> };
  const rows = await (db as unknown as Record<string, Delegate>)[spec.model].findMany({
    where: spec.where ?? {},
    orderBy: { id: 'asc' },
  });
  return JSON.parse(JSON.stringify(rows));
}

export function makeExpectDeniedFor(deps: Deps) {
  return async function expectDeniedFor(options: ExpectDeniedForOptions): Promise<void> {
    const { cell, status, actor, request, persistence } = options;
    assertCellAndStatus(cell, status, deps.manifest());
    assertPersistenceDeclared(request.method, persistence);
    const before = persistence ? await deps.readSnapshot(persistence) : undefined;
    const res = await deps.fetch(request.url, {
      method: request.method,
      headers: { 'X-API-Key': actor.apiKey, ...(request.body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: request.body !== undefined ? JSON.stringify(request.body) : undefined,
    });
    if (res.status !== status) {
      throw new Error(`expectDeniedFor: ${request.method} ${request.url} returned ${res.status}, expected ${status}.`);
    }
    if (persistence) assertUnchanged(before, await deps.readSnapshot(persistence), persistence);
  };
}

export const expectDeniedFor = makeExpectDeniedFor({
  fetch: (...args) => fetch(...args),
  readSnapshot: readSnapshotFromDatabase,
  manifest: () => loadManifest(),
});

/** An actor whose role has the entity's permission row with every flag false (the "no permission" actor). */
export async function seedActorWithoutRole(entity: string): Promise<{ apiKey: string }> {
  const { createLimitedApiUser } = await import('../../cypress/support/db-helpers');
  return { apiKey: await createLimitedApiUser(entity) };
}

/**
 * An actor with full permission on the entity who belongs to a different organization than `entityId`'s
 * row: the row is moved into a foreign organization the main test user is not a member of. Returns the
 * main test user's key as the actor and the id of the row now in the foreign organization.
 */
export async function seedActorFromOtherOrganization(
  entity: string,
  entityId: string,
): Promise<{ actor: { apiKey: string }; targetId: string; foreignOrganizationId: string }> {
  const { createCrossOrgScenario } = await import('../../cypress/support/db-helpers');
  const { TEST_API_KEY } = await import('../../cypress/support/test-credentials');
  const scenario = await createCrossOrgScenario(entity, entityId);
  return { actor: { apiKey: TEST_API_KEY }, targetId: scenario.entityInOrgB!.id, foreignOrganizationId: scenario.orgB.id };
}
