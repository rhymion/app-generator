import prisma from '@/lib/prisma';
import { normalizeValue, normalizeChildRefs, assertNotStale, type NormalizedSnapshot } from '@/lib/normalize';
import { validateOnAdd, validateOnUpdate } from './service_validation';
import { afterCreate } from './service_after_create';

type TransactionClient = Pick<typeof prisma, 'approval_flow'>;

function normalizeSnapshot(snapshot: Record<string, unknown> | null | undefined): NormalizedSnapshot {
  const safeSnapshot = (snapshot ?? {}) as Record<string, unknown>;
  return {
    id: String(safeSnapshot.id ?? ''),
    entity_name: normalizeValue(safeSnapshot.entity_name, 'string'),
    requestor_role_id: normalizeValue(safeSnapshot.requestor_role_id, 'string'),
    approver_role_id: normalizeValue(safeSnapshot.approver_role_id, 'string'),
    preceded_by: normalizeChildRefs(safeSnapshot.preceded_by),
    followed_by: normalizeChildRefs(safeSnapshot.followed_by),
  };
}

async function getCurrentSnapshot(tx: TransactionClient, id: string): Promise<NormalizedSnapshot | null> {
  const current = await tx.approval_flow.findUnique({
    where: { id },
    include: {
      preceded_by: { select: { id: true } },
      followed_by: { select: { id: true } }
    }
  });

  if (!current) {
    return null;
  }

  return normalizeSnapshot(current as Record<string, unknown>);
}
export async function addApprovalFlow(actorId: string, entityName: string, requestorRoleId: string | null, approverRoleId: string, precededByIds: string[], followedByIds: string[]): Promise<{ id: string }> {
  const result = await prisma.$transaction(async (tx) => {
    await validateOnAdd(tx, {
      entity_name: entityName,
      requestor_role_id: requestorRoleId,
      approver_role_id: approverRoleId,
    });
    const created = await tx.approval_flow.create({
      data: {
        creator_id: actorId,
        updater_id: actorId,
        entity_name: entityName,
        requestor_role_id: requestorRoleId,
        approver_role_id: approverRoleId,
      preceded_by: {
        connect: precededByIds.map((id) => ({ id })),
      },
      followed_by: {
        connect: followedByIds.map((id) => ({ id })),
      },
      },
    });
    await afterCreate(tx, created as Record<string, unknown>, {
      entity_name: entityName,
      requestor_role_id: requestorRoleId,
      approver_role_id: approverRoleId,
    });
    return { id: created.id };
  });
  return result;
}
export async function updateApprovalFlow(actorId: string, id: string, entityName: string, requestorRoleId: string | null, approverRoleId: string, precededByIds: string[], followedByIds: string[], srcSnapshotRaw: string | null): Promise<void> {
  await prisma.$transaction(async (tx) => {
    if (srcSnapshotRaw) {
      await assertNotStale(srcSnapshotRaw, normalizeSnapshot, () => getCurrentSnapshot(tx, id));
    }
    await validateOnUpdate(tx, id, {
      entity_name: entityName,
      requestor_role_id: requestorRoleId,
      approver_role_id: approverRoleId,
    });
    await tx.approval_flow.update({
      where: { id },
      data: {
        updater_id: actorId,
        entity_name: entityName,
        requestor_role_id: requestorRoleId,
        approver_role_id: approverRoleId,
      preceded_by: {
        set: precededByIds.map((id) => ({ id })),
      },
      followed_by: {
        set: followedByIds.map((id) => ({ id })),
      },
      },
    });
  });
}
export async function deleteApprovalFlow(ids: string[]): Promise<void> {
  await prisma.approval_flow.deleteMany({ where: { id: { in: ids } } });
}
