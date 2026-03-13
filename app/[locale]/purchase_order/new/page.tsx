import { Suspense } from 'react';
import FormSkeleton from '@/components/_standard/FormSkeleton';
import FormUpsert from '@/components/purchase_order/FormUpsert';
import { getUserAccountListPageData } from '@/lib/user_account/getters';
import { getProductListPageData } from '@/lib/product/getters';
import { getPurchaseOrderNewPageAccessCheck } from '@/lib/purchase_order/getters';

export default function AddPurchaseOrderPage() {
  return (
    <Suspense fallback={<FormSkeleton />}>
      <PurchaseOrderNewContent />
    </Suspense>
  );
}

async function PurchaseOrderNewContent() {
  const [userPermissions, userAccountsData, productsData] = await Promise.all([
    getPurchaseOrderNewPageAccessCheck(),
    getUserAccountListPageData(false),
    getProductListPageData(false),
  ]);
  const src = {
    id: '',
    order_no: '',
    customer_id: '',
    items: [],
  };
  return <FormUpsert src={src} isEdit={false} permissions={userPermissions} allUserAccounts={userAccountsData.userAccounts} userAccountPermissions={userAccountsData.userPermissions} allProducts={productsData.products} productPermissions={productsData.userPermissions} />;
}
