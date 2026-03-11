import FormView from '@/components/product/FormView';
import { getProductDetailPageData } from '@/lib/product/getters';
import { ProductDetailPageProps } from '@/lib/product/types';
import { notFound } from 'next/navigation';

export default async function ViewProductPage({ params }: ProductDetailPageProps) {
  const { id } = await params;
  const { product, userPermissions } = await getProductDetailPageData(id);
  if (!product) {
    notFound();
  }
  return <FormView src={product} permissions={userPermissions} />;
}
