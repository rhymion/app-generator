// GENERATED ONCE — safe to edit (will not be overwritten on regeneration)
import type { PrismaClient } from '@/app/generated/prisma/client';

type Tx = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

/**
 * Called before dashboard is deleted, inside the same Prisma transaction
 * as the delete itself -- the pre-delete convergence point, symmetric to
 * validateCustomRules() on the create/update side (service_validation_
 * custom.ts). Customize this function to reject a delete by throwing.
 *
 * Throwing here rolls back the transaction -- deleteDashboard()
 * awaits this call from inside its own prisma.$transaction() callback,
 * before the row is removed, so an uncaught error prevents the delete
 * entirely (nothing has been written yet at this point).
 *
 * Default (unedited) stub is a no-op -- mirrors validateCustomRules's own
 * default (never rejects by default).
 *
 * @param _tx - Prisma transaction client
 * @param _entityId - ID of the dashboard about to be deleted
 * @param _prevRow - the full row as it stood immediately before this delete
 */
export async function validateOnDelete(
  _tx: Tx,
  _entityId: string,
  _prevRow: Record<string, unknown>,
): Promise<void> {
  // TODO: implement pre-delete validation here
}
