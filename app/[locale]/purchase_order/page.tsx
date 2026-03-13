import { Suspense } from 'react';
import TableSkeleton from '@/components/_standard/TableSkeleton';
import { getTranslations } from 'next-intl/server';
import ResponsiveListClient from '@/components/_standard/ResponsiveListClient';
import { getPurchaseOrderListPageData } from '@/lib/purchase_order/getters';
import { removePurchaseOrder } from '@/lib/purchase_order/actions';

export default function PurchaseOrderListPage() {
  return (
    <Suspense fallback={<TableSkeleton />}>
      <PurchaseOrderListContent />
    </Suspense>
  );
}

async function PurchaseOrderListContent() {
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
