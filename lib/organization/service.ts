import prisma from '@/lib/prisma';
import { normalizeValue, normalizeChildRefs, assertNotStale, type NormalizedSnapshot } from '@/lib/normalize';
import { validateOnAdd, validateOnUpdate } from './service_validation';
import { afterCreate } from './service_after_create';

type TransactionClient = Pick<typeof prisma, 'organization'>;

function normalizeSnapshot(snapshot: Record<string, unknown> | null | undefined): NormalizedSnapshot {
  const safeSnapshot = (snapshot ?? {}) as Record<string, unknown>;
  return {
    id: String(safeSnapshot.id ?? ''),
    name: normalizeValue(safeSnapshot.name, 'string'),
    description: normalizeValue(safeSnapshot.description, 'string'),
    users: normalizeChildRefs(safeSnapshot.users),
  };
}

async function getCurrentSnapshot(tx: TransactionClient, id: string): Promise<NormalizedSnapshot | null> {
  const current = await tx.organization.findUnique({
    where: { id },
    include: {
      users: { select: { id: true } }
    }
  });

  if (!current) {
    return null;
  }

  return normalizeSnapshot(current as Record<string, unknown>);
}
export async function addOrganization(actorId: string, name: string, description: string | null, usersIds: string[]): Promise<{ id: string }> {
  const result = await prisma.$transaction(async (tx) => {
    await validateOnAdd(tx, {
      name: name,
      description: description,
    });
    const created = await tx.organization.create({
      data: {
        creator_id: actorId,
        updater_id: actorId,
        name: name,
        description: description,
      users: {
        connect: usersIds.map((id) => ({ id })),
      },
      },
    });
    await afterCreate(tx, created as Record<string, unknown>, {
      name: name,
      description: description,
    });
    return { id: created.id };
  });
  return result;
}
export async function updateOrganization(actorId: string, id: string, name: string, description: string | null, usersIds: string[], srcSnapshotRaw: string | null): Promise<void> {
  await prisma.$transaction(async (tx) => {
    if (srcSnapshotRaw) {
      await assertNotStale(srcSnapshotRaw, normalizeSnapshot, () => getCurrentSnapshot(tx, id));
    }
    await validateOnUpdate(tx, id, {
      name: name,
      description: description,
    });
    await tx.organization.update({
      where: { id },
      data: {
        updater_id: actorId,
        name: name,
        description: description,
      users: {
        set: usersIds.map((id) => ({ id })),
      },
      },
    });
  });
}
export async function deleteOrganization(ids: string[]): Promise<void> {
  await prisma.organization.deleteMany({ where: { id: { in: ids } } });
}
