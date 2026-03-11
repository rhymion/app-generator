'use server';

import prisma from '@/lib/prisma';
import type { Product, ProductDetail } from '@/lib/product/types';
import type { ModelPermissions } from '@/lib/authz';
import { assertPermission, getModelPermissions } from '@/lib/authz';
import type { Operation } from '@/lib/authz';
import { getServerSession } from 'next-auth/next';

export async function getAllProducts(): Promise<Product[]> {
  const products = await prisma.product.findMany({
  });
  return products.map((product) => ({
    id: product.id,
    code: product.code,
    name: product.name,
    price: product.price,
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
  const userPermissions = await getModelPermissions('product');
  if (isAssertPermission) {
    await assertPermission(userPermissions, 'read', 'product');
  }
  const products = await getAllProducts();
  return { products, userPermissions };
}

export async function getProductDetailPageData(id: string, operation: Operation = 'read') {
  const product = await getProductDetail(id);
  const userPermissions = await getModelPermissions('product', undefined, product);
  await assertPermission(userPermissions, operation, 'product');
  return { product, userPermissions };
}

export async function getProductNewPageAccessCheck() {
  const userPermissions = await getModelPermissions('product');
  await assertPermission(userPermissions, 'create', 'product');
  return userPermissions;
}
