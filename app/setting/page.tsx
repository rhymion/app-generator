import { getSettingListPageData } from '@/lib/setting/getters';
import DataGridClient from '@/components/DataGridClient';
import { removeSetting } from '@/lib/setting/actions';

export default async function SettingsPage() {
  const { settings, userPermissions } = await getSettingListPageData();
  return <DataGridClient src={settings} basePath="/setting" removeAction={removeSetting} entityLabel="Setting" displayFields={[
    { field: 'name', headerName: 'Name', width: 150 },
    { field: 'email', headerName: 'Email', width: 400 }
  ]} 
    permissions={userPermissions} />;
}
