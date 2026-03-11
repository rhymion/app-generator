import FormView from '@/components/inventory/FormView';
import { getInventoryDetailPageData } from '@/lib/inventory/getters';
import { InventoryDetailPageProps } from '@/lib/inventory/types';
import { notFound } from 'next/navigation';

export default async function ViewInventoryPage({ params }: InventoryDetailPageProps) {
  const { id } = await params;
  const { inventory, userPermissions } = await getInventoryDetailPageData(id);
  if (!inventory) {
    notFound();
  }
  return <FormView src={inventory} permissions={userPermissions} />;
}
