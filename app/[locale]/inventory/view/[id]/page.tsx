import { Suspense } from 'react';
import Loading from '@/app/[locale]/loading';
import FormView from '@/components/inventory/FormView';
import { getInventoryDetailPageData } from '@/lib/inventory/getters';
import { InventoryDetailPageProps } from '@/lib/inventory/types';
import { notFound } from 'next/navigation';

export default async function ViewInventoryPage({ params }: InventoryDetailPageProps) {
  const { id } = await params;
  return (
    <Suspense fallback={<Loading />}>
      <InventoryViewContent id={id} />
    </Suspense>
  );
}

async function InventoryViewContent({ id }: { id: string }) {
  const { inventory, userPermissions } = await getInventoryDetailPageData(id);
  if (!inventory) {
    notFound();
  }
  return <FormView src={inventory} permissions={userPermissions} />;
}
