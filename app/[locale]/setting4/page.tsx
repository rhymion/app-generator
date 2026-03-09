import { getTranslations } from 'next-intl/server';
import ResponsiveListClient from '@/components/_standard/ResponsiveListClient';
import { getSetting4ListPageData } from '@/lib/setting4/getters';

export default async function Setting4ListPage() {
  const [t] = await Promise.all([
    getTranslations('EntityLabel'),
  ]);
  const { setting4s, userPermissions } = await getSetting4ListPageData();
  return (
    <>
      <ResponsiveListClient
        entityLabel={t('setting4')}
        src={setting4s}
        permissions={userPermissions}
        basePath="/setting4"
      />
    </>
  );
}
