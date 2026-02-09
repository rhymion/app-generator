'use server';

import { redirect } from 'next/navigation';
import prisma from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { requirePermission } from '@/lib/authz';

type NormalizedSnapshot = Record<string, unknown>;
type TransactionClient = Pick<typeof prisma, 'permission'>;

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
    create: normalizeValue(safeSnapshot.create, 'boolean'),
    read: normalizeValue(safeSnapshot.read, 'boolean'),
    update: normalizeValue(safeSnapshot.update, 'boolean'),
    delete: normalizeValue(safeSnapshot.delete, 'boolean'),
    role_id: normalizeValue(safeSnapshot.role_id, 'string'),
  };
}

async function getCurrentSnapshot(tx: TransactionClient, id: string): Promise<NormalizedSnapshot | null> {
  const current = await tx.permission.findUnique({
    where: { id }
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

export async function upsertPermission(data: FormData) {
  const id = data.get('id') as string | null;
  const srcSnapshotRaw = data.get('__src_snapshot') as string | null;
  if (id) {
    await requirePermission('permission', 'update');
  } else {
    await requirePermission('permission', 'create');
  }
  const name = data.get('name') as string;
  const create = data.get('create') === 'true';
  const read = data.get('read') === 'true';
  const update = data.get('update') === 'true';
  const deleteValue = data.get('delete') === 'true';
  const roleId = (data.get('role_id') as string | null) || null;

  if (id) {
    await prisma.$transaction(async (tx) => {
      if (srcSnapshotRaw) {
        await assertNotStale(tx, id, srcSnapshotRaw);
      }
      await updatePermission(tx, id, name, create, read, update, deleteValue, roleId);
    });
  } else {
    await addPermission(name, create, read, update, deleteValue, roleId);
  }

  revalidatePath('/');
  redirect('/permission');
}

async function addPermission(name: string, create: boolean, read: boolean, update: boolean, deleteValue: boolean, roleId: string | null) {
  await prisma.permission.create({
    data: {
      name: name,
      create: create,
      read: read,
      update: update,
      delete: deleteValue,
      role_id: roleId,
    },
  });
}

async function updatePermission(tx: TransactionClient, id: string, name: string, create: boolean, read: boolean, update: boolean, deleteValue: boolean, roleId: string | null) {
  await tx.permission.update({
    where: { id },
    data: {
      name: name,
      create: create,
      read: read,
      update: update,
      delete: deleteValue,
      role_id: roleId,
    },
  });
}

export async function removePermission(data: FormData | string[]) {
  await requirePermission('permission', 'delete');

  if (Array.isArray(data)) {
    await prisma.permission.deleteMany({
      where: { id: { in: data } },
    });
  } else {
    const id = data.get('id') as string;
    await prisma.permission.delete({
      where: { id },
    });
  }

  revalidatePath('/');
  redirect('/permission');
}
