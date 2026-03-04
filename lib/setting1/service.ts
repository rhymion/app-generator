import prisma from '@/lib/prisma';
import { normalizeValue, assertNotStale, type NormalizedSnapshot } from '@/lib/normalize';
import { validateOnAdd, validateOnUpdate } from './service_validation';

type TransactionClient = Pick<typeof prisma, 'user_account'>;

function normalizeSnapshot(snapshot: Record<string, unknown> | null | undefined): NormalizedSnapshot {
  const safeSnapshot = (snapshot ?? {}) as Record<string, unknown>;
  return {
    id: String(safeSnapshot.id ?? ''),
    name: normalizeValue(safeSnapshot.name, 'string'),
    email: normalizeValue(safeSnapshot.email, 'string'),
    password: normalizeValue(safeSnapshot.password, 'string'),
    api_key: normalizeValue(safeSnapshot.api_key, 'string'),
    avatar: normalizeValue(safeSnapshot.avatar, 'string'),
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

export async function addSetting1(creatorId: string, name: string, email: string, password: string, apiKey: string | null, avatar: string | null) {
  return await prisma.$transaction(async (tx) => {
    await validateOnAdd(tx, {
      name: name,
      email: email,
      password: password,
      api_key: apiKey,
      avatar: avatar,
    });
    return await tx.user_account.create({
      data: {
        name: name,
        email: email,
        password: password,
        api_key: apiKey,
        avatar: avatar,
        creator_id: creatorId,
        updater_id: creatorId,
      },
    });
  });
}

export async function updateSetting1(updaterId: string, id: string, name: string, email: string, password: string, apiKey: string | null, avatar: string | null, srcSnapshotRaw?: string | null) {
  return await prisma.$transaction(async (tx) => {
    if (srcSnapshotRaw) {
      await assertNotStale(srcSnapshotRaw, normalizeSnapshot, () => getCurrentSnapshot(tx, id));
    }
    await validateOnUpdate(tx, id, {
      name: name,
      email: email,
      password: password,
      api_key: apiKey,
      avatar: avatar,
    });
    return await tx.user_account.update({
      where: { id },
      data: {
        name: name,
        email: email,
        password: password,
        api_key: apiKey,
        avatar: avatar,
        updater_id: updaterId,
      },
    });
  });
}

export async function deleteSetting1(ids: string[]) {
  if (ids.length === 1) {
    await prisma.user_account.delete({ where: { id: ids[0] } });
  } else {
    await prisma.user_account.deleteMany({ where: { id: { in: ids } } });
  }
}
