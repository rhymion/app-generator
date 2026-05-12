'use server';

import { revalidatePath } from 'next/cache';
import prisma from '@/lib/prisma';
import { getSessionUserIdOrThrow } from '@/lib/authz';

export type AttachmentItemInput = {
  id?: string | null;
  order?: number;
  name: string;
  path: string;
};

async function assertCanEditBridge(attachable_id: string): Promise<void> {
  const userId = await getSessionUserIdOrThrow();
  const owner = await prisma.attachable.findUnique({
    where: { id: attachable_id },
    select: {
      resource: { select: { creator_id: true } },
      product: { select: { creator_id: true } },
    },
  });
  if (!owner) throw new Error('Attachable not found');
  const creatorId = owner.resource?.creator_id ?? owner.product?.creator_id ?? null;
  if (creatorId && creatorId !== userId) {
    throw new Error('No permission to edit attachments');
  }
}

function revalidateForBridge(attachable_id: string): Promise<void> {
  return prisma.attachable
    .findUnique({
      where: { id: attachable_id },
      select: { resource: { select: { id: true } }, product: { select: { id: true } } },
    })
    .then((row) => {
      if (row?.resource) {
        revalidatePath(`/[locale]/resource/view/${row.resource.id}`, 'page');
        revalidatePath(`/[locale]/resource/edit/${row.resource.id}`, 'page');
      }
      if (row?.product) {
        revalidatePath(`/[locale]/product/view/${row.product.id}`, 'page');
        revalidatePath(`/[locale]/product/edit/${row.product.id}`, 'page');
      }
    });
}

export async function setAttachmentsForBridge(
  attachable_id: string,
  type: number,
  items: AttachmentItemInput[],
): Promise<void> {
  await assertCanEditBridge(attachable_id);
  await prisma.$transaction(async (tx) => {
    const existing = await tx.attachment.findMany({
      where: { attachable_id, type },
      select: { id: true },
    });
    const keepIds = new Set(items.map((i) => i.id).filter((x): x is string => !!x));
    const toDelete = existing.filter((e) => !keepIds.has(e.id)).map((e) => e.id);
    if (toDelete.length > 0) {
      await tx.attachment.deleteMany({ where: { id: { in: toDelete } } });
    }
    for (const [idx, item] of items.entries()) {
      const order = item.order ?? idx;
      if (item.id && keepIds.has(item.id)) {
        await tx.attachment.update({
          where: { id: item.id },
          data: { name: item.name, path: item.path, order },
        });
      } else {
        await tx.attachment.create({
          data: { attachable_id, type, name: item.name, path: item.path, order },
        });
      }
    }
  });
  await revalidateForBridge(attachable_id);
}
