'use server';

import { redirect } from 'next/navigation';
import prisma from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { requirePermission } from '@/lib/authz';

type NormalizedSnapshot = Record<string, unknown>;
type TransactionClient = Pick<typeof prisma, 'parent1'>;

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
    organization_id: normalizeValue(safeSnapshot.organization_id, 'string'),
    description: normalizeValue(safeSnapshot.description, 'string'),
    price: normalizeValue(safeSnapshot.price, 'number'),
    due_date: normalizeValue(safeSnapshot.due_date, 'date'),
    image_url: normalizeValue(safeSnapshot.image_url, 'string'),
    parent1_child1s: normalizeChildRefs(safeSnapshot.parent1_child1s),
    parent1_child2s: normalizeChildRefs(safeSnapshot.parent1_child2s),
    parent1_lists: normalizeChildRefs(safeSnapshot.parent1_lists),
  };
}

async function getCurrentSnapshot(tx: TransactionClient, id: string): Promise<NormalizedSnapshot | null> {
  const current = await tx.parent1.findUnique({
    where: { id },
    include: {
      parent1_child1s: { select: { id: true } },
      parent1_child2s: { select: { id: true } },
      parent1_lists: { select: { id: true } }
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

export async function upsertParent1(data: FormData) {
  const id = data.get('id') as string | null;
  const srcSnapshotRaw = data.get('__src_snapshot') as string | null;
  if (id) {
    await requirePermission('parent1', 'update');
  } else {
    await requirePermission('parent1', 'create');
  }
  const name = data.get('name') as string;
  const organizationId = data.get('organization_id') as string;
  const description = data.get('description') as string | null;
  const price = Number(data.get('price'));
  const dueDateStr = data.get('due_date') as string;
  const dueDate = new Date(dueDateStr);
  const imageUrl = data.get('image_url') as string | null;
  const parent1Child1sRaw = data.getAll('parent1_child1[]') as string[];
  const parent1Child1sItems = parent1Child1sRaw.map(f => JSON.parse(f) as { id?: string; order: number; name: string; type: string; max_length: number | null; max: number | null; regex: string | null; required: boolean; written_by: string });
  const parent1Child2sRaw = data.getAll('parent1_child2[]') as string[];
  const parent1Child2sItems = parent1Child2sRaw.map(f => JSON.parse(f) as { id?: string; name: string; required: boolean; start_date: Date | null; end_date: Date });
  const parent1ListsRaw = data.getAll('parent1_list[]') as string[];
  const parent1ListsItems = parent1ListsRaw.map(f => JSON.parse(f) as { id?: string; name: string });


  if (id) {
    await prisma.$transaction(async (tx) => {
      if (srcSnapshotRaw) {
        await assertNotStale(tx, id, srcSnapshotRaw);
      }
      await updateParent1(tx, id, name, organizationId, description, price, dueDate, imageUrl, parent1Child1sItems, parent1Child2sItems, parent1ListsItems);
    });
  } else {
    await addParent1(name, organizationId, description, price, dueDate, imageUrl, parent1Child1sItems, parent1Child2sItems, parent1ListsItems);
  }

  revalidatePath('/');
  redirect('/parent1');
}

async function addParent1(name: string, organizationId: string, description: string | null, price: number, dueDate: Date, imageUrl: string | null, parent1Child1sItems: { order: number; name: string; type: string; max_length: number | null; max: number | null; regex: string | null; required: boolean; written_by: string }[], parent1Child2sItems: { name: string; required: boolean; start_date: Date | null; end_date: Date }[], parent1ListsItems: { name: string }[]) {
  await prisma.parent1.create({
    data: {
      name: name,
      organization_id: organizationId,
      description: description,
      price: price,
      due_date: dueDate,
      image_url: imageUrl,
      parent1_child1s: {
        create: parent1Child1sItems.map(f => ({
          order: f.order,
          name: f.name,
          type: f.type,
          max_length: f.max_length,
          max: f.max,
          regex: f.regex,
          required: f.required,
          written_by: f.written_by,
        })),
      },
      parent1_child2s: {
        create: parent1Child2sItems.map(f => ({
          name: f.name,
          required: f.required,
          start_date: f.start_date,
          end_date: f.end_date,
        })),
      },
      parent1_lists: {
        create: parent1ListsItems.map(f => ({
          name: f.name,
        })),
      },
    },
  });
}

async function updateParent1(tx: TransactionClient, id: string, name: string, organizationId: string, description: string | null, price: number, dueDate: Date, imageUrl: string | null, parent1Child1sItems: { id?: string; order: number; name: string; type: string; max_length: number | null; max: number | null; regex: string | null; required: boolean; written_by: string }[], parent1Child2sItems: { id?: string; name: string; required: boolean; start_date: Date | null; end_date: Date }[], parent1ListsItems: { id?: string; name: string }[]) {
  await tx.parent1.update({
    where: { id },
    data: {
      name: name,
      organization_id: organizationId,
      description: description,
      price: price,
      due_date: dueDate,
      image_url: imageUrl,
      parent1_child1s: {
        deleteMany: {},
        create: parent1Child1sItems.map(f => ({
          order: f.order,
          name: f.name,
          type: f.type,
          max_length: f.max_length,
          max: f.max,
          regex: f.regex,
          required: f.required,
          written_by: f.written_by,
        })),
      },
      parent1_child2s: {
        deleteMany: {},
        create: parent1Child2sItems.map(f => ({
          name: f.name,
          required: f.required,
          start_date: f.start_date,
          end_date: f.end_date,
        })),
      },
      parent1_lists: {
        deleteMany: {},
        create: parent1ListsItems.map(f => ({
          name: f.name,
        })),
      },
    },
  });
}

export async function removeParent1(data: FormData | string[]) {
  await requirePermission('parent1', 'delete');

  if (Array.isArray(data)) {
    await prisma.parent1.deleteMany({
      where: { id: { in: data } },
    });
  } else {
    const id = data.get('id') as string;
    await prisma.parent1.delete({
      where: { id },
    });
  }

  revalidatePath('/');
  redirect('/parent1');
}
