// Permission checks for the checked write entry points (Issue #1257).
//
// The generated service layer (`lib/<entity>/service.ts`) does not check permissions: the generated Server
// Actions and REST routes do that before they call it. Hand-written code writes through
// `lib/<entity>/checked.ts` instead (`checkedAdd<Entity>`, `checkedUpdate<Entity>`, `checkedDelete<Entity>`),
// which runs the checks below first. They follow the order of the generated REST routes:
//
//   1. entity-only permission for the operation (403), before the record is read, so a caller with no access
//      path at all never learns whether the record exists;
//   2. the record is read within the actor's organizations (404 when it is absent or in another organization);
//   3. an `x-filter-values` entity: a record outside the filtered view is absent (404);
//   4. record-scoped permission, so Creator/Assignee grants count only on their own records (403); for an
//      `x-self-only` entity, ownership is the only gate and a record of another user is absent (404).
//
// A client-supplied organization_id and foreign keys are checked by the service itself (add/update), and the
// references held by a deleted record by `assertDeleteReferencesReachable<Entity>`, which the generated
// `checkedDelete<Entity>` calls.
//
// Plain module (no 'use server'): exported functions take the actor id as a parameter and must never become
// client-callable Server Actions.
import { AppError } from '@/lib/_errors';
import { requireEntityPermission, requireRecordPermission, type RecordContext } from '@/lib/authz';
import { getAssociatedOrganizations } from '@/lib/organization/associated_internal';

export type WriteOperation = 'update' | 'delete';

export type CheckedRecordSpec<Row extends RecordContext> = {
  entity: string;
  /** `required`: the record must belong to one of the actor's organizations; `optional`: or to none; `none`: not organization-scoped. */
  orgScope: 'required' | 'optional' | 'none';
  /** `x-self-only`: only the creator may write the record. */
  selfOnly: boolean;
  /** `x-filter-values`: a record whose field is outside these values is outside the entity's view. */
  filterValues?: Readonly<Record<string, readonly unknown[]>>;
  /** Reads the record; `orgIds` is null when the entity is not organization-scoped. */
  load: (id: string, orgIds: string[] | null) => Promise<Row | null>;
};

function notFound(): AppError {
  return new AppError('NOT_FOUND', 'Not found');
}

/** Create: the actor needs the entity's create permission. */
export async function assertCanCreate(entity: string, actorId: string): Promise<void> {
  if (!actorId) throw new AppError('PERMISSION_DENIED', `Access denied: ${entity}.create`);
  await requireEntityPermission(entity, 'create', actorId);
}

/** Update or delete of one record: returns the record when every check passes, throws AppError otherwise. */
export async function assertCanWriteRecord<Row extends RecordContext>(
  spec: CheckedRecordSpec<Row>,
  operation: WriteOperation,
  actorId: string,
  id: string,
): Promise<Row> {
  if (!actorId) throw new AppError('PERMISSION_DENIED', `Access denied: ${spec.entity}.${operation}`);
  if (!spec.selfOnly) await requireEntityPermission(spec.entity, operation, actorId);
  const orgIds = spec.orgScope === 'none' ? null : (await getAssociatedOrganizations(actorId)).map((o) => o.id);
  const row = await spec.load(id, orgIds);
  if (!row) throw notFound();
  for (const [field, values] of Object.entries(spec.filterValues ?? {})) {
    if (!values.includes(row[field])) throw notFound();
  }
  if (spec.selfOnly) {
    if (row.creator_id !== actorId) throw notFound();
  } else {
    await requireRecordPermission(spec.entity, operation, row, actorId);
  }
  return row;
}

/**
 * Delete of several records: every one must pass `assertCanWriteRecord`, otherwise nothing is deleted
 * (unlike the list screen's bulk delete, which skips the rows the actor may not delete). Duplicate ids are
 * checked once.
 */
export async function assertCanDeleteRecords<Row extends RecordContext>(
  spec: CheckedRecordSpec<Row>,
  actorId: string,
  ids: readonly string[],
): Promise<string[]> {
  const unique = [...new Set(ids)];
  for (const id of unique) await assertCanWriteRecord(spec, 'delete', actorId, id);
  return unique;
}
