'use server';

import { redirect } from 'next/navigation';
import { getSessionUserIdOrThrow, requirePermission } from '@/lib/authz';
import prisma from '@/lib/prisma';
import { addInventory, updateInventory, deleteInventory } from './service';
export async function upsertInventory(data: FormData) {
  const id = data.get('id') as string | null;
  const srcSnapshotRaw = data.get('__src_snapshot') as string | null;
  if (id) {
    const existing = await prisma.inventory.findUnique({ where: { id }, select: { creator_id: true } });
    await requirePermission('inventory', 'update', existing);
  } else {
    await requirePermission('inventory', 'create');
  }
  const productId = data.get('product_id') as string;
  const quantity = Number(data.get('quantity'));
  const reservedQuantity = Number(data.get('reserved_quantity'));
  const location = data.get('location') as string | null;
  const lotNumber = data.get('lot_number') as string | null;
  const expirationDateStr = data.get('expiration_date') as string | null;
  const expirationDate = expirationDateStr ? new Date(expirationDateStr) : null;
  const userId = await getSessionUserIdOrThrow();

  if (id) {
    await updateInventory(userId, id, productId, quantity, reservedQuantity, location, lotNumber, expirationDate, srcSnapshotRaw);
  } else {
    await addInventory(userId, productId, quantity, reservedQuantity, location, lotNumber, expirationDate);
  }

  redirect('/inventory');
}
export async function removeInventory(data: FormData | string[]) {
  const ids = Array.isArray(data) ? data : [data.get('id') as string];
  const items = await prisma.inventory.findMany({ where: { id: { in: ids } }, select: { id: true, creator_id: true } });
  for (const item of items) {
    await requirePermission('inventory', 'delete', item);
  }
  await deleteInventory(ids);
  redirect('/inventory');
}

