'use server';

import { redirect } from 'next/navigation';
import { getSessionUserIdOrThrow, requirePermission, getModelPermissions } from '@/lib/authz';
import prisma from '@/lib/prisma';
import { addInventory, updateInventory, deleteInventory } from './service';
export async function upsertInventory(data: FormData) {
  const id = data.get('id') as string | null;
  const srcSnapshotRaw = data.get('__src_snapshot') as string | null;
  if (id) {
    const existing = await prisma.inventory.findUnique({ where: { id }, select: { id: true, creator_id: true } });
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
export async function removeInventory(ids: string[]) {
  const [{ permissions: userPermissions, userId }, inventorys] = await Promise.all([
    getModelPermissions('inventory'),
    await prisma.inventory.findMany({ where: { id: { in: ids } }, select: { id: true, creator_id: true } }),
  ]);
  const filteredInventorys = userPermissions.general.delete
    ? inventorys
    : inventorys.filter(item =>
        (userPermissions.creator?.delete && item.creator_id === userId) ||
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (userPermissions.assignee?.delete && (item as any).assignee_id === userId)
      );
  if (filteredInventorys.length === 0) {
    throw new Error('No permission to delete');
  }
  await deleteInventory(filteredInventorys.map(item => item.id));
  redirect('/inventory');
}

