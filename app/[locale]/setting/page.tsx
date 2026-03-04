import { getSettingListPageData } from '@/lib/setting/getters';
import ResponsiveListClient from '@/components/ResponsiveListClient';

export default async function SettingsPage() {
  const { settings, userPermissions } = await getSettingListPageData();
  return <ResponsiveListClient src={settings} basePath="/setting" entityLabel="Setting" primaryField="name" displayFields={[
    { field: 'name', headerName: 'Name', width: 150 }
  ]}
    permissions={userPermissions} />;
}
