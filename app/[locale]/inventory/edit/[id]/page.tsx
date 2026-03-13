import { Suspense } from 'react';
import Loading from '@/app/[locale]/loading';
import FormUpsert from '@/components/inventory/FormUpsert';
import { getInventoryDetailPageData } from '@/lib/inventory/getters';
import { getProductListPageData } from '@/lib/product/getters';
import { InventoryDetailPageProps } from '@/lib/inventory/types';
import { notFound } from 'next/navigation';

export default async function EditInventoryPage({ params }: InventoryDetailPageProps) {
  const { id } = await params;
  return (
    <Suspense fallback={<Loading />}>
      <InventoryEditContent id={id} />
    </Suspense>
  );
}

async function InventoryEditContent({ id }: { id: string }) {
  const [detail, productsData] = await Promise.all([
    getInventoryDetailPageData(id, 'update'),
    getProductListPageData(false),
  ]);
  if (!detail.inventory) {
    notFound();
  }
  return <FormUpsert src={detail.inventory} isEdit={true} permissions={detail.userPermissions} allProducts={productsData.products} productPermissions={productsData.userPermissions} />;
}
