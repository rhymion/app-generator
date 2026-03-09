import { getTranslations } from 'next-intl/server';
import ResponsiveListClient from '@/components/_standard/ResponsiveListClient';
import { getSettingListPageData } from '@/lib/setting/getters';

export default async function SettingListPage() {
  const [t, tf] = await Promise.all([
    getTranslations('EntityLabel'),
    getTranslations('Fields'),
  ]);
  const { settings, userPermissions } = await getSettingListPageData();
  return (
    <>
      <ResponsiveListClient
        entityLabel={t('setting')}
        src={settings}
        permissions={userPermissions}
        basePath="/setting"
        displayFields={[
          { field: 'name', headerName: tf('name'), width: 150 }
        ]}
        primaryField="name"
      />
    </>
  );
}
