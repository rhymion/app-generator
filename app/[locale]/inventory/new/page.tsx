import FormUpsert from '@/components/inventory/FormUpsert';
import { getProductListPageData } from '@/lib/product/getters';
import { getInventoryNewPageAccessCheck } from '@/lib/inventory/getters';

export default async function AddInventoryPage() {
  const productsData = await getProductListPageData(false);
  const userPermissions = await getInventoryNewPageAccessCheck();
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
