import prisma from '@/lib/prisma';
import { normalizeValue, normalizeChildRefs, assertNotStale, type NormalizedSnapshot } from '@/lib/normalize';
import { validateOnAdd, validateOnUpdate } from './service_validation';

type TransactionClient = Pick<typeof prisma, 'product'>;

function normalizeSnapshot(snapshot: Record<string, unknown> | null | undefined): NormalizedSnapshot {
  const safeSnapshot = (snapshot ?? {}) as Record<string, unknown>;
  return {
    id: String(safeSnapshot.id ?? ''),
    code: normalizeValue(safeSnapshot.code, 'string'),
    name: normalizeValue(safeSnapshot.name, 'string'),
    price: normalizeValue(safeSnapshot.price, 'number'),
    images: normalizeChildRefs(safeSnapshot.images),
  };
}

async function getCurrentSnapshot(tx: TransactionClient, id: string): Promise<NormalizedSnapshot | null> {
  const current = await tx.product.findUnique({
    where: { id },
    include: {
      images: { select: { id: true } }
    }
  });

  if (!current) {
    return null;
  }

  return normalizeSnapshot(current as Record<string, unknown>);
}
export async function addProduct(userId: string, code: string, name: string, price: number, imagesItems: { name: string; path: string }[]): Promise<{ id: string }> {
  return await prisma.$transaction(async (tx) => {
    await validateOnAdd(tx, {
      code: code,
      name: name,
      price: price,
    });
    const created = await tx.product.create({
      data: {
        creator_id: userId,
        updater_id: userId,
        code: code,
        name: name,
        price: price,
      images: {
        create: imagesItems.map(f => ({
          name: f.name,
          path: f.path,
        })),
      },
      },
    });
    return { id: created.id };
  });
}
export async function updateProduct(userId: string, id: string, code: string, name: string, price: number, imagesItems: { name: string; path: string }[], srcSnapshotRaw: string | null): Promise<void> {
  await prisma.$transaction(async (tx) => {
    if (srcSnapshotRaw) {
      await assertNotStale(srcSnapshotRaw, normalizeSnapshot, () => getCurrentSnapshot(tx, id));
    }
    await validateOnUpdate(tx, id, {
      code: code,
      name: name,
      price: price,
    });
    await tx.product.update({
      where: { id },
      data: {
        updater_id: userId,
        code: code,
        name: name,
        price: price,
      images: {
        deleteMany: {},
        create: imagesItems.map(f => ({
          name: f.name,
          path: f.path,
        })),
      },
      },
    });
  });
}
export async function deleteProduct(ids: string[]): Promise<void> {
  await prisma.product.deleteMany({ where: { id: { in: ids } } });
}
