import type { PrismaClient } from '@/app/generated/prisma/client';

type Tx = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

export async function afterCreate(
  tx: unknown,
  created: Record<string, unknown>,
  _data: Record<string, unknown>,
): Promise<void> {
  const approvable = created.approvable as { id: string } | null | undefined;
  if (!approvable?.id) return;

  const creatorId = created.creator_id as string | null | undefined;
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
  for (const flow of flows) {
    // Skip role-gated flows when the creator doesn't have the requestor role
    if (flow.requestor_role_id && !creatorRoleIds.includes(flow.requestor_role_id)) {
      continue;
    }
    await db.approval_request.create({
      data: {
        approvable_id: approvable.id,
        approval_flow_id: flow.id,
        status: 0, // Pending
      },
    });
    hasFlow = true;
  }

  if (hasFlow && creatorId) {
    await db.approvable.update({
      where: { id: approvable.id },
      data: { creator_id: creatorId },
    });
  }
}
