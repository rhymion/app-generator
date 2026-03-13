import { Suspense } from 'react';
import Loading from '@/app/[locale]/loading';
import FormUpsert from '@/components/inventory/FormUpsert';
import { getProductListPageData } from '@/lib/product/getters';
import { getInventoryNewPageAccessCheck } from '@/lib/inventory/getters';

export default function AddInventoryPage() {
  return (
    <Suspense fallback={<Loading />}>
      <InventoryNewContent />
    </Suspense>
  );
}

async function InventoryNewContent() {
  const [userPermissions, productsData] = await Promise.all([
    getInventoryNewPageAccessCheck(),
    getProductListPageData(false),
  ]);
  const src = {
    id: '',
    product_id: '',
    quantity: 0,
    reserved_quantity: 0,
    location: '',
    lot_number: '',
    expiration_date: null,
  };
  return <FormUpsert src={src} isEdit={false} permissions={userPermissions} allProducts={productsData.products} productPermissions={productsData.userPermissions} />;
}
