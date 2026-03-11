import { getTranslations } from 'next-intl/server';
import ResponsiveListClient from '@/components/_standard/ResponsiveListClient';
import { getProductListPageData } from '@/lib/product/getters';
import { removeProduct } from '@/lib/product/actions';

export default async function ProductListPage() {
  const [t, tf] = await Promise.all([
    getTranslations('EntityLabel'),
    getTranslations('Fields'),
  ]);
  const { products, userPermissions } = await getProductListPageData();
  return (
    <>
      <ResponsiveListClient
        entityLabel={t('product')}
        src={products}
        permissions={userPermissions}
        basePath="/product"
        removeAction={removeProduct}
        displayFields={[
          { field: 'code', headerName: tf('code'), width: 150 },
          { field: 'name', headerName: tf('name'), width: 200 },
          { field: 'price', headerName: tf('price'), width: 100 }
        ]}
        primaryField="code"
      />
    </>
  );
}
