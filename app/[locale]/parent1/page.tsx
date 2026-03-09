import { getTranslations } from 'next-intl/server';
import ResponsiveListClient from '@/components/_standard/ResponsiveListClient';
import { getParent1ListPageData } from '@/lib/parent1/getters';
import { removeParent1 } from '@/lib/parent1/actions';

export default async function Parent1ListPage() {
  const [t] = await Promise.all([
    getTranslations('EntityLabel'),
  ]);
  const { parent1s, userPermissions } = await getParent1ListPageData();
  return (
    <>
      <ResponsiveListClient
        entityLabel={t('parent1')}
        src={parent1s}
        permissions={userPermissions}
        basePath="/parent1"
        removeAction={removeParent1}
      />
    </>
  );
}
