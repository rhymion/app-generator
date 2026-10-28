// Removing the attachments of a deleted owner record.
//
// An owner record reaches its files through the `attachable` bridge row it creates. Deleting the owner
// deletes that bridge row, and the database then only unlinks the attachments (onDelete: SetNull), which
// would leave rows and stored files that the uploader can still read. The generated delete service calls
// deleteBridgeAttachments() inside its transaction, before the bridge rows are deleted, and
// removeStoredObjects() once the transaction has committed (the same split setAttachmentsForBridge uses
// when a file is detached): a rolled-back delete keeps both the rows and the files, and a failure to
// remove a file leaves at most an unreachable object, never a row that points at nothing.

import { deleteStoredObject, isStorageKey } from '@/lib/attachment/storage';

type BridgeAttachmentClient = {
  attachment: {
    findMany(args: { where: { attachable_id: { in: string[] } }; select: { id: true; path: true } }): Promise<
      Array<{ id: string; path: string }>
    >;
    deleteMany(args: { where: { id: { in: string[] } } }): Promise<{ count: number }>;
  };
};

/**
 * Deletes every attachment row linked to the given bridge rows and returns their storage keys.
 * Null and empty ids are ignored.
 */
export async function deleteBridgeAttachments(
  tx: BridgeAttachmentClient,
  bridgeIds: Array<string | null | undefined>,
): Promise<string[]> {
  const ids = bridgeIds.filter((id): id is string => typeof id === 'string' && id.length > 0);
  if (ids.length === 0) return [];
  const rows = await tx.attachment.findMany({ where: { attachable_id: { in: ids } }, select: { id: true, path: true } });
  if (rows.length === 0) return [];
  await tx.attachment.deleteMany({ where: { id: { in: rows.map((r) => r.id) } } });
  return rows.map((r) => r.path);
}

/** Removes stored objects after the transaction that deleted their rows has committed. Never throws. */
export async function removeStoredObjects(keys: string[]): Promise<void> {
  await Promise.all(keys.filter(isStorageKey).map((key) => deleteStoredObject(key).catch(() => undefined)));
}
