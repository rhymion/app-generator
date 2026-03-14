'use server';

import prisma from '@/lib/prisma';
import type { Inventory, InventoryDetail } from '@/lib/inventory/types';
import { assertPermission, getModelPermissions, resolvePermissions, toPermissions } from '@/lib/authz';
import type { Operation } from '@/lib/authz';

export async function getAllInventorys(): Promise<Inventory[]> {
  const inventorys = await prisma.inventory.findMany({
    include: { product: true },
  });
  return inventorys.map((inventory) => ({
    id: inventory.id,
    product_id: inventory.product_id,
    quantity: inventory.quantity,
    reserved_quantity: inventory.reserved_quantity,
    location: inventory.location,
    lot_number: inventory.lot_number,
    expiration_date: inventory.expiration_date,
    creator_id: inventory.creator_id,
    product: inventory.product,
  }));
}

export async function getInventoryDetail(id: string): Promise<InventoryDetail | null> {
  const inventory = await prisma.inventory.findUnique({
    where: {
      id,
    },
    include: {
      product: true
    },
  });

  if (!inventory) {
    return null;
  }

  return {
    ...inventory,
  };
}

export async function getInventoryListPageData(isAssertPermission: boolean = true) {
  const [{ permissions: userPermissions, userId }, inventorys] = await Promise.all([
    getModelPermissions('inventory'),
    getAllInventorys(),
  ]);
  if (isAssertPermission) {
    await assertPermission(userPermissions, 'read', 'inventory');
  }
  // If the user lacks general read but has Creator/Assignee read, filter to their own items.
  const filteredInventorys = userPermissions.general.read
    ? inventorys
    : inventorys.filter(item =>
        (userPermissions.creator?.read && item.creator_id === userId) ||
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (userPermissions.assignee?.read && (item as any).assignee_id === userId)
      );
  return { inventorys: filteredInventorys, userPermissions: await toPermissions(userPermissions) };
}

export async function getInventoryDetailPageData(id: string, operation: Operation = 'read') {
  const [inventory, { permissions: basePermissions, userId }] = await Promise.all([
    getInventoryDetail(id),
    getModelPermissions('inventory'),
  ]);
  const resolved = await resolvePermissions(basePermissions, inventory, userId ?? '');
  await assertPermission(resolved, operation, 'inventory');
  return { inventory, userPermissions: await toPermissions(resolved) };
}

export async function getInventoryNewPageAccessCheck() {
  const { permissions: richPermissions } = await getModelPermissions('inventory');
  await assertPermission(richPermissions.general, 'create', 'inventory');
  return richPermissions.general;
}
