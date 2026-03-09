import { getTranslations } from 'next-intl/server';
import ResponsiveListClient from '@/components/_standard/ResponsiveListClient';
import { getSetting2ListPageData } from '@/lib/setting2/getters';

export default async function Setting2ListPage() {
  const [t] = await Promise.all([
    getTranslations('EntityLabel'),
  ]);
  const { setting2s, userPermissions } = await getSetting2ListPageData();
  return (
    <>
      <ResponsiveListClient
        entityLabel={t('setting2')}
        src={setting2s}
        permissions={userPermissions}
        basePath="/setting2"
      />
    </>
  );
}
