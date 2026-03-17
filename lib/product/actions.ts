'use server';

import { redirect } from 'next/navigation';
import { getSessionUserIdOrThrow, requirePermission, getModelPermissions } from '@/lib/authz';
import prisma from '@/lib/prisma';
import { addProduct, updateProduct, deleteProduct } from './service';
export async function upsertProduct(data: FormData) {
  const id = data.get('id') as string | null;
  const srcSnapshotRaw = data.get('__src_snapshot') as string | null;
  if (id) {
    const existing = await prisma.product.findUnique({ where: { id }, select: { id: true, creator_id: true } });
    await requirePermission('product', 'update', existing);
  } else {
    await requirePermission('product', 'create');
  }
  const code = data.get('code') as string;
  const name = data.get('name') as string;
  const price = Number(data.get('price'));
  const imagesRaw = data.getAll('image[]') as string[];
  const imagesItems = imagesRaw.map(f => JSON.parse(f) as { name: string; path: string });
  const userId = await getSessionUserIdOrThrow();

  if (id) {
    await updateProduct(userId, id, code, name, price, imagesItems, srcSnapshotRaw);
  } else {
    await addProduct(userId, code, name, price, imagesItems);
  }

  redirect('/product');
}
export async function removeProduct(ids: string[]) {
  const [{ permissions: userPermissions, userId }, products] = await Promise.all([
    getModelPermissions('product'),
    await prisma.product.findMany({ where: { id: { in: ids } }, select: { id: true, creator_id: true } }),
  ]);
  const filteredProducts = userPermissions.general.delete
    ? products
    : products.filter(item =>
        (userPermissions.creator?.delete && item.creator_id === userId) ||
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (userPermissions.assignee?.delete && (item as any).assignee_id === userId)
      );
  if (filteredProducts.length === 0) {
    throw new Error('No permission to delete');
  }
  await deleteProduct(filteredProducts.map(item => item.id));
  redirect('/product');
}

