import { Suspense } from 'react';
import Loading from '@/app/[locale]/loading';
import FormView from '@/components/product/FormView';
import { getProductDetailPageData } from '@/lib/product/getters';
import { ProductDetailPageProps } from '@/lib/product/types';
import { notFound } from 'next/navigation';

export default async function ViewProductPage({ params }: ProductDetailPageProps) {
  const { id } = await params;
  return (
    <Suspense fallback={<Loading />}>
      <ProductViewContent id={id} />
    </Suspense>
  );
}

async function ProductViewContent({ id }: { id: string }) {
  const { product, userPermissions } = await getProductDetailPageData(id);
  if (!product) {
    notFound();
  }
  return <FormView src={product} permissions={userPermissions} />;
}
