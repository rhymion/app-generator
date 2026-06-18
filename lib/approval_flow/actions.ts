'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { getSessionUserIdOrThrow, requirePermission, getModelPermissions } from '@/lib/authz';
import prisma from '@/lib/prisma';
import { addApprovalFlow, updateApprovalFlow, deleteApprovalFlow } from './service';
export async function upsertApprovalFlow(data: FormData) {
  const id = data.get('id') as string | null;
  const srcSnapshotRaw = data.get('__src_snapshot') as string | null;
  if (id) {
    const existing = await prisma.approval_flow.findUnique({ where: { id }, select: { id: true, creator_id: true } });
    await requirePermission('approval_flow', 'update', existing);
  } else {
    await requirePermission('approval_flow', 'create');
  }
  const entityName = data.get('entity_name') as string;
  const requestorRoleId = (data.get('requestor_role_id') as string | null) || null;
  const approverRoleId = data.get('approver_role_id') as string;
  const precededByRaw = data.getAll('preceded_by[]') as string[];
  const precededByItems = precededByRaw.map(f => JSON.parse(f) as { id?: string; name?: string });
  const precededByIds = precededByItems
    .map((precededBy) => precededBy.id)
    .filter((precededById): precededById is string => Boolean(precededById));
  const followedByRaw = data.getAll('followed_by[]') as string[];
  const followedByItems = followedByRaw.map(f => JSON.parse(f) as { id?: string; name?: string });
  const followedByIds = followedByItems
    .map((followedBy) => followedBy.id)
    .filter((followedById): followedById is string => Boolean(followedById));
  const actorId = await getSessionUserIdOrThrow();

  if (id) {
    await updateApprovalFlow(actorId, id, entityName, requestorRoleId, approverRoleId, precededByIds, followedByIds, srcSnapshotRaw);
  } else {
    await addApprovalFlow(actorId, entityName, requestorRoleId, approverRoleId, precededByIds, followedByIds);
  }

  redirect('/approval_flow');
}
export async function removeApprovalFlow(ids: string[]) {
  const [{ permissions: userPermissions, userId }, approvalFlows] = await Promise.all([
    getModelPermissions('approval_flow'),
    await prisma.approval_flow.findMany({ where: { id: { in: ids } }, select: { id: true, creator_id: true } }),
  ]);
  const filteredApprovalFlows = userPermissions.general.delete
    ? approvalFlows
    : approvalFlows.filter(item =>
        (userPermissions.creator?.delete && item.creator_id === userId) ||
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (userPermissions.assignee?.delete && (item as any).assignee_id === userId)
      );
  if (filteredApprovalFlows.length === 0) {
    throw new Error('No permission to delete');
  }
  await deleteApprovalFlow(filteredApprovalFlows.map(item => item.id));
  revalidatePath('/[locale]/approval_flow', 'page');
  redirect('/approval_flow');
}

