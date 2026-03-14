'use server';

import { redirect } from 'next/navigation';
import { getSessionUserIdOrThrow, requirePermission } from '@/lib/authz';
import prisma from '@/lib/prisma';
import { addProduct, updateProduct, deleteProduct } from './service';
export async function upsertProduct(data: FormData) {
  const id = data.get('id') as string | null;
  const srcSnapshotRaw = data.get('__src_snapshot') as string | null;
  if (id) {
    const existing = await prisma.product.findUnique({ where: { id }, select: { creator_id: true } });
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
export async function removeProduct(data: FormData | string[]) {
  const ids = Array.isArray(data) ? data : [data.get('id') as string];
  const items = await prisma.product.findMany({ where: { id: { in: ids } }, select: { id: true, creator_id: true } });
  for (const item of items) {
    await requirePermission('product', 'delete', item);
  }
  await deleteProduct(ids);
  redirect('/product');
}

