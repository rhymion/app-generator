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
    where: { approvable_id, status: 0 },
  });
  return ar ? JSON.parse(JSON.stringify(ar)) : null;
}

export async function getInventoryTransactionsByBridge(inventory_transactionable_id: string) {
  const txs = await prisma.inventory_transaction.findMany({
    where: { inventory_transactionable_id },
    orderBy: { created_at: 'asc' },
  });
  return JSON.parse(JSON.stringify(txs));
}

export async function countAllInventoryTransactions() {
  return prisma.inventory_transaction.count();
}
