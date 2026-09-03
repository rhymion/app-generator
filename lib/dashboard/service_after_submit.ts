// GENERATED ONCE — safe to edit (will not be overwritten on regeneration)
import type { PrismaClient } from '@/app/generated/prisma/client';

type Tx = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

/**
 * Called after dashboard transitions into its x-approval.submit_on state
 * (or, with no submit_on declared, right after it is created and its
 * approval_request row(s) are opened), inside the same Prisma transaction
 * as that write. Fires exactly once per submit event, however it was
 * reached — an ordinary create, an ordinary edit crossing the submit_on
 * edge, or the standalone submit_for_approval action all funnel through the
 * same call site. Customize this function to implement post-submit side
 * effects.
 *
 * Throwing here rolls back the entire submit -- the caller awaits this call
 * from inside its own prisma.$transaction() callback, so an uncaught error
 * propagates out and Prisma rolls back the transaction, including the
 * approval_request row(s) just created.
 *
 * @param _tx - Prisma transaction client
 * @param _entityId - ID of the submitted dashboard
 * @param _approvableId - ID of the approvable record
 */
export async function afterSubmit(
  _tx: Tx,
  _entityId: string,
  _approvableId: string,
): Promise<void> {
  // TODO: implement post-submit effects here
}
