'use server';

import prisma from '@/lib/prisma';
import type { PurchaseOrder, PurchaseOrderDetail } from '@/lib/purchase_order/types';
import type { ModelPermissions } from '@/lib/authz';
import { assertPermission, getModelPermissions } from '@/lib/authz';
import type { Operation } from '@/lib/authz';
import { getServerSession } from 'next-auth/next';

export async function getAllPurchaseOrders(): Promise<PurchaseOrder[]> {
  const purchaseOrders = await prisma.purchase_order.findMany({
    include: { customer: true },
  });
  return purchaseOrders.map((purchaseOrder) => ({
    id: purchaseOrder.id,
    order_no: purchaseOrder.order_no,
    customer_id: purchaseOrder.customer_id,
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
  const [userPermissions, purchaseOrders] = await Promise.all([
    getModelPermissions('purchase_order'),
    getAllPurchaseOrders(),
  ]);
  if (isAssertPermission) {
    await assertPermission(userPermissions, 'read', 'purchase_order');
  }
  return { purchaseOrders, userPermissions };
}

export async function getPurchaseOrderDetailPageData(id: string, operation: Operation = 'read') {
  const purchaseOrder = await getPurchaseOrderDetail(id);
  const userPermissions = await getModelPermissions('purchase_order', undefined, purchaseOrder);
  await assertPermission(userPermissions, operation, 'purchase_order');
  return { purchaseOrder, userPermissions };
}

export async function getPurchaseOrderNewPageAccessCheck() {
  const userPermissions = await getModelPermissions('purchase_order');
  await assertPermission(userPermissions, 'create', 'purchase_order');
  return userPermissions;
}
