// Write-once (not regenerated). Shared by every generated service.ts
// add/update function: before a foreign key is written, the referenced row must
// be reachable by the actor -- the same conditions the referenced entity's own
// list and detail reads apply (see _reachability.ts). A row the actor cannot
// reach is reported exactly like a row that does not exist (NOT_FOUND), so a
// write cannot be used to probe which ids exist elsewhere.
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
  /** Loads the referenced row (whole row, so creator_id / assignee_id are available). */
  load: (id: string) => Promise<Record<string, unknown> | null>;
};

export async function assertFkReferencesUsable(actorId: string, refs: FkReference[]): Promise<void> {
  const changed = refs.filter((r) => r.id && r.id !== r.previousId);
  if (changed.length === 0) return;
  const orgIds = new Set((await getAssociatedOrganizations(actorId)).map((o) => o.id));
  for (const ref of changed) {
    const row = await ref.load(ref.id as string);
    if (!row || !(await isRowReachable(actorId, orgIds, { model: ref.model, selfOnly: ref.selfOnly }, row))) {
      throw new AppError('NOT_FOUND', 'Not found');
    }
  }
}
