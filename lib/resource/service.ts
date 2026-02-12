import prisma from '@/lib/prisma';
import { normalizeValue, normalizeChildRefs, assertNotStale, type NormalizedSnapshot } from '@/lib/normalize';

type TransactionClient = Pick<typeof prisma, 'resource'>;

function normalizeSnapshot(snapshot: Record<string, unknown> | null | undefined): NormalizedSnapshot {
  const safeSnapshot = (snapshot ?? {}) as Record<string, unknown>;
  return {
    id: String(safeSnapshot.id ?? ''),
    name: normalizeValue(safeSnapshot.name, 'string'),
    description: normalizeValue(safeSnapshot.description, 'string'),
    organization_id: normalizeValue(safeSnapshot.organization_id, 'string'),
    resource_attachments: normalizeChildRefs(safeSnapshot.resource_attachments),
    resource_images: normalizeChildRefs(safeSnapshot.resource_images),
  };
}

async function getCurrentSnapshot(tx: TransactionClient, id: string): Promise<NormalizedSnapshot | null> {
  const current = await tx.resource.findUnique({
    where: { id },
    include: {
      resource_attachments: { select: { id: true } },
      resource_images: { select: { id: true } }
    }
  });

  if (!current) {
    return null;
  }

  return normalizeSnapshot(current as Record<string, unknown>);
}

export async function addResource(creatorId: string, name: string, description: string | null, organizationId: string, resourceAttachmentsItems: { order: number; name: string; path: string }[], resourceImagesItems: { name: string; path: string }[]) {
  return await prisma.resource.create({
    data: {
      name: name,
      description: description,
      organization_id: organizationId,
      creator_id: creatorId,
      resource_attachments: {
        create: resourceAttachmentsItems.map(f => ({
          order: f.order,
          name: f.name,
          path: f.path,
        })),
      },
      resource_images: {
        create: resourceImagesItems.map(f => ({
          name: f.name,
          path: f.path,
        })),
      },
    },
  });
}

export async function updateResource(id: string, name: string, description: string | null, organizationId: string, resourceAttachmentsItems: { id?: string; order: number; name: string; path: string }[], resourceImagesItems: { id?: string; name: string; path: string }[], srcSnapshotRaw?: string | null) {
  return await prisma.$transaction(async (tx) => {
    if (srcSnapshotRaw) {
      await assertNotStale(srcSnapshotRaw, normalizeSnapshot, () => getCurrentSnapshot(tx, id));
    }
    return await tx.resource.update({
      where: { id },
      data: {
      name: name,
      description: description,
      organization_id: organizationId,
      resource_attachments: {
        deleteMany: {},
        create: resourceAttachmentsItems.map(f => ({
          order: f.order,
          name: f.name,
          path: f.path,
        })),
      },
      resource_images: {
        deleteMany: {},
        create: resourceImagesItems.map(f => ({
          name: f.name,
          path: f.path,
        })),
      },
      },
    });
  });
}

export async function deleteResource(ids: string[]) {
  if (ids.length === 1) {
    await prisma.resource.delete({ where: { id: ids[0] } });
  } else {
    await prisma.resource.deleteMany({ where: { id: { in: ids } } });
  }
}
