'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { getSessionUserIdOrThrow, requirePermission, getModelPermissions } from '@/lib/authz';
import prisma from '@/lib/prisma';
import { addTipTx, updateTipTx, deleteTipTx } from './service';
export async function upsertTipTx(data: FormData) {
  const id = data.get('id') as string | null;
  const srcSnapshotRaw = data.get('__src_snapshot') as string | null;
  if (id) {
    const existing = await prisma.tip_tx.findUnique({ where: { id }, select: { id: true, creator_id: true } });
    await requirePermission('tip_tx', 'update', existing);
  } else {
    await requirePermission('tip_tx', 'create');
  }
  const grossAmount = Number(data.get('gross_amount'));
  const operatorFee = Number(data.get('operator_fee'));
  const paymentFee = Number(data.get('payment_fee'));
  const contractSplitId = data.get('contract_split_id') as string;
  const status = Number(data.get('status'));
  const commentId = data.get('comment_id') as string;
  const actorId = await getSessionUserIdOrThrow();

  if (id) {
    await updateTipTx(actorId, id, grossAmount, operatorFee, paymentFee, contractSplitId, status, commentId, srcSnapshotRaw);
  } else {
    await addTipTx(actorId, grossAmount, operatorFee, paymentFee, contractSplitId, status, commentId);
  }

  redirect('/tip_tx');
}
export async function removeTipTx(ids: string[]) {
  const [{ permissions: userPermissions, userId }, tipTxs] = await Promise.all([
    getModelPermissions('tip_tx'),
    await prisma.tip_tx.findMany({ where: { id: { in: ids } }, select: { id: true, creator_id: true } }),
  ]);
  const filteredTipTxs = userPermissions.general.delete
    ? tipTxs
    : tipTxs.filter(item =>
        (userPermissions.creator?.delete && item.creator_id === userId) ||
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (userPermissions.assignee?.delete && (item as any).assignee_id === userId)
      );
  if (filteredTipTxs.length === 0) {
    throw new Error('No permission to delete');
  }
  await deleteTipTx(filteredTipTxs.map(item => item.id));
  revalidatePath('/[locale]/tip_tx', 'page');
  redirect('/tip_tx');
}

