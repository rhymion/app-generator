import { Suspense } from 'react';
import Loading from '@/app/[locale]/loading';
import FormUpsert from '@/components/product/FormUpsert';
import { getProductDetailPageData } from '@/lib/product/getters';
import { ProductDetailPageProps } from '@/lib/product/types';
import { notFound } from 'next/navigation';

export default async function EditProductPage({ params }: ProductDetailPageProps) {
  const { id } = await params;
  return (
    <Suspense fallback={<Loading />}>
      <ProductEditContent id={id} />
    </Suspense>
  );
}

async function ProductEditContent({ id }: { id: string }) {
  const detail = await getProductDetailPageData(id, 'update');
  if (!detail.product) {
    notFound();
  }
  return <FormUpsert src={detail.product} isEdit={true} permissions={detail.userPermissions} />;
}
