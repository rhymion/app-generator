import { getTranslations } from 'next-intl/server';
import ResponsiveListClient from '@/components/_standard/ResponsiveListClient';
import { getInventoryListPageData } from '@/lib/inventory/getters';
import { removeInventory } from '@/lib/inventory/actions';

export default async function InventoryListPage() {
  const [t, tf] = await Promise.all([
    getTranslations('EntityLabel'),
    getTranslations('Fields'),
  ]);
  const { inventorys, userPermissions } = await getInventoryListPageData();
  return (
    <>
      <ResponsiveListClient
        entityLabel={t('inventory')}
        src={inventorys}
        permissions={userPermissions}
        basePath="/inventory"
        removeAction={removeInventory}
        displayFields={[
          { field: 'product', headerName: tf('product'), width: 200 },
          { field: 'quantity', headerName: tf('quantity'), width: 100 },
          { field: 'reserved_quantity', headerName: tf('reservedQuantity'), width: 100 }
        ]}
        primaryField="product"
      />
    </>
  );
}
