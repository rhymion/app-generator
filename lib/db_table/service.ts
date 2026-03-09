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
export async function addDbTable(userId: string, name: string, description: string | null, fieldsItems: { name: string; type: string; reference_id: string | null; max_length: number | null; max: number | null; regex: string | null; required: boolean }[]): Promise<{ id: string }> {
  return await prisma.$transaction(async (tx) => {
    await validateOnAdd(tx, {
      name: name,
      description: description,
    });
    const created = await tx.db_table.create({
      data: {
        creator_id: userId,
        updater_id: userId,
        name: name,
        description: description,
      fields: {
        create: fieldsItems.map(f => ({
          name: f.name,
          type: f.type,
          reference_id: f.reference_id,
          max_length: f.max_length,
          max: f.max,
          regex: f.regex,
          required: f.required,
        })),
      },
      },
    });
    return { id: created.id };
  });
}
export async function updateDbTable(userId: string, id: string, name: string, description: string | null, fieldsItems: { name: string; type: string; reference_id: string | null; max_length: number | null; max: number | null; regex: string | null; required: boolean }[], srcSnapshotRaw: string | null): Promise<void> {
  await prisma.$transaction(async (tx) => {
    if (srcSnapshotRaw) {
      await assertNotStale(srcSnapshotRaw, normalizeSnapshot, () => getCurrentSnapshot(tx, id));
    }
    await validateOnUpdate(tx, id, {
      name: name,
      description: description,
    });
    await tx.db_table.update({
      where: { id },
      data: {
        updater_id: userId,
        name: name,
        description: description,
      fields: {
        deleteMany: {},
        create: fieldsItems.map(f => ({
          name: f.name,
          type: f.type,
          reference_id: f.reference_id,
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
export async function deleteDbTable(ids: string[]): Promise<void> {
  await prisma.db_table.deleteMany({ where: { id: { in: ids } } });
}
