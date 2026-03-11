import { getTranslations } from 'next-intl/server';
import ResponsiveListClient from '@/components/_standard/ResponsiveListClient';
import { getPurchaseOrderListPageData } from '@/lib/purchase_order/getters';
import { removePurchaseOrder } from '@/lib/purchase_order/actions';

export default async function PurchaseOrderListPage() {
  const [t, tf] = await Promise.all([
    getTranslations('EntityLabel'),
    getTranslations('Fields'),
  ]);
  const { purchaseOrders, userPermissions } = await getPurchaseOrderListPageData();
  return (
    <>
      <ResponsiveListClient
        entityLabel={t('purchaseOrder')}
        src={purchaseOrders}
        permissions={userPermissions}
        basePath="/purchase_order"
        removeAction={removePurchaseOrder}
        displayFields={[
          { field: 'order_no', headerName: tf('orderNo'), width: 150 },
          { field: 'customer', headerName: tf('customer'), width: 200 }
        ]}
        primaryField="order_no"
      />
    </>
  );
}
