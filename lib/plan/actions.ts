'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { getSessionUserIdOrThrow, requirePermission, getModelPermissions } from '@/lib/authz';
import prisma from '@/lib/prisma';
import { addPlan, updatePlan, deletePlan } from './service';
export async function upsertPlan(data: FormData) {
  const id = data.get('id') as string | null;
  const srcSnapshotRaw = data.get('__src_snapshot') as string | null;
  if (id) {
    const existing = await prisma.plan.findUnique({ where: { id }, select: { id: true, creator_id: true } });
    await requirePermission('plan', 'update', existing);
  } else {
    await requirePermission('plan', 'create');
  }
  const tier = Number(data.get('tier'));
  const reactionKindsAllowed = Number(data.get('reaction_kinds_allowed'));
  const subAccountLimit = Number(data.get('sub_account_limit'));
  const canViewPaidPosts = data.get('can_view_paid_posts') === 'true';
  const usersRaw = data.getAll('user[]') as string[];
  const usersItems = usersRaw.map(f => JSON.parse(f) as { id?: string; name?: string });
  const usersIds = usersItems
    .map((user) => user.id)
    .filter((userId): userId is string => Boolean(userId));
  const actorId = await getSessionUserIdOrThrow();

  if (id) {
    await updatePlan(actorId, id, tier, reactionKindsAllowed, subAccountLimit, canViewPaidPosts, usersIds, srcSnapshotRaw);
  } else {
    await addPlan(actorId, tier, reactionKindsAllowed, subAccountLimit, canViewPaidPosts, usersIds);
  }

  redirect('/plan');
}
export async function removePlan(ids: string[]) {
  const [{ permissions: userPermissions, userId }, plans] = await Promise.all([
    getModelPermissions('plan'),
    await prisma.plan.findMany({ where: { id: { in: ids } }, select: { id: true, creator_id: true } }),
  ]);
  const filteredPlans = userPermissions.general.delete
    ? plans
    : plans.filter(item =>
        (userPermissions.creator?.delete && item.creator_id === userId) ||
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (userPermissions.assignee?.delete && (item as any).assignee_id === userId)
      );
  if (filteredPlans.length === 0) {
    throw new Error('No permission to delete');
  }
  await deletePlan(filteredPlans.map(item => item.id));
  revalidatePath('/[locale]/plan', 'page');
  redirect('/plan');
}

