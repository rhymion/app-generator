import prisma from '@/lib/prisma';
import { normalizeValue, normalizeChildRefs, assertNotStale, type NormalizedSnapshot } from '@/lib/normalize';
import { validateOnAdd, validateOnUpdate } from './service_validation';

type TransactionClient = Pick<typeof prisma, 'purchase_order'>;

function normalizeSnapshot(snapshot: Record<string, unknown> | null | undefined): NormalizedSnapshot {
  const safeSnapshot = (snapshot ?? {}) as Record<string, unknown>;
  return {
    id: String(safeSnapshot.id ?? ''),
    order_no: normalizeValue(safeSnapshot.order_no, 'string'),
    customer_id: normalizeValue(safeSnapshot.customer_id, 'string'),
    items: normalizeChildRefs(safeSnapshot.items),
  };
}

async function getCurrentSnapshot(tx: TransactionClient, id: string): Promise<NormalizedSnapshot | null> {
  const current = await tx.purchase_order.findUnique({
    where: { id },
    include: {
      items: { select: { id: true } }
    }
  });

  if (!current) {
    return null;
  }

  return normalizeSnapshot(current as Record<string, unknown>);
}
export async function addPurchaseOrder(userId: string, orderNo: string, customerId: string, itemsItems: { product_id: string; quantity: number; price: number | null }[]): Promise<{ id: string }> {
  return await prisma.$transaction(async (tx) => {
    await validateOnAdd(tx, {
      order_no: orderNo,
      customer_id: customerId,
    });
    const created = await tx.purchase_order.create({
      data: {
        creator_id: userId,
        updater_id: userId,
        order_no: orderNo,
        customer_id: customerId,
      items: {
        create: itemsItems.map(f => ({
          product_id: f.product_id,
          quantity: f.quantity,
          price: f.price,
        })),
      },
      },
    });
    return { id: created.id };
  });
}
export async function updatePurchaseOrder(userId: string, id: string, orderNo: string, customerId: string, itemsItems: { product_id: string; quantity: number; price: number | null }[], srcSnapshotRaw: string | null): Promise<void> {
  await prisma.$transaction(async (tx) => {
    if (srcSnapshotRaw) {
      await assertNotStale(srcSnapshotRaw, normalizeSnapshot, () => getCurrentSnapshot(tx, id));
    }
    await validateOnUpdate(tx, id, {
      order_no: orderNo,
      customer_id: customerId,
    });
    await tx.purchase_order.update({
      where: { id },
      data: {
        updater_id: userId,
        order_no: orderNo,
        customer_id: customerId,
      items: {
        deleteMany: {},
        create: itemsItems.map(f => ({
          product_id: f.product_id,
          quantity: f.quantity,
          price: f.price,
        })),
      },
      },
    });
  });
}
export async function deletePurchaseOrder(ids: string[]): Promise<void> {
  await prisma.purchase_order.deleteMany({ where: { id: { in: ids } } });
}
