import { getSetting3ListPageData } from '@/lib/setting3/getters';
import DataGridClient from '@/components/DataGridClient';
import { removeSetting3 } from '@/lib/setting3/actions';

export default async function Setting3sPage() {
  const { setting3s, userPermissions } = await getSetting3ListPageData();
  return <DataGridClient src={setting3s} basePath="/setting3" removeAction={removeSetting3} entityLabel="Setting3" displayFields={[
    { field: 'name', headerName: 'Name', width: 150 },
    { field: 'email', headerName: 'Email', width: 400 }
  ]} 
    permissions={userPermissions} />;
}
