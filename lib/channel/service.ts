import prisma from '@/lib/prisma';
import { normalizeValue, assertNotStale, type NormalizedSnapshot } from '@/lib/normalize';
import { validateOnAdd, validateOnUpdate } from './service_validation';
import { afterCreate } from './service_after_create';

type TransactionClient = Pick<typeof prisma, 'channel'>;

function normalizeSnapshot(snapshot: Record<string, unknown> | null | undefined): NormalizedSnapshot {
  const safeSnapshot = (snapshot ?? {}) as Record<string, unknown>;
  return {
    id: String(safeSnapshot.id ?? ''),
    name: normalizeValue(safeSnapshot.name, 'string'),
    kind: normalizeValue(safeSnapshot.kind, 'number'),
    organization_id: normalizeValue(safeSnapshot.organization_id, 'string'),
  };
}

async function getCurrentSnapshot(tx: TransactionClient, id: string): Promise<NormalizedSnapshot | null> {
  const current = await tx.channel.findUnique({
    where: { id }
  });

  if (!current) {
    return null;
  }

  return normalizeSnapshot(current as Record<string, unknown>);
}
export async function addChannel(actorId: string, name: string, kind: number, organizationId: string, selectedParentType: string, selectedParentId: string): Promise<{ id: string }> {
  const result = await prisma.$transaction(async (tx) => {
    await validateOnAdd(tx, {
      name: name,
      kind: kind,
      organization_id: organizationId,
    });
    let _resolvedBridgeFk: string;
    if (selectedParentType === 'work') {
      const _bp = await tx.work.findUnique({ where: { id: selectedParentId }, select: { channelable_id: true } });
      if (!_bp) throw new Error('Work does not exist');
      _resolvedBridgeFk = _bp.channelable_id;
        } else if (selectedParentType === 'character') {
      const _bp = await tx.character.findUnique({ where: { id: selectedParentId }, select: { channelable_id: true } });
      if (!_bp) throw new Error('Character does not exist');
      _resolvedBridgeFk = _bp.channelable_id;
        } else if (selectedParentType === 'scene') {
      const _bp = await tx.scene.findUnique({ where: { id: selectedParentId }, select: { channelable_id: true } });
      if (!_bp) throw new Error('Scene does not exist');
      _resolvedBridgeFk = _bp.channelable_id;
    } else {
      throw new Error('Invalid bridge parent type: ' + selectedParentType);
    }
    const commentable = await tx.commentable.create({ data: {} });
    const fc_linkable = await tx.fc_linkable.create({ data: {} });
    const created = await tx.channel.create({
      data: {
        creator_id: actorId,
        updater_id: actorId,
        channelable_id: _resolvedBridgeFk,
        name: name,
        kind: kind,
        organization_id: organizationId,
        commentable_id: commentable.id,
        fc_linkable_id: fc_linkable.id,
      },
    });
    await afterCreate(tx, { ...created, commentable: { id: created.commentable_id }, fc_linkable: { id: created.fc_linkable_id } } as Record<string, unknown>, {
      name: name,
      kind: kind,
      organization_id: organizationId,
    });
    return { id: created.id };
  });
  return result;
}
export async function updateChannel(actorId: string, id: string, name: string, kind: number, organizationId: string, srcSnapshotRaw: string | null): Promise<void> {
  await prisma.$transaction(async (tx) => {
    if (srcSnapshotRaw) {
      await assertNotStale(srcSnapshotRaw, normalizeSnapshot, () => getCurrentSnapshot(tx, id));
    }
    await validateOnUpdate(tx, id, {
      name: name,
      kind: kind,
      organization_id: organizationId,
    });
    await tx.channel.update({
      where: { id },
      data: {
        updater_id: actorId,
        name: name,
        kind: kind,
        organization_id: organizationId,
      },
    });
  });
}
export async function deleteChannel(ids: string[]): Promise<void> {
  const _bridgeRows = await prisma.channel.findMany({ where: { id: { in: ids } }, select: { commentable_id: true, fc_linkable_id: true } });
  await prisma.channel.deleteMany({ where: { id: { in: ids } } });
  await prisma.commentable.deleteMany({ where: { id: { in: _bridgeRows.map((r) => r.commentable_id).filter(Boolean) } } });
  await prisma.fc_linkable.deleteMany({ where: { id: { in: _bridgeRows.map((r) => r.fc_linkable_id).filter(Boolean) } } });
}
