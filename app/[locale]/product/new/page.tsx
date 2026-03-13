import { Suspense } from 'react';
import FormSkeleton from '@/components/_standard/FormSkeleton';
import FormUpsert from '@/components/product/FormUpsert';
import { getProductNewPageAccessCheck } from '@/lib/product/getters';

export default function AddProductPage() {
  return (
    <Suspense fallback={<FormSkeleton />}>
      <ProductNewContent />
    </Suspense>
  );
}

async function ProductNewContent() {
  const userPermissions = await getProductNewPageAccessCheck();
  const src = {
    id: '',
    code: '',
    name: '',
    price: 0,
    images: [],
  };
  return <FormUpsert src={src} isEdit={false} permissions={userPermissions} />;
}
