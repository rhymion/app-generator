// Write-once (not regenerated). Shared by every generated service.ts
// add/update function: before a foreign key is written, the referenced row must
// be reachable by the actor -- the same conditions the referenced entity's own
// list and detail reads apply (see _reachability.ts). A row the actor cannot
// reach is reported exactly like a row that does not exist (NOT_FOUND), so a
// write cannot be used to probe which ids exist elsewhere.
//
// The same reachability decides the other direction too: a record whose stored
// reference points at a row the actor cannot reach cannot have that reference
// moved or cleared, and cannot be deleted, by that actor (PERMISSION_DENIED --
// the record itself is visible to them, so nothing is masked).
//
// Which foreign keys are listed is decided at generation time: the
// organization column, foreign keys to user (creator, assignee) and columns the
// server sets are not references the client chooses, and are never passed here.
import { AppError } from '@/lib/_errors';
import { isRowReachable } from '@/lib/_reachability';
import { getAssociatedOrganizations } from '@/lib/organization/getters_associated';

export type FkReference = {
  /** Prisma model name of the referenced entity. */
  model: string;
  /** True when the referenced entity is x-self-only. */
  selfOnly?: boolean;
  /** The value being written; empty values are not references. */
  id: string | null | undefined;
  /** The value currently stored (update only); an unchanged reference is not re-checked. */
  previousId?: string | null;
  /**
   * True for a required column. An empty value on update means "keep the stored
   * value" there (the service restores it), so it is not a clearing.
   */
  required?: boolean;
  /** Loads the referenced row (whole row, so creator_id / assignee_id are available). */
  load: (id: string) => Promise<Record<string, unknown> | null>;
};

export async function assertFkReferencesUsable(actorId: string, refs: FkReference[]): Promise<void> {
  // A reference the actor cannot reach cannot be moved away from or cleared
  // either (an update of the column is refused, and so is a delete -- see
  // assertStoredFkReferencesReachable). Judged on the stored value, so a column
  // that is sent back unchanged is not affected.
  const leaving = refs.filter(
    (r) => r.previousId && r.id !== r.previousId && !(r.required && !r.id),
  );
  const changed = refs.filter((r) => r.id && r.id !== r.previousId);
  if (changed.length === 0 && leaving.length === 0) return;
  const orgIds = new Set((await getAssociatedOrganizations(actorId)).map((o) => o.id));
  for (const ref of leaving) {
    await assertStoredReferenceReachable(actorId, orgIds, ref, ref.previousId as string);
  }
  for (const ref of changed) {
    const row = await ref.load(ref.id as string);
    if (!row || !(await isRowReachable(actorId, orgIds, { model: ref.model, selfOnly: ref.selfOnly }, row))) {
      throw new AppError('NOT_FOUND', 'Not found');
    }
  }
}

/**
 * Delete side of the same rule: a record whose stored foreign key points at a
 * row the actor cannot reach cannot be deleted by that actor (a record they
 * could not re-point or clear is not theirs to remove either).
 */
export async function assertStoredFkReferencesReachable(
  actorId: string,
  refs: Pick<FkReference, 'model' | 'selfOnly' | 'id' | 'load'>[],
): Promise<void> {
  const stored = refs.filter((r) => r.id);
  if (stored.length === 0) return;
  const orgIds = new Set((await getAssociatedOrganizations(actorId)).map((o) => o.id));
  for (const ref of stored) {
    await assertStoredReferenceReachable(actorId, orgIds, ref, ref.id as string);
  }
}

async function assertStoredReferenceReachable(
  actorId: string,
  orgIds: ReadonlySet<string>,
  ref: Pick<FkReference, 'model' | 'selfOnly' | 'load'>,
  storedId: string,
): Promise<void> {
  const row = await ref.load(storedId);
  // A stored id with no row behind it protects nothing.
  if (!row) return;
  if (!(await isRowReachable(actorId, orgIds, { model: ref.model, selfOnly: ref.selfOnly }, row))) {
    throw new AppError('PERMISSION_DENIED', 'References a record that is not accessible');
  }
}
