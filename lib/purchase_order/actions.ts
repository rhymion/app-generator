'use server';

import { redirect } from 'next/navigation';
import { getSessionUserIdOrThrow, requirePermission, getModelPermissions } from '@/lib/authz';
import prisma from '@/lib/prisma';
import { addPurchaseOrder, updatePurchaseOrder, deletePurchaseOrder } from './service';
export async function upsertPurchaseOrder(data: FormData) {
  const id = data.get('id') as string | null;
  const srcSnapshotRaw = data.get('__src_snapshot') as string | null;
  if (id) {
    const existing = await prisma.purchase_order.findUnique({ where: { id }, select: { id: true, creator_id: true } });
    await requirePermission('purchase_order', 'update', existing);
  } else {
    await requirePermission('purchase_order', 'create');
  }
  const orderNo = data.get('order_no') as string;
  const customerId = data.get('customer_id') as string;
  const itemsRaw = data.getAll('item[]') as string[];
  const itemsItems = itemsRaw.map(f => JSON.parse(f) as { product_id: string; quantity: number; price: number | null });
  const userId = await getSessionUserIdOrThrow();

  if (id) {
    await updatePurchaseOrder(userId, id, orderNo, customerId, itemsItems, srcSnapshotRaw);
  } else {
    await addPurchaseOrder(userId, orderNo, customerId, itemsItems);
  }

  redirect('/purchase_order');
}
export async function removePurchaseOrder(ids: string[]) {
  const [{ permissions: userPermissions, userId }, purchaseOrders] = await Promise.all([
    getModelPermissions('purchase_order'),
    await prisma.purchase_order.findMany({ where: { id: { in: ids } }, select: { id: true, creator_id: true } }),
  ]);
  const filteredPurchaseOrders = userPermissions.general.delete
    ? purchaseOrders
    : purchaseOrders.filter(item =>
        (userPermissions.creator?.delete && item.creator_id === userId) ||
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (userPermissions.assignee?.delete && (item as any).assignee_id === userId)
      );
  if (filteredPurchaseOrders.length === 0) {
    throw new Error('No permission to delete');
  }
  await deletePurchaseOrder(filteredPurchaseOrders.map(item => item.id));
  redirect('/purchase_order');
}

