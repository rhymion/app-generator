import { Suspense } from 'react';
import Loading from '@/app/[locale]/loading';
import FormView from '@/components/purchase_order/FormView';
import { getPurchaseOrderDetailPageData } from '@/lib/purchase_order/getters';
import { PurchaseOrderDetailPageProps } from '@/lib/purchase_order/types';
import { notFound } from 'next/navigation';

export default async function ViewPurchaseOrderPage({ params }: PurchaseOrderDetailPageProps) {
  const { id } = await params;
  return (
    <Suspense fallback={<Loading />}>
      <PurchaseOrderViewContent id={id} />
    </Suspense>
  );
}

async function PurchaseOrderViewContent({ id }: { id: string }) {
  const { purchaseOrder, userPermissions } = await getPurchaseOrderDetailPageData(id);
  if (!purchaseOrder) {
    notFound();
  }
  return <FormView src={purchaseOrder} permissions={userPermissions} />;
}
