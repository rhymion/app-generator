'use server';

import { redirect } from 'next/navigation';
import prisma from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { requirePermission } from '@/lib/authz';

type NormalizedSnapshot = Record<string, unknown>;
type TransactionClient = Pick<typeof prisma, 'parent_only'>;

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
    login_time: normalizeValue(safeSnapshot.login_time, 'date'),
    logout_time: normalizeValue(safeSnapshot.logout_time, 'date'),
  };
}

async function getCurrentSnapshot(tx: TransactionClient, id: string): Promise<NormalizedSnapshot | null> {
  const current = await tx.parent_only.findUnique({
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

export async function upsertParentOnly(data: FormData) {
  const id = data.get('id') as string | null;
  const srcSnapshotRaw = data.get('__src_snapshot') as string | null;
  if (id) {
    await requirePermission('parent_only', 'update');
  } else {
    await requirePermission('parent_only', 'create');
  }
  const name = data.get('name') as string;
  const description = data.get('description') as string | null;
  const loginTimeStr = data.get('login_time') as string | null;
  const loginTime = loginTimeStr ? new Date(loginTimeStr) : null;
  const logoutTimeStr = data.get('logout_time') as string | null;
  const logoutTime = logoutTimeStr ? new Date(logoutTimeStr) : null;

  if (id) {
    await prisma.$transaction(async (tx) => {
      if (srcSnapshotRaw) {
        await assertNotStale(tx, id, srcSnapshotRaw);
      }
      await updateParentOnly(tx, id, name, description, loginTime, logoutTime);
    });
  } else {
    await addParentOnly(name, description, loginTime, logoutTime);
  }

  revalidatePath('/');
  redirect('/parent_only');
}

async function addParentOnly(name: string, description: string | null, loginTime: Date | null, logoutTime: Date | null) {
  await prisma.parent_only.create({
    data: {
      name: name,
      description: description,
      login_time: loginTime,
      logout_time: logoutTime,
    },
  });
}

async function updateParentOnly(tx: TransactionClient, id: string, name: string, description: string | null, loginTime: Date | null, logoutTime: Date | null) {
  await tx.parent_only.update({
    where: { id },
    data: {
      name: name,
      description: description,
      login_time: loginTime,
      logout_time: logoutTime,
    },
  });
}

export async function removeParentOnly(data: FormData | string[]) {
  await requirePermission('parent_only', 'delete');

  if (Array.isArray(data)) {
    await prisma.parent_only.deleteMany({
      where: { id: { in: data } },
    });
  } else {
    const id = data.get('id') as string;
    await prisma.parent_only.delete({
      where: { id },
    });
  }

  revalidatePath('/');
  redirect('/parent_only');
}
