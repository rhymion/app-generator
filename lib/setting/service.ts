import prisma from '@/lib/prisma';
import { normalizeValue, normalizeChildRefs, assertNotStale, type NormalizedSnapshot } from '@/lib/normalize';
import { validateOnAdd, validateOnUpdate } from './service_validation';

type TransactionClient = Pick<typeof prisma, 'user'>;

function normalizeSnapshot(snapshot: Record<string, unknown> | null | undefined): NormalizedSnapshot {
  const safeSnapshot = (snapshot ?? {}) as Record<string, unknown>;
  return {
    id: String(safeSnapshot.id ?? ''),
    name: normalizeValue(safeSnapshot.name, 'string'),
    email: normalizeValue(safeSnapshot.email, 'string'),
    password: normalizeValue(safeSnapshot.password, 'string'),
    api_key: normalizeValue(safeSnapshot.api_key, 'string'),
    image: normalizeValue(safeSnapshot.image, 'string'),
    mfa_enabled: normalizeValue(safeSnapshot.mfa_enabled, 'boolean'),
    roles: normalizeChildRefs(safeSnapshot.roles),
  };
}

async function getCurrentSnapshot(tx: TransactionClient, id: string): Promise<NormalizedSnapshot | null> {
  const current = await tx.user.findUnique({
    where: { id },
    include: {
      roles: { select: { id: true } }
    }
  });

  if (!current) {
    return null;
  }

  return normalizeSnapshot(current as Record<string, unknown>);
}
export async function updateSetting(actorId: string, id: string, name: string, email: string, password: string | null, apiKey: string | null, image: string | null, mfaEnabled: boolean, rolesIds: string[], srcSnapshotRaw: string | null): Promise<void> {
  await prisma.$transaction(async (tx) => {
    if (srcSnapshotRaw) {
      await assertNotStale(srcSnapshotRaw, normalizeSnapshot, () => getCurrentSnapshot(tx, id));
    }
    await validateOnUpdate(tx, id, {
      name: name,
      email: email,
      password: password,
      api_key: apiKey,
      image: image,
      mfa_enabled: mfaEnabled,
    });
    await tx.user.update({
      where: { id },
      data: {
        updater_id: actorId,
        name: name,
        email: email,
        password: password,
        api_key: apiKey,
        image: image,
        mfa_enabled: mfaEnabled,
      roles: {
        set: rolesIds.map((id) => ({ id })),
      },
      },
    });
  });
}
