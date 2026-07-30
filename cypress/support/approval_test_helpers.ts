import { prisma } from './db-helpers';

/**
 * Generic approval/ledger read helpers shared by B-5 Phase2c D7 tests
 * (purchase_per_item reservation cancel + receiving_receipt_line terminal
 * reject no-op). Kept entity-agnostic so both domains reuse the same tasks.
 */

export async function getApprovableById(approvable_id: string) {
  const approvable = await prisma.approvable.findUnique({ where: { id: approvable_id } });
  return approvable ? JSON.parse(JSON.stringify(approvable)) : null;
}

export async function getPendingApprovalRequest(approvable_id: string) {
  const ar = await prisma.approval_request.findFirst({
    where: { approvable_id, status: 'pending' },
  });
  return ar ? JSON.parse(JSON.stringify(ar)) : null;
}
