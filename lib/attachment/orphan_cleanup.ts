// Removes uploads that were never attached to anything.
//
// POST /api/upload creates the attachment record immediately, so a form that is abandoned after the
// upload leaves a record and a stored object no owner references. This deletes those once they are
// older than `maxAgeHours` (default 24 hours, long enough to finish a form). It is run by the
// scheduled task `attachment_orphan_cleanup` (see docs/knowledge/attachment-storage.md).

import prisma from '@/lib/prisma';
import { deleteStoredObject, isStorageKey } from '@/lib/attachment/storage';
import type { UnlinkedWhere } from '@/lib/attachment/link';

export const ORPHAN_MAX_AGE_HOURS = 24;
const BATCH_SIZE = 200;

export type OrphanCleanupResult = { deleted: number; objectsNotRemoved: string[] };

/**
 * @param unlinkedWhere UNLINKED_ATTACHMENT_WHERE from the generated lib/attachment/access.ts:
 *   not on the bridge and not the target of any direct-attachment foreign key.
 */
export async function deleteOrphanAttachments(
  unlinkedWhere: UnlinkedWhere,
  options: { maxAgeHours?: number; now?: Date } = {},
): Promise<OrphanCleanupResult> {
  const maxAgeHours = options.maxAgeHours ?? ORPHAN_MAX_AGE_HOURS;
  const cutoff = new Date((options.now ?? new Date()).getTime() - maxAgeHours * 60 * 60 * 1000);
  const result: OrphanCleanupResult = { deleted: 0, objectsNotRemoved: [] };

  for (;;) {
    const batch = await prisma.attachment.findMany({
      where: { ...unlinkedWhere, created_at: { lt: cutoff } },
      select: { id: true, path: true },
      orderBy: { created_at: 'asc' },
      take: BATCH_SIZE,
    });
    if (batch.length === 0) break;

    let deletedInBatch = 0;
    for (const row of batch) {
      // The row goes first, and only while it is still unlinked: an upload attached in the meantime
      // is left alone, and a failure to remove the object never leaves a record pointing at nothing.
      const removed = await prisma.attachment.deleteMany({ where: { id: row.id, ...unlinkedWhere } });
      if (removed.count !== 1) continue;
      deletedInBatch += 1;
      result.deleted += 1;
      if (!isStorageKey(row.path)) continue;
      try {
        await deleteStoredObject(row.path);
      } catch {
        result.objectsNotRemoved.push(row.path);
      }
    }
    // A full pass that deleted nothing means the remaining rows were all attached meanwhile.
    if (deletedInBatch === 0 || batch.length < BATCH_SIZE) break;
  }
  return result;
}
