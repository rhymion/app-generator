import prisma from '@/lib/prisma';
import { normalizeValue, type NormalizedSnapshot } from '@/lib/normalize';
import { validateOnAdd, validateOnUpdate } from './service_validation';

type TransactionClient = Pick<typeof prisma, 'user_account'>;

function normalizeSnapshot(snapshot: Record<string, unknown> | null | undefined): NormalizedSnapshot {
  const safeSnapshot = (snapshot ?? {}) as Record<string, unknown>;
  return {
    id: String(safeSnapshot.id ?? ''),
    name: normalizeValue(safeSnapshot.name, 'string'),
    email: normalizeValue(safeSnapshot.email, 'string'),
    password: normalizeValue(safeSnapshot.password, 'string'),
  };
}

async function getCurrentSnapshot(tx: TransactionClient, id: string): Promise<NormalizedSnapshot | null> {
  const current = await tx.user_account.findUnique({
    where: { id }
  });

  if (!current) {
    return null;
  }

  return normalizeSnapshot(current as Record<string, unknown>);
}

export async function addSetting2(creatorId: string, name: string, email: string, password: string) {
  return await prisma.$transaction(async (tx) => {
    await validateOnAdd(tx, {
      name: name,
      email: email,
      password: password,
    });
    return await tx.user_account.create({
      data: {
        name: name,
        email: email,
        password: password,
        creator_id: creatorId,
        updater_id: creatorId,
      },
    });
  });
}
