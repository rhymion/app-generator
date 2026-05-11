import type { PrismaClient } from '@/app/generated/prisma/client';
import { notifyApprovalRequestCreated } from '@/lib/_notifyApprovalRequest';

type Tx = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

export async function afterCreate(
  tx: unknown,
  created: Record<string, unknown>,
  _data: Record<string, unknown>,
): Promise<void> {
  const approvable = created.approvable as { id: string } | null | undefined;
  if (!approvable?.id) return;

  const creatorId = created.creator_id as string | null | undefined;
  const orgId = (created.organization_id as string | null | undefined) ?? null;
  const db = tx as Tx;

  // Fetch the creator's role IDs to check requestor_role_id gating
  let creatorRoleIds: string[] = [];
  if (creatorId) {
    const creator = await db.user_account.findUnique({
      where: { id: creatorId },
      select: { roles: { select: { id: true } } },
    });
    creatorRoleIds = creator?.roles.map((r) => r.id) ?? [];
  }

  const flows = await db.approval_flow.findMany({
    where: { entity_name: 'leave_request' },
  });

  let hasFlow = false;
  const createdRequestIds: string[] = [];
  for (const flow of flows) {
    // Skip role-gated flows when the creator doesn't have the requestor role
    if (flow.requestor_role_id && !creatorRoleIds.includes(flow.requestor_role_id)) {
      continue;
    }
    const req = await db.approval_request.create({
      data: {
        approvable_id: approvable.id,
        approval_flow_id: flow.id,
        status: 0, // Pending
      },
      select: { id: true },
    });
    createdRequestIds.push(req.id);
    hasFlow = true;
  }

  if (hasFlow && creatorId) {
    await db.approvable.update({
      where: { id: approvable.id },
      data: { creator_id: creatorId },
    });
  }

  // Trigger #2 (notification design 2026-05-11): notify each user who holds
  // the approver role for the newly-created approval_request, scoped to the
  // same organization when the entity has one.
  for (const reqId of createdRequestIds) {
    await notifyApprovalRequestCreated(db, reqId, {
      approvableId: approvable.id,
      entityLabel: 'Leave Request',
      orgId,
      excludeUserId: creatorId ?? null,
    });
  }
}
