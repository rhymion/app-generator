'use server';

import prisma from '@/lib/prisma';
import type { Product, ProductDetail } from '@/lib/product/types';
import { assertPermission, getModelPermissions, resolvePermissions, toPermissions } from '@/lib/authz';
import type { Operation } from '@/lib/authz';

export async function getAllProducts(): Promise<Product[]> {
  const products = await prisma.product.findMany({
  });
  return products.map((product) => ({
    id: product.id,
    code: product.code,
    name: product.name,
    price: product.price,
    creator_id: product.creator_id,
  }));
}

export async function getProductDetail(id: string): Promise<ProductDetail | null> {
  const product = await prisma.product.findUnique({
    where: {
      id,
    },
    include: {
      images: true, creator: { select: { id: true, name: true } }, updater: { select: { id: true, name: true } }
    },
  });

  if (!product) {
    return null;
  }

  return {
    ...product,
    images: product.images,
  };
}

export async function getProductListPageData(isAssertPermission: boolean = true) {
  const [{ permissions: userPermissions, userId }, products] = await Promise.all([
    getModelPermissions('product'),
    getAllProducts(),
  ]);
  if (isAssertPermission) {
    await assertPermission(userPermissions, 'read', 'product');
  }
  // If the user lacks general read but has Creator/Assignee read, filter to their own items.
  const filteredProducts = userPermissions.general.read
    ? products
    : products.filter(item =>
        (userPermissions.creator?.read && item.creator_id === userId) ||
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (userPermissions.assignee?.read && (item as any).assignee_id === userId)
      );
  return { products: filteredProducts, userPermissions: await toPermissions(userPermissions) };
}

export async function getProductDetailPageData(id: string, operation: Operation = 'read') {
  const [product, { permissions: basePermissions, userId }] = await Promise.all([
    getProductDetail(id),
    getModelPermissions('product'),
  ]);
  const resolved = await resolvePermissions(basePermissions, product, userId ?? '');
  await assertPermission(resolved, operation, 'product');
  return { product, userPermissions: await toPermissions(resolved) };
}

export async function getProductNewPageAccessCheck() {
  const { permissions: richPermissions } = await getModelPermissions('product');
  await assertPermission(richPermissions.general, 'create', 'product');
  return richPermissions.general;
}
