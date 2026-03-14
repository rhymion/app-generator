'use server';

import { redirect } from 'next/navigation';
import { getSessionUserIdOrThrow, requirePermission } from '@/lib/authz';
import prisma from '@/lib/prisma';
import { addPurchaseOrder, updatePurchaseOrder, deletePurchaseOrder } from './service';
export async function upsertPurchaseOrder(data: FormData) {
  const id = data.get('id') as string | null;
  const srcSnapshotRaw = data.get('__src_snapshot') as string | null;
  if (id) {
    const existing = await prisma.purchase_order.findUnique({ where: { id }, select: { creator_id: true } });
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
export async function removePurchaseOrder(data: FormData | string[]) {
  const ids = Array.isArray(data) ? data : [data.get('id') as string];
  const items = await prisma.purchase_order.findMany({ where: { id: { in: ids } }, select: { id: true, creator_id: true } });
  for (const item of items) {
    await requirePermission('purchase_order', 'delete', item);
  }
  await deletePurchaseOrder(ids);
  redirect('/purchase_order');
}

