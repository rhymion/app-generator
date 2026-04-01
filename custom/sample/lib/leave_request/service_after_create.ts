import type { PrismaClient } from '@/app/generated/prisma/client';

type Tx = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

export async function afterCreate(
  tx: unknown,
  created: Record<string, unknown>,
  _data: Record<string, unknown>,
): Promise<void> {
  const approvable = created.approvable as { id: string } | null | undefined;
  if (!approvable?.id) return;

  const db = tx as Tx;
  const flows = await db.approval_flow.findMany({
    where: { entity_name: 'leave_request' },
  });

  for (const flow of flows) {
    await db.approval_request.create({
      data: {
        approvable_id: approvable.id,
        approval_flow_id: flow.id,
        status: 0, // Pending
      },
    });
  }
}
