import prisma from '@/lib/prisma';
import { normalizeValue, normalizeChildRefs, type NormalizedSnapshot } from '@/lib/normalize';

type TransactionClient = Pick<typeof prisma, 'xxxxx_xxxxx'>;

function normalizeSnapshot(snapshot: Record<string, unknown> | null | undefined): NormalizedSnapshot {
  const safeSnapshot = (snapshot ?? {}) as Record<string, unknown>;
  return {
    id: String(safeSnapshot.id ?? ''),
    name: normalizeValue(safeSnapshot.name, 'string'),
    description: normalizeValue(safeSnapshot.description, 'string'),
    team: normalizeValue(safeSnapshot.team, 'string'),
    yyyyy_yyyyys: normalizeChildRefs(safeSnapshot.yyyyy_yyyyys),
  };
}

async function getCurrentSnapshot(tx: TransactionClient, id: string): Promise<NormalizedSnapshot | null> {
  const current = await tx.xxxxx_xxxxx.findUnique({
    where: { id },
    include: {
      yyyyy_yyyyys: { select: { id: true } }
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

export async function addXxxxxXxxxx(creatorId: string, name: string, description: string | null, team: string | null, yyyyyYyyyysItems: { name: string; type: string; max_length: number | null; max: number | null; regex: string | null; required: boolean; written_by: string }[]) {
  return await prisma.xxxxx_xxxxx.create({
    data: {
      name: name,
      description: description,
      team: team,
      creator_id: creatorId,
      yyyyy_yyyyys: {
        create: yyyyyYyyyysItems.map(f => ({
          name: f.name,
          type: f.type,
          max_length: f.max_length,
          max: f.max,
          regex: f.regex,
          required: f.required,
          written_by: f.written_by,
        })),
      },
    },
  });
}

export async function updateXxxxxXxxxx(id: string, name: string, description: string | null, team: string | null, yyyyyYyyyysItems: { id?: string; name: string; type: string; max_length: number | null; max: number | null; regex: string | null; required: boolean; written_by: string }[], srcSnapshotRaw?: string | null) {
  return await prisma.$transaction(async (tx) => {
    if (srcSnapshotRaw) {
      await assertNotStale(tx, id, srcSnapshotRaw);
    }
    return await tx.xxxxx_xxxxx.update({
      where: { id },
      data: {
      name: name,
      description: description,
      team: team,
      yyyyy_yyyyys: {
        deleteMany: {},
        create: yyyyyYyyyysItems.map(f => ({
          name: f.name,
          type: f.type,
          max_length: f.max_length,
          max: f.max,
          regex: f.regex,
          required: f.required,
          written_by: f.written_by,
        })),
      },
      },
    });
  });
}

export async function deleteXxxxxXxxxx(ids: string[]) {
  if (ids.length === 1) {
    await prisma.xxxxx_xxxxx.delete({ where: { id: ids[0] } });
  } else {
    await prisma.xxxxx_xxxxx.deleteMany({ where: { id: { in: ids } } });
  }
}
