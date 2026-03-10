import prisma from '@/lib/prisma';
import { normalizeValue, normalizeChildRefs, assertNotStale, type NormalizedSnapshot } from '@/lib/normalize';
import { validateOnAdd, validateOnUpdate } from './service_validation';

type TransactionClient = Pick<typeof prisma, 'procedure'>;

function normalizeSnapshot(snapshot: Record<string, unknown> | null | undefined): NormalizedSnapshot {
  const safeSnapshot = (snapshot ?? {}) as Record<string, unknown>;
  return {
    id: String(safeSnapshot.id ?? ''),
    name: normalizeValue(safeSnapshot.name, 'string'),
    description: normalizeValue(safeSnapshot.description, 'string'),
    parent_id: normalizeValue(safeSnapshot.parent_id, 'string'),
    assignee_id: normalizeValue(safeSnapshot.assignee_id, 'string'),
    children: normalizeChildRefs(safeSnapshot.children),
    preceded_by: normalizeChildRefs(safeSnapshot.preceded_by),
    followed_by: normalizeChildRefs(safeSnapshot.followed_by),
  };
}

async function getCurrentSnapshot(tx: TransactionClient, id: string): Promise<NormalizedSnapshot | null> {
  const current = await tx.procedure.findUnique({
    where: { id },
    include: {
      children: { select: { id: true } },
      preceded_by: { select: { id: true } },
      followed_by: { select: { id: true } }
    }
  });

  if (!current) {
    return null;
  }

  return normalizeSnapshot(current as Record<string, unknown>);
}
export async function addProcedure(userId: string, name: string, description: string | null, parentId: string | null, assigneeId: string | null, childrenIds: string[], precededByIds: string[], followedByIds: string[]): Promise<{ id: string }> {
  return await prisma.$transaction(async (tx) => {
    await validateOnAdd(tx, {
      name: name,
      description: description,
      parent_id: parentId,
      assignee_id: assigneeId,
    });
    const created = await tx.procedure.create({
      data: {
        creator_id: userId,
        updater_id: userId,
        name: name,
        description: description,
        parent_id: parentId,
        assignee_id: assigneeId,
      children: {
        connect: childrenIds.map((id) => ({ id })),
      },
      preceded_by: {
        connect: precededByIds.map((id) => ({ id })),
      },
      followed_by: {
        connect: followedByIds.map((id) => ({ id })),
      },
      },
    });
    return { id: created.id };
  });
}
export async function updateProcedure(userId: string, id: string, name: string, description: string | null, parentId: string | null, assigneeId: string | null, childrenIds: string[], precededByIds: string[], followedByIds: string[], srcSnapshotRaw: string | null): Promise<void> {
  await prisma.$transaction(async (tx) => {
    if (srcSnapshotRaw) {
      await assertNotStale(srcSnapshotRaw, normalizeSnapshot, () => getCurrentSnapshot(tx, id));
    }
    await validateOnUpdate(tx, id, {
      name: name,
      description: description,
      parent_id: parentId,
      assignee_id: assigneeId,
    });
    await tx.procedure.update({
      where: { id },
      data: {
        updater_id: userId,
        name: name,
        description: description,
        parent_id: parentId,
        assignee_id: assigneeId,
      children: {
        set: childrenIds.map((id) => ({ id })),
      },
      preceded_by: {
        set: precededByIds.map((id) => ({ id })),
      },
      followed_by: {
        set: followedByIds.map((id) => ({ id })),
      },
      },
    });
  });
}
export async function deleteProcedure(ids: string[]): Promise<void> {
  await prisma.procedure.deleteMany({ where: { id: { in: ids } } });
}
