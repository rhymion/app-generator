import FormUpsert from '@/components/product/FormUpsert';
import { getProductDetailPageData } from '@/lib/product/getters';
import { ProductDetailPageProps } from '@/lib/product/types';
import { notFound } from 'next/navigation';

export default async function EditProductPage({ params }: ProductDetailPageProps) {
  const { id } = await params;
  const detail = await getProductDetailPageData(id, 'update');
  if (!detail.product) {
    notFound();
  }
  return <FormUpsert src={detail.product} isEdit={true} permissions={detail.userPermissions} />;
}
