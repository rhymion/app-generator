import { getSetting2ListPageData } from '@/lib/setting2/getters';
import DataGridClient from '@/components/DataGridClient';

export default async function Setting2sPage() {
  const { setting2s, userPermissions } = await getSetting2ListPageData();
  return <DataGridClient src={setting2s} basePath="/setting2" entityLabel="Setting2" displayFields={[
    { field: 'name', headerName: 'Name', width: 150 },
    { field: 'email', headerName: 'Email', width: 400 }
  ]}
    permissions={userPermissions} />;
}
