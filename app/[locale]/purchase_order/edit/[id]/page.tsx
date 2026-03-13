import { Suspense } from 'react';
import FormSkeleton from '@/components/_standard/FormSkeleton';
import FormUpsert from '@/components/purchase_order/FormUpsert';
import { getPurchaseOrderDetailPageData } from '@/lib/purchase_order/getters';
import { getUserAccountListPageData } from '@/lib/user_account/getters';
import { getProductListPageData } from '@/lib/product/getters';
import { PurchaseOrderDetailPageProps } from '@/lib/purchase_order/types';
import { notFound } from 'next/navigation';

export default async function EditPurchaseOrderPage({ params }: PurchaseOrderDetailPageProps) {
  const { id } = await params;
  return (
    <Suspense fallback={<FormSkeleton />}>
      <PurchaseOrderEditContent id={id} />
    </Suspense>
  );
}

async function PurchaseOrderEditContent({ id }: { id: string }) {
  const [detail, userAccountsData, productsData] = await Promise.all([
    getPurchaseOrderDetailPageData(id, 'update'),
    getUserAccountListPageData(false),
    getProductListPageData(false),
  ]);
  if (!detail.purchaseOrder) {
    notFound();
  }
  return <FormUpsert src={detail.purchaseOrder} isEdit={true} permissions={detail.userPermissions} allUserAccounts={userAccountsData.userAccounts} userAccountPermissions={userAccountsData.userPermissions} allProducts={productsData.products} productPermissions={productsData.userPermissions} />;
}
