import prisma from '@/lib/prisma';
import { normalizeValue, normalizeChildRefs, assertNotStale, type NormalizedSnapshot } from '@/lib/normalize';

type TransactionClient = Pick<typeof prisma, 'parent1'>;

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

export async function addParent1(creatorId: string, name: string, organizationId: string, description: string | null, price: number, dueDate: Date, imageUrl: string | null, parent1Child1sItems: { order: number; name: string; type: string; max_length: number | null; max: number | null; regex: string | null; required: boolean; written_by: string }[], parent1Child2sItems: { name: string; required: boolean; start_date: Date | null; end_date: Date }[], parent1ListsItems: { name: string }[]) {
  return await prisma.parent1.create({
    data: {
      name: name,
      organization_id: organizationId,
      description: description,
      price: price,
      due_date: dueDate,
      image_url: imageUrl,
      creator_id: creatorId,
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

export async function updateParent1(id: string, name: string, organizationId: string, description: string | null, price: number, dueDate: Date, imageUrl: string | null, parent1Child1sItems: { id?: string; order: number; name: string; type: string; max_length: number | null; max: number | null; regex: string | null; required: boolean; written_by: string }[], parent1Child2sItems: { id?: string; name: string; required: boolean; start_date: Date | null; end_date: Date }[], parent1ListsItems: { id?: string; name: string }[], srcSnapshotRaw?: string | null) {
  return await prisma.$transaction(async (tx) => {
    if (srcSnapshotRaw) {
      await assertNotStale(srcSnapshotRaw, normalizeSnapshot, () => getCurrentSnapshot(tx, id));
    }
    return await tx.parent1.update({
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
  });
}

export async function deleteParent1(ids: string[]) {
  if (ids.length === 1) {
    await prisma.parent1.delete({ where: { id: ids[0] } });
  } else {
    await prisma.parent1.deleteMany({ where: { id: { in: ids } } });
  }
}
