'use server';

import { redirect } from 'next/navigation';
import prisma from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { getSessionUserIdOrThrow, requirePermission } from '@/lib/authz';

type NormalizedSnapshot = Record<string, unknown>;
type TransactionClient = Pick<typeof prisma, 'db_table'>;

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
    fields: normalizeChildRefs(safeSnapshot.fields),
  };
}

async function getCurrentSnapshot(tx: TransactionClient, id: string): Promise<NormalizedSnapshot | null> {
  const current = await tx.db_table.findUnique({
    where: { id },
    include: {
      fields: { select: { id: true } }
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

export async function upsertDbTable(data: FormData) {
  const id = data.get('id') as string | null;
  const srcSnapshotRaw = data.get('__src_snapshot') as string | null;
  if (id) {
    await requirePermission('db_table', 'update');
  } else {
    await requirePermission('db_table', 'create');
  }
  const name = data.get('name') as string;
  const description = data.get('description') as string | null;
  const fieldsRaw = data.getAll('field[]') as string[];
  const fieldsItems = fieldsRaw.map(f => JSON.parse(f) as { id?: string; name: string; type: string; max_length: number | null; max: number | null; regex: string | null; required: boolean });


  if (id) {
    await prisma.$transaction(async (tx) => {
      if (srcSnapshotRaw) {
        await assertNotStale(tx, id, srcSnapshotRaw);
      }
      await updateDbTable(tx, id, name, description, fieldsItems);
    });
  } else {
    const creatorId = await getSessionUserIdOrThrow();
    await addDbTable(creatorId, name, description, fieldsItems);
  }

  revalidatePath('/');
  redirect('/db_table');
}

async function addDbTable(creatorId: string, name: string, description: string | null, fieldsItems: { name: string; type: string; max_length: number | null; max: number | null; regex: string | null; required: boolean }[]) {
  await prisma.db_table.create({
    data: {
      name: name,
      description: description,
      creator_id: creatorId,
      fields: {
        create: fieldsItems.map(f => ({
          name: f.name,
          type: f.type,
          max_length: f.max_length,
          max: f.max,
          regex: f.regex,
          required: f.required,
        })),
      },
    },
  });
}

async function updateDbTable(tx: TransactionClient, id: string, name: string, description: string | null, fieldsItems: { id?: string; name: string; type: string; max_length: number | null; max: number | null; regex: string | null; required: boolean }[]) {
  await tx.db_table.update({
    where: { id },
    data: {
      name: name,
      description: description,
      fields: {
        deleteMany: {},
        create: fieldsItems.map(f => ({
          name: f.name,
          type: f.type,
          max_length: f.max_length,
          max: f.max,
          regex: f.regex,
          required: f.required,
        })),
      },
    },
  });
}

export async function removeDbTable(data: FormData | string[]) {
  await requirePermission('db_table', 'delete');

  if (Array.isArray(data)) {
    await prisma.db_table.deleteMany({
      where: { id: { in: data } },
    });
  } else {
    const id = data.get('id') as string;
    await prisma.db_table.delete({
      where: { id },
    });
  }

  revalidatePath('/');
  redirect('/db_table');
}
