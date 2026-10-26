// Linking an uploaded file to an owner record.
//
// An upload (lib/attachment/upload_core.ts) creates an `attachment` row that no
// owner references yet. Attach actions take that row's id, never a path, and
// may only link a row that is (a) still unlinked and (b) uploaded by the caller.
// A row that does not meet both conditions is reported as "not found", the same
// answer as for an id that does not exist.

import type prisma from '@/lib/prisma';
import { AppError } from '@/lib/_errors';

type AttachmentClient = Pick<typeof prisma, 'attachment'>;

/**
 * The Prisma filter for "no owner references this attachment" (UNLINKED_ATTACHMENT_WHERE in the
 * generated lib/attachment/access.ts, which knows every owner of the schema).
 */
export type UnlinkedWhere = Record<string, null>;

/** Throws NOT_FOUND unless `id` is an unlinked attachment uploaded by `actorId`. */
export async function assertLinkableUpload(
  tx: AttachmentClient,
  id: string,
  actorId: string,
  unlinkedWhere: UnlinkedWhere,
): Promise<void> {
  const row = await tx.attachment.findFirst({
    where: { id, uploader_id: actorId, ...unlinkedWhere },
    select: { id: true },
  });
  if (!row) throw new AppError('NOT_FOUND', 'Attachment not found');
}

/**
 * Write-time check for a direct-attachment foreign key (a column on the owner entity that
 * references `attachment`). An unchanged value or an empty one needs no check; a new value must
 * be an unlinked attachment uploaded by the caller.
 */
export async function assertDirectAttachmentValue(
  tx: AttachmentClient,
  next: unknown,
  previous: unknown,
  actorId: string,
  field: string,
  unlinkedWhere: UnlinkedWhere,
): Promise<void> {
  if (next === null || next === undefined || next === '' || next === previous) return;
  if (typeof next !== 'string') throw new AppError('VALIDATION', 'Attachment id must be a string', field, 'invalid');
  try {
    await assertLinkableUpload(tx, next, actorId, unlinkedWhere);
  } catch (error) {
    if (error instanceof AppError && error.code === 'NOT_FOUND') {
      throw new AppError('VALIDATION', 'Attachment not found', field, 'invalid');
    }
    throw error;
  }
}
