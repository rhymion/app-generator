import { getTranslations } from 'next-intl/server';
import { getSettingListPageData } from '@/lib/setting/getters';
import ResponsiveListClient from '@/components/_standard/ResponsiveListClient';

export default async function SettingsPage() {
  const { settings, userPermissions } = await getSettingListPageData();
  const [t, tf] = await Promise.all([
    getTranslations('EntityLabel'),
    getTranslations('Fields'),
  ]);
  return <ResponsiveListClient src={settings} basePath="/setting" entityLabel={t('setting')} primaryField="name" displayFields={[
    { field: 'name', headerName: tf('name'), width: 150 }
  ]}
    permissions={userPermissions} />;
}
