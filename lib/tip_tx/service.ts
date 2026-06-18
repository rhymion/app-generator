import prisma from '@/lib/prisma';
import { normalizeValue, assertNotStale, type NormalizedSnapshot } from '@/lib/normalize';
import { validateOnAdd, validateOnUpdate } from './service_validation';
import { afterCreate } from './service_after_create';

type TransactionClient = Pick<typeof prisma, 'tip_tx'>;

function normalizeSnapshot(snapshot: Record<string, unknown> | null | undefined): NormalizedSnapshot {
  const safeSnapshot = (snapshot ?? {}) as Record<string, unknown>;
  return {
    id: String(safeSnapshot.id ?? ''),
    gross_amount: normalizeValue(safeSnapshot.gross_amount, 'number'),
    operator_fee: normalizeValue(safeSnapshot.operator_fee, 'number'),
    payment_fee: normalizeValue(safeSnapshot.payment_fee, 'number'),
    contract_split_id: normalizeValue(safeSnapshot.contract_split_id, 'string'),
    status: normalizeValue(safeSnapshot.status, 'number'),
    comment_id: normalizeValue(safeSnapshot.comment_id, 'string'),
  };
}

async function getCurrentSnapshot(tx: TransactionClient, id: string): Promise<NormalizedSnapshot | null> {
  const current = await tx.tip_tx.findUnique({
    where: { id }
  });

  if (!current) {
    return null;
  }

  return normalizeSnapshot(current as Record<string, unknown>);
}
export async function addTipTx(actorId: string, grossAmount: number, operatorFee: number, paymentFee: number, contractSplitId: string, status: number, commentId: string): Promise<{ id: string }> {
  const result = await prisma.$transaction(async (tx) => {
    await validateOnAdd(tx, {
      gross_amount: grossAmount,
      operator_fee: operatorFee,
      payment_fee: paymentFee,
      contract_split_id: contractSplitId,
      status: status,
      comment_id: commentId,
    });
    const created = await tx.tip_tx.create({
      data: {
        creator_id: actorId,
        updater_id: actorId,
        gross_amount: grossAmount,
        operator_fee: operatorFee,
        payment_fee: paymentFee,
        contract_split_id: contractSplitId,
        status: status,
        comment_id: commentId,
      },
    });
    await afterCreate(tx, created as Record<string, unknown>, {
      gross_amount: grossAmount,
      operator_fee: operatorFee,
      payment_fee: paymentFee,
      contract_split_id: contractSplitId,
      status: status,
      comment_id: commentId,
    });
    return { id: created.id };
  });
  return result;
}
export async function updateTipTx(actorId: string, id: string, grossAmount: number, operatorFee: number, paymentFee: number, contractSplitId: string, status: number, commentId: string, srcSnapshotRaw: string | null): Promise<void> {
  await prisma.$transaction(async (tx) => {
    if (srcSnapshotRaw) {
      await assertNotStale(srcSnapshotRaw, normalizeSnapshot, () => getCurrentSnapshot(tx, id));
    }
    await validateOnUpdate(tx, id, {
      gross_amount: grossAmount,
      operator_fee: operatorFee,
      payment_fee: paymentFee,
      contract_split_id: contractSplitId,
      status: status,
      comment_id: commentId,
    });
    await tx.tip_tx.update({
      where: { id },
      data: {
        updater_id: actorId,
        gross_amount: grossAmount,
        operator_fee: operatorFee,
        payment_fee: paymentFee,
        contract_split_id: contractSplitId,
        status: status,
        comment_id: commentId,
      },
    });
  });
}
export async function deleteTipTx(ids: string[]): Promise<void> {
  await prisma.tip_tx.deleteMany({ where: { id: { in: ids } } });
}
