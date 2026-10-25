// Stores one uploaded file and records who uploaded it.
//
// The object goes under an opaque random key (see lib/attachment/storage.ts)
// and an `attachment` row is created immediately, not yet linked to any owner
// record. The caller receives the row's id, never a path or URL: the id is what
// the attach actions take, and only the uploader may link it (see
// lib/attachment/link.ts).

import prisma from '@/lib/prisma';
import { encryptFileName } from '@/lib/compliance/attachment_name_crypto';
import { deleteStoredObject, newStorageKey, putStoredObject } from '@/lib/attachment/storage';

// The multipart file name is client-controlled: keep only its last path
// segment (either separator style) and drop control characters. It is only
// ever displayed (as the decrypted original name), never used as a path.
export function toDisplayFilename(raw: string): string {
  const base = (raw.split(/[\\/]/).pop() ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return base === '' || base === '.' || base === '..' ? 'file' : base.slice(0, 255);
}

export type StoredUpload = { id: string; name: string };

export async function storeUploadedFile(
  file: { name: string; arrayBuffer(): Promise<ArrayBuffer> },
  contentType: string,
  uploaderId: string,
): Promise<StoredUpload> {
  const name = toDisplayFilename(file.name);
  const key = newStorageKey();
  const body = Buffer.from(await file.arrayBuffer());
  const organization = await prisma.organization.findFirst({
    where: { users: { some: { id: uploaderId } } },
    orderBy: { id: 'asc' },
    select: { id: true },
  });

  await putStoredObject(key, body, contentType);
  const encrypted = encryptFileName(name);
  try {
    const row = await prisma.attachment.create({
      data: {
        attachable_id: null,
        name: encrypted.uuid,
        encrypted_original_name: encrypted.encryptedName,
        name_iv: encrypted.iv,
        path: key,
        uploader_id: uploaderId,
        uploader_organization_id: organization?.id ?? null,
      },
      select: { id: true },
    });
    return { id: row.id, name };
  } catch (error) {
    // Do not leave an object behind that no row points to.
    await deleteStoredObject(key).catch(() => undefined);
    throw error;
  }
}
