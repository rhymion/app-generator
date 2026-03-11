import FormUpsert from '@/components/purchase_order/FormUpsert';
import { getPurchaseOrderDetailPageData } from '@/lib/purchase_order/getters';
import { getUserAccountListPageData } from '@/lib/user_account/getters';
import { getPurchaseOrderListPageData } from '@/lib/purchase_order/getters';
import { getProductListPageData } from '@/lib/product/getters';
import { PurchaseOrderDetailPageProps } from '@/lib/purchase_order/types';
import { notFound } from 'next/navigation';

export default async function EditPurchaseOrderPage({ params }: PurchaseOrderDetailPageProps) {
  const { id } = await params;
  const [detail, userAccountsData, purchaseOrdersData, productsData] = await Promise.all([
    getPurchaseOrderDetailPageData(id, 'update'),
    getUserAccountListPageData(false),
    getPurchaseOrderListPageData(false),
    getProductListPageData(false),
  ]);
  if (!detail.purchaseOrder) {
    notFound();
  }
  return <FormUpsert src={detail.purchaseOrder} isEdit={true} permissions={detail.userPermissions} allUserAccounts={userAccountsData.userAccounts} userAccountPermissions={userAccountsData.userPermissions} allPurchaseOrders={purchaseOrdersData.purchaseOrders} purchaseOrderPermissions={purchaseOrdersData.userPermissions} allProducts={productsData.products} productPermissions={productsData.userPermissions} />;
}
