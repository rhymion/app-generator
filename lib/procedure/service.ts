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

export async function addProcedure(creatorId: string, name: string, description: string | null, parentId: string | null, assigneeId: string | null, childrenIds: string[], precededByIds: string[], followedByIds: string[]) {
  const id = null;
  if (childrenIds.length > 0) {
    if (id && childrenIds.includes(id)) {
      throw new Error('Cannot set an item as its own child.');
    }
    const invalidChildren = await prisma.procedure.findMany({
      where: id
        ? {
            id: { in: childrenIds },
            AND: [
              { parent_id: { not: null } },
              { NOT: { parent_id: id } },
            ],
          }
        : {
            id: { in: childrenIds },
            parent_id: { not: null },
          },
      select: { id: true },
    });

    if (invalidChildren.length > 0) {
      throw new Error('One or more selected children already belong to another parent.');
    }
  }

  return await prisma.$transaction(async (tx) => {
    await validateOnAdd(tx, {
      name: name,
      description: description,
      parent_id: parentId,
      assignee_id: assigneeId,
    });
    return await tx.procedure.create({
      data: {
        name: name,
        description: description,
        parent_id: parentId,
        assignee_id: assigneeId,
        creator_id: creatorId,
        updater_id: creatorId,
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
  });
}

export async function updateProcedure(updaterId: string, id: string, name: string, description: string | null, parentId: string | null, assigneeId: string | null, childrenIds: string[], precededByIds: string[], followedByIds: string[], srcSnapshotRaw?: string | null) {
  if (childrenIds.length > 0) {
    if (id && childrenIds.includes(id)) {
      throw new Error('Cannot set an item as its own child.');
    }
    const invalidChildren = await prisma.procedure.findMany({
      where: id
        ? {
            id: { in: childrenIds },
            AND: [
              { parent_id: { not: null } },
              { NOT: { parent_id: id } },
            ],
          }
        : {
            id: { in: childrenIds },
            parent_id: { not: null },
          },
      select: { id: true },
    });

    if (invalidChildren.length > 0) {
      throw new Error('One or more selected children already belong to another parent.');
    }
  }

  return await prisma.$transaction(async (tx) => {
    if (srcSnapshotRaw) {
      await assertNotStale(srcSnapshotRaw, normalizeSnapshot, () => getCurrentSnapshot(tx, id));
    }
    await validateOnUpdate(tx, id, {
      name: name,
      description: description,
      parent_id: parentId,
      assignee_id: assigneeId,
    });
    return await tx.procedure.update({
      where: { id },
      data: {
        name: name,
        description: description,
        parent_id: parentId,
        assignee_id: assigneeId,
        updater_id: updaterId,
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

export async function deleteProcedure(ids: string[]) {
  if (ids.length === 1) {
    await prisma.procedure.delete({ where: { id: ids[0] } });
  } else {
    await prisma.procedure.deleteMany({ where: { id: { in: ids } } });
  }
}
