import prisma from '@/lib/prisma';
import { normalizeValue, assertNotStale, type NormalizedSnapshot } from '@/lib/normalize';
import { validateOnAdd, validateOnUpdate } from './service_validation';
import { afterCreate } from './service_after_create';

type TransactionClient = Pick<typeof prisma, 'fc_link'>;

function normalizeSnapshot(snapshot: Record<string, unknown> | null | undefined): NormalizedSnapshot {
  const safeSnapshot = (snapshot ?? {}) as Record<string, unknown>;
  return {
    id: String(safeSnapshot.id ?? ''),
    name: normalizeValue(safeSnapshot.name, 'string'),
    url: normalizeValue(safeSnapshot.url, 'string'),
  };
}

async function getCurrentSnapshot(tx: TransactionClient, id: string): Promise<NormalizedSnapshot | null> {
  const current = await tx.fc_link.findUnique({
    where: { id }
  });

  if (!current) {
    return null;
  }

  return normalizeSnapshot(current as Record<string, unknown>);
}
export async function addFcLink(actorId: string, name: string, url: string, selectedParentType: string, selectedParentId: string): Promise<{ id: string }> {
  const result = await prisma.$transaction(async (tx) => {
    await validateOnAdd(tx, {
      name: name,
      url: url,
    });
    let _resolvedBridgeFk: string;
    if (selectedParentType === 'work') {
      const _bp = await tx.work.findUnique({ where: { id: selectedParentId }, select: { fc_linkable_id: true } });
      if (!_bp) throw new Error('Work does not exist');
      _resolvedBridgeFk = _bp.fc_linkable_id;
        } else if (selectedParentType === 'character') {
      const _bp = await tx.character.findUnique({ where: { id: selectedParentId }, select: { fc_linkable_id: true } });
      if (!_bp) throw new Error('Character does not exist');
      _resolvedBridgeFk = _bp.fc_linkable_id;
        } else if (selectedParentType === 'music') {
      const _bp = await tx.music.findUnique({ where: { id: selectedParentId }, select: { fc_linkable_id: true } });
      if (!_bp) throw new Error('Music does not exist');
      _resolvedBridgeFk = _bp.fc_linkable_id;
        } else if (selectedParentType === 'channel') {
      const _bp = await tx.channel.findUnique({ where: { id: selectedParentId }, select: { fc_linkable_id: true } });
      if (!_bp) throw new Error('Channel does not exist');
      _resolvedBridgeFk = _bp.fc_linkable_id;
    } else {
      throw new Error('Invalid bridge parent type: ' + selectedParentType);
    }
    const created = await tx.fc_link.create({
      data: {
        creator_id: actorId,
        updater_id: actorId,
        fc_linkable_id: _resolvedBridgeFk,
        name: name,
        url: url,
      },
    });
    await afterCreate(tx, created as Record<string, unknown>, {
      name: name,
      url: url,
    });
    return { id: created.id };
  });
  return result;
}
export async function updateFcLink(actorId: string, id: string, name: string, url: string, srcSnapshotRaw: string | null): Promise<void> {
  await prisma.$transaction(async (tx) => {
    if (srcSnapshotRaw) {
      await assertNotStale(srcSnapshotRaw, normalizeSnapshot, () => getCurrentSnapshot(tx, id));
    }
    await validateOnUpdate(tx, id, {
      name: name,
      url: url,
    });
    await tx.fc_link.update({
      where: { id },
      data: {
        updater_id: actorId,
        name: name,
        url: url,
      },
    });
  });
}
export async function deleteFcLink(ids: string[]): Promise<void> {
  await prisma.fc_link.deleteMany({ where: { id: { in: ids } } });
}
