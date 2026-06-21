// GENERATED ONCE — safe to edit (will not be overwritten on regeneration)

import type { PrismaClient } from '@/app/generated/prisma/client';

type Tx = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

/**
 * Called after all approval requests for leave_request are approved.
 * Customize this function to implement post-approval side effects.
 *
 * @param tx - Prisma transaction client
 * @param entityId - ID of the approved leave_request
 * @param approvableId - ID of the approvable record
 * @param approvedByUserId - ID of the user who approved
 */
export async function afterApprove(
  tx: Tx,
  entityId: string,
  approvableId: string,
  approvedByUserId: string,
): Promise<void> {
  // TODO: implement post-approval effects here
}
