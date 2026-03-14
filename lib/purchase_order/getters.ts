'use server';

import prisma from '@/lib/prisma';
import type { PurchaseOrder, PurchaseOrderDetail } from '@/lib/purchase_order/types';
import { assertPermission, getModelPermissions, resolvePermissions, toPermissions } from '@/lib/authz';
import type { Operation } from '@/lib/authz';

export async function getAllPurchaseOrders(): Promise<PurchaseOrder[]> {
  const purchaseOrders = await prisma.purchase_order.findMany({
    include: { customer: true },
  });
  return purchaseOrders.map((purchaseOrder) => ({
    id: purchaseOrder.id,
    order_no: purchaseOrder.order_no,
    customer_id: purchaseOrder.customer_id,
    creator_id: purchaseOrder.creator_id,
    customer: purchaseOrder.customer,
  }));
}

export async function getPurchaseOrderDetail(id: string): Promise<PurchaseOrderDetail | null> {
  const purchaseOrder = await prisma.purchase_order.findUnique({
    where: {
      id,
    },
    include: {
      items: { include: { purchase_order: true, product: true } }, customer: true, creator: { select: { id: true, name: true } }, updater: { select: { id: true, name: true } }
    },
  });

  if (!purchaseOrder) {
    return null;
  }

  return {
    ...purchaseOrder,
    items: purchaseOrder.items,
    customer: purchaseOrder.customer,
  };
}

export async function getPurchaseOrderListPageData(isAssertPermission: boolean = true) {
  const [{ permissions: userPermissions, userId }, purchaseOrders] = await Promise.all([
    getModelPermissions('purchase_order'),
    getAllPurchaseOrders(),
  ]);
  if (isAssertPermission) {
    await assertPermission(userPermissions, 'read', 'purchase_order');
  }
  // If the user lacks general read but has Creator/Assignee read, filter to their own items.
  const filteredPurchaseOrders = userPermissions.general.read
    ? purchaseOrders
    : purchaseOrders.filter(item =>
        (userPermissions.creator?.read && item.creator_id === userId) ||
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (userPermissions.assignee?.read && (item as any).assignee_id === userId)
      );
  return { purchaseOrders: filteredPurchaseOrders, userPermissions: await toPermissions(userPermissions) };
}

export async function getPurchaseOrderDetailPageData(id: string, operation: Operation = 'read') {
  const [purchaseOrder, { permissions: basePermissions, userId }] = await Promise.all([
    getPurchaseOrderDetail(id),
    getModelPermissions('purchase_order'),
  ]);
  const resolved = await resolvePermissions(basePermissions, purchaseOrder, userId ?? '');
  await assertPermission(resolved, operation, 'purchase_order');
  return { purchaseOrder, userPermissions: await toPermissions(resolved) };
}

export async function getPurchaseOrderNewPageAccessCheck() {
  const { permissions: richPermissions } = await getModelPermissions('purchase_order');
  await assertPermission(richPermissions.general, 'create', 'purchase_order');
  return richPermissions.general;
}
