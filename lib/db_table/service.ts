import prisma from '@/lib/prisma';
import { normalizeValue, normalizeChildRefs, assertNotStale, type NormalizedSnapshot } from '@/lib/normalize';
import { validateOnAdd, validateOnUpdate } from './service_validation';

type TransactionClient = Pick<typeof prisma, 'db_table'>;

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

export async function addDbTable(creatorId: string, name: string, description: string | null, fieldsItems: { name: string; type: string; reference_id: string | null; max_length: number | null; max: number | null; regex: string | null; required: boolean }[]) {
  return await prisma.$transaction(async (tx) => {
    await validateOnAdd(tx, {
      name: name,
      description: description,
    });
    return await tx.db_table.create({
      data: {
        name: name,
        description: description,
        creator_id: creatorId,
        updater_id: creatorId,
        fields: {
          create: fieldsItems.map(f => ({
          name: f.name,
          type: f.type,
          reference_id: f.reference_id || null,
          max_length: f.max_length,
          max: f.max,
          regex: f.regex,
          required: f.required,
          })),
        },
      },
    });
  });
}

export async function updateDbTable(updaterId: string, id: string, name: string, description: string | null, fieldsItems: { id?: string; name: string; type: string; reference_id: string | null; max_length: number | null; max: number | null; regex: string | null; required: boolean }[], srcSnapshotRaw?: string | null) {
  return await prisma.$transaction(async (tx) => {
    if (srcSnapshotRaw) {
      await assertNotStale(srcSnapshotRaw, normalizeSnapshot, () => getCurrentSnapshot(tx, id));
    }
    await validateOnUpdate(tx, id, {
      name: name,
      description: description,
    });
    return await tx.db_table.update({
      where: { id },
      data: {
        name: name,
        description: description,
        updater_id: updaterId,
      fields: {
        deleteMany: {},
        create: fieldsItems.map(f => ({
          name: f.name,
          type: f.type,
          reference_id: f.reference_id || null,
          max_length: f.max_length,
          max: f.max,
          regex: f.regex,
          required: f.required,
        })),
      },
      },
    });
  });
}

export async function deleteDbTable(ids: string[]) {
  if (ids.length === 1) {
    await prisma.db_table.delete({ where: { id: ids[0] } });
  } else {
    await prisma.db_table.deleteMany({ where: { id: { in: ids } } });
  }
}
