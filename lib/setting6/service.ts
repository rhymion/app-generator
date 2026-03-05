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

export async function deleteSetting6(ids: string[]) {
  if (ids.length === 1) {
    await prisma.xxxxx_xxxxx.delete({ where: { id: ids[0] } });
  } else {
    await prisma.xxxxx_xxxxx.deleteMany({ where: { id: { in: ids } } });
  }
}
