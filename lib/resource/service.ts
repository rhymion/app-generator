import prisma from '@/lib/prisma';
import { normalizeValue, normalizeChildRefs, assertNotStale, type NormalizedSnapshot } from '@/lib/normalize';
import { validateOnAdd, validateOnUpdate } from './service_validation';

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
export async function addResource(userId: string, name: string, description: string | null, organizationId: string, resourceAttachmentsItems: { order: number; name: string; path: string }[], resourceImagesItems: { name: string; path: string }[]): Promise<{ id: string }> {
  return await prisma.$transaction(async (tx) => {
    await validateOnAdd(tx, {
      name: name,
      description: description,
      organization_id: organizationId,
    });
    const created = await tx.resource.create({
      data: {
        creator_id: userId,
        updater_id: userId,
        name: name,
        description: description,
        organization_id: organizationId,
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
    return { id: created.id };
  });
}
export async function updateResource(userId: string, id: string, name: string, description: string | null, organizationId: string, resourceAttachmentsItems: { order: number; name: string; path: string }[], resourceImagesItems: { name: string; path: string }[], srcSnapshotRaw: string | null): Promise<void> {
  await prisma.$transaction(async (tx) => {
    if (srcSnapshotRaw) {
      await assertNotStale(srcSnapshotRaw, normalizeSnapshot, () => getCurrentSnapshot(tx, id));
    }
    await validateOnUpdate(tx, id, {
      name: name,
      description: description,
      organization_id: organizationId,
    });
    await tx.resource.update({
      where: { id },
      data: {
        updater_id: userId,
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
export async function deleteResource(ids: string[]): Promise<void> {
  await prisma.resource.deleteMany({ where: { id: { in: ids } } });
}
