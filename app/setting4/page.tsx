import { getSetting4ListPageData } from '@/lib/setting4/getters';
import DataGridClient from '@/components/DataGridClient';
import { removeSetting4 } from '@/lib/setting4/actions';

export default async function Setting4sPage() {
  const { setting4s, userPermissions } = await getSetting4ListPageData();
  return <DataGridClient src={setting4s} basePath="/setting4" removeAction={removeSetting4} entityLabel="Setting4" displayFields={[
    { field: 'name', headerName: 'Name', width: 150 },
    { field: 'email', headerName: 'Email', width: 400 }
  ]} 
    permissions={userPermissions} />;
}
