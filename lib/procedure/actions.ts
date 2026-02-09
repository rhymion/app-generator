'use server';

import { redirect } from 'next/navigation';
import prisma from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { requirePermission } from '@/lib/authz';

type NormalizedSnapshot = Record<string, unknown>;
type TransactionClient = Pick<typeof prisma, 'procedure'>;

function normalizeValue(value: unknown, kind: 'date' | 'number' | 'boolean' | 'string' | 'other') {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  if (kind === 'date') {
    const date = value instanceof Date ? value : new Date(value as string);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }

  if (kind === 'number') {
    const numberValue = Number(value);
    return Number.isNaN(numberValue) ? null : numberValue;
  }

  if (kind === 'boolean') {
    if (typeof value === 'string') {
      if (value.toLowerCase() === 'true') return true;
      if (value.toLowerCase() === 'false') return false;
    }
    return Boolean(value);
  }

  if (kind === 'string') {
    return String(value);
  }

  return value;
}

function normalizeChildRefs(items: unknown): string[] {
  if (!Array.isArray(items)) return [];
  return items
    .map((item) => (item && typeof item === 'object' ? (item as { id?: string }).id : undefined))
    .filter((id): id is string => Boolean(id))
    .sort();
}

function normalizeSnapshot(snapshot: Record<string, unknown> | null | undefined): NormalizedSnapshot {
  const safeSnapshot = (snapshot ?? {}) as Record<string, unknown>;
  return {
    id: String(safeSnapshot.id ?? ''),
    name: normalizeValue(safeSnapshot.name, 'string'),
    description: normalizeValue(safeSnapshot.description, 'string'),
    parent_id: normalizeValue(safeSnapshot.parent_id, 'string'),
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

async function assertNotStale(tx: TransactionClient, id: string, srcSnapshotRaw: string) {
  let expectedSnapshot: NormalizedSnapshot;
  try {
    expectedSnapshot = normalizeSnapshot(JSON.parse(srcSnapshotRaw) as Record<string, unknown>);
  } catch {
    throw new Error('Invalid snapshot data. Please reload and try again.');
  }

  const currentSnapshot = await getCurrentSnapshot(tx, id);
  if (!currentSnapshot) {
    throw new Error('This record no longer exists.');
  }

  if (JSON.stringify(currentSnapshot) !== JSON.stringify(expectedSnapshot)) {
    throw new Error('This record has been updated since you opened it. Please reload to compare with the latest changes.');
  }
}

export async function upsertProcedure(data: FormData) {
  const id = data.get('id') as string | null;
  const srcSnapshotRaw = data.get('__src_snapshot') as string | null;
  if (id) {
    await requirePermission('procedure', 'update');
  } else {
    await requirePermission('procedure', 'create');
  }
  const name = data.get('name') as string;
  const description = data.get('description') as string | null;
  const parentId = (data.get('parent_id') as string | null) || null;
  const childrenRaw = data.getAll('children[]') as string[];
  const childrenItems = childrenRaw.map(f => JSON.parse(f) as { id?: string; name?: string });
  const childrenIds = childrenItems
    .map((children) => children.id)
    .filter((childrenId): childrenId is string => Boolean(childrenId));
  const precededByRaw = data.getAll('preceded_by[]') as string[];
  const precededByItems = precededByRaw.map(f => JSON.parse(f) as { id?: string; name?: string });
  const precededByIds = precededByItems
    .map((precededBy) => precededBy.id)
    .filter((precededById): precededById is string => Boolean(precededById));
  const followedByRaw = data.getAll('followed_by[]') as string[];
  const followedByItems = followedByRaw.map(f => JSON.parse(f) as { id?: string; name?: string });
  const followedByIds = followedByItems
    .map((followedBy) => followedBy.id)
    .filter((followedById): followedById is string => Boolean(followedById));

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


  if (id) {
    await prisma.$transaction(async (tx) => {
      if (srcSnapshotRaw) {
        await assertNotStale(tx, id, srcSnapshotRaw);
      }
      await updateProcedure(tx, id, name, description, parentId, childrenIds, precededByIds, followedByIds);
    });
  } else {
    await addProcedure(name, description, parentId, childrenIds, precededByIds, followedByIds);
  }

  revalidatePath('/');
  redirect('/procedure');
}

async function addProcedure(name: string, description: string | null, parentId: string | null, childrenIds: string[], precededByIds: string[], followedByIds: string[]) {
  await prisma.procedure.create({
    data: {
      name: name,
      description: description,
      parent_id: parentId,
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
}

async function updateProcedure(tx: TransactionClient, id: string, name: string, description: string | null, parentId: string | null, childrenIds: string[], precededByIds: string[], followedByIds: string[]) {
  await tx.procedure.update({
    where: { id },
    data: {
      name: name,
      description: description,
      parent_id: parentId,
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
}

export async function removeProcedure(data: FormData | string[]) {
  await requirePermission('procedure', 'delete');

  if (Array.isArray(data)) {
    await prisma.procedure.deleteMany({
      where: { id: { in: data } },
    });
  } else {
    const id = data.get('id') as string;
    await prisma.procedure.delete({
      where: { id },
    });
  }

  revalidatePath('/');
  redirect('/procedure');
}
