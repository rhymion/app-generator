// Framework-free core (no Node modules: the Cypress spec bundle imports it; the manifest is read by
// security_manifest.ts, which only runs in Node) of the security test helpers (`expectDeniedFor`). The Cypress helpers
// (cypress/support/security_helpers.ts) and the vitest helpers (test/helpers/security.ts) both
// build on it, so the two cannot disagree about what "denied" means.
//
// It cooperates with the security test matrix (code_generator/security_matrix.yaml) instead of
// adding a mechanism of its own:
//   * the cell a test claims (`security-cell:` marker) is passed in as `cell` and must exist in
//     `.security-manifest.json`;
//   * the status a denial must return is declared in the matrix (`denied_status` of a case value)
//     and the explicit status the test passes must equal it.

export type SecurityCell = { entity: string; operation: string; case: string; [axis: string]: string };

export type SecurityManifest = {
  axes: string[];
  denied_status?: Record<string, Record<string, number>>;
  entities: Record<string, { cells: Array<Record<string, string>> }>;
};

/** Statuses a denial may be asserted with. A range such as "any 4xx" is deliberately not accepted. */
export const DENIAL_STATUSES = [401, 403, 404] as const;

export const WRITE_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE'] as const;

/** Throws unless `cell` is a cell of the manifest and `status` is the status the matrix declares for it. */
export function assertCellAndStatus(cell: SecurityCell, status: number, manifest: SecurityManifest): void {
  if (!(DENIAL_STATUSES as readonly number[]).includes(status)) {
    throw new Error(`expectDeniedFor: status must be one of ${DENIAL_STATUSES.join('/')}, got ${status} (a range such as "any 4xx" is not a check).`);
  }
  const entity = manifest.entities[cell.entity];
  if (!entity) throw new Error(`expectDeniedFor: entity "${cell.entity}" is not in the security manifest.`);
  const match = entity.cells.some((c) => manifest.axes.every((axis) => c[axis] === cell[axis]));
  if (!match) {
    throw new Error(
      `expectDeniedFor: the manifest has no cell ${JSON.stringify(cell)}; fix the cell or the security-cell marker.`,
    );
  }
  for (const [axis, values] of Object.entries(manifest.denied_status ?? {})) {
    const declared = values[cell[axis]];
    if (declared !== undefined && declared !== status) {
      throw new Error(
        `expectDeniedFor: the matrix declares status ${declared} for ${axis}=${cell[axis]}, the test expects ${status}.`,
      );
    }
  }
}

/** Throws when a denied write is not a write, or a write names no row set to re-read. */
export function assertPersistenceDeclared(method: string, persistence: unknown): void {
  const isWrite = (WRITE_METHODS as readonly string[]).includes(method.toUpperCase());
  if (isWrite && !persistence) {
    throw new Error(
      `expectDeniedFor: ${method} writes; pass persistence: { model, where } so the helper can re-read the database and prove the denied write did not persist.`,
    );
  }
}

export type PersistenceSpec = { model: string; where?: Record<string, unknown> };

/** Rows of `persistence`, read straight from the database and normalised for a deep comparison. */
export type SnapshotReader = (spec: PersistenceSpec) => Promise<unknown>;

export function assertUnchanged(before: unknown, after: unknown, spec: PersistenceSpec): void {
  if (JSON.stringify(before) !== JSON.stringify(after)) {
    throw new Error(
      `expectDeniedFor: the denied write persisted: ${spec.model} ${JSON.stringify(spec.where ?? {})} differs after the request.\nbefore: ${JSON.stringify(before)}\nafter:  ${JSON.stringify(after)}`,
    );
  }
}
