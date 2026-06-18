import prisma from '@/lib/prisma';
import { normalizeValue, normalizeChildRefs, assertNotStale, type NormalizedSnapshot } from '@/lib/normalize';
import { validateOnAdd, validateOnUpdate } from './service_validation';
import { afterCreate } from './service_after_create';

type TransactionClient = Pick<typeof prisma, 'plan'>;

function normalizeSnapshot(snapshot: Record<string, unknown> | null | undefined): NormalizedSnapshot {
  const safeSnapshot = (snapshot ?? {}) as Record<string, unknown>;
  return {
    id: String(safeSnapshot.id ?? ''),
    tier: normalizeValue(safeSnapshot.tier, 'number'),
    reaction_kinds_allowed: normalizeValue(safeSnapshot.reaction_kinds_allowed, 'number'),
    sub_account_limit: normalizeValue(safeSnapshot.sub_account_limit, 'number'),
    can_view_paid_posts: normalizeValue(safeSnapshot.can_view_paid_posts, 'boolean'),
    users: normalizeChildRefs(safeSnapshot.users),
  };
}

async function getCurrentSnapshot(tx: TransactionClient, id: string): Promise<NormalizedSnapshot | null> {
  const current = await tx.plan.findUnique({
    where: { id },
    include: {
      users: { select: { id: true } }
    }
  });

  if (!current) {
    return null;
  }

  return normalizeSnapshot(current as Record<string, unknown>);
}
export async function addPlan(actorId: string, tier: number, reactionKindsAllowed: number, subAccountLimit: number, canViewPaidPosts: boolean, usersIds: string[]): Promise<{ id: string }> {
  const result = await prisma.$transaction(async (tx) => {
    await validateOnAdd(tx, {
      tier: tier,
      reaction_kinds_allowed: reactionKindsAllowed,
      sub_account_limit: subAccountLimit,
      can_view_paid_posts: canViewPaidPosts,
    });
    const created = await tx.plan.create({
      data: {
        creator_id: actorId,
        updater_id: actorId,
        tier: tier,
        reaction_kinds_allowed: reactionKindsAllowed,
        sub_account_limit: subAccountLimit,
        can_view_paid_posts: canViewPaidPosts,
      users: {
        connect: usersIds.map((id) => ({ id })),
      },
      },
    });
    await afterCreate(tx, created as Record<string, unknown>, {
      tier: tier,
      reaction_kinds_allowed: reactionKindsAllowed,
      sub_account_limit: subAccountLimit,
      can_view_paid_posts: canViewPaidPosts,
    });
    return { id: created.id };
  });
  return result;
}
export async function updatePlan(actorId: string, id: string, tier: number, reactionKindsAllowed: number, subAccountLimit: number, canViewPaidPosts: boolean, usersIds: string[], srcSnapshotRaw: string | null): Promise<void> {
  await prisma.$transaction(async (tx) => {
    if (srcSnapshotRaw) {
      await assertNotStale(srcSnapshotRaw, normalizeSnapshot, () => getCurrentSnapshot(tx, id));
    }
    await validateOnUpdate(tx, id, {
      tier: tier,
      reaction_kinds_allowed: reactionKindsAllowed,
      sub_account_limit: subAccountLimit,
      can_view_paid_posts: canViewPaidPosts,
    });
    await tx.plan.update({
      where: { id },
      data: {
        updater_id: actorId,
        tier: tier,
        reaction_kinds_allowed: reactionKindsAllowed,
        sub_account_limit: subAccountLimit,
        can_view_paid_posts: canViewPaidPosts,
      users: {
        set: usersIds.map((id) => ({ id })),
      },
      },
    });
  });
}
export async function deletePlan(ids: string[]): Promise<void> {
  await prisma.plan.deleteMany({ where: { id: { in: ids } } });
}
