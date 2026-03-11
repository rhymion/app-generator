import FormUpsert from '@/components/purchase_order/FormUpsert';
import { getUserAccountListPageData } from '@/lib/user_account/getters';
import { getProductListPageData } from '@/lib/product/getters';
import { getPurchaseOrderNewPageAccessCheck } from '@/lib/purchase_order/getters';

export default async function AddPurchaseOrderPage() {
  const userAccountsData = await getUserAccountListPageData(false);
  const productsData = await getProductListPageData(false);
  const userPermissions = await getPurchaseOrderNewPageAccessCheck();
  const src = {
    id: '',
    order_no: '',
    customer_id: '',
    items: [],
  };
  return <FormUpsert src={src} isEdit={false} permissions={userPermissions} allUserAccounts={userAccountsData.userAccounts} userAccountPermissions={userAccountsData.userPermissions} allProducts={productsData.products} productPermissions={productsData.userPermissions} />;
}
