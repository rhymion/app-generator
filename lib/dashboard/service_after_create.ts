// GENERATED ONCE — safe to edit (will not be overwritten on regeneration)
import type { PrismaClient } from '@/app/generated/prisma/client';

type Tx = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

/**
 * Called after dashboard is created, inside the same Prisma transaction
 * as the write itself. Customize this function to implement post-create
 * side effects.
 *
 * Throwing here rolls back the entire create — addDashboard()
 * awaits this call from inside its own prisma.$transaction() callback, so
 * an uncaught error propagates out and Prisma rolls back the transaction,
 * including the new dashboard row.
 *
 * @param _tx - Prisma transaction client
 * @param _entityId - ID of the newly created dashboard
 */
export async function afterCreate(
  _tx: Tx,
  _entityId: string,
): Promise<void> {
  // TODO: implement post-create effects here
}
