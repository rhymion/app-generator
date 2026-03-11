'use server';

import prisma from '@/lib/prisma';
import type { Inventory, InventoryDetail } from '@/lib/inventory/types';
import type { ModelPermissions } from '@/lib/authz';
import { assertPermission, getModelPermissions } from '@/lib/authz';
import type { Operation } from '@/lib/authz';
import { getServerSession } from 'next-auth/next';

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
    product: inventory.product,
  }));
}

export async function getInventoryDetail(id: string): Promise<InventoryDetail | null> {
  const inventory = await prisma.inventory.findUnique({
    where: {
      id,
    },
    include: {
      product: true, creator: { select: { id: true, name: true } }, updater: { select: { id: true, name: true } }
    },
  });

  if (!inventory) {
    return null;
  }

  return {
    ...inventory,
    product: inventory.product,
  };
}

export async function getInventoryListPageData(isAssertPermission: boolean = true) {
  const userPermissions = await getModelPermissions('inventory');
  if (isAssertPermission) {
    await assertPermission(userPermissions, 'read', 'inventory');
  }
  const inventorys = await getAllInventorys();
  return { inventorys, userPermissions };
}

export async function getInventoryDetailPageData(id: string, operation: Operation = 'read') {
  const inventory = await getInventoryDetail(id);
  const userPermissions = await getModelPermissions('inventory', undefined, inventory);
  await assertPermission(userPermissions, operation, 'inventory');
  return { inventory, userPermissions };
}

export async function getInventoryNewPageAccessCheck() {
  const userPermissions = await getModelPermissions('inventory');
  await assertPermission(userPermissions, 'create', 'inventory');
  return userPermissions;
}
